<?php
/**
 * notify.php — All-Seeing-Eye email notification sender
 *
 * Sends downtime alert and health digest emails via the Resend API.
 * Called by the browser JS on UP↔DOWN transitions and by update-stats.php.
 *
 * POST body (JSON) — downtime/recovery:
 * {
 *   "action":     "notify",
 *   "domain":     "example.com",
 *   "status":     "DOWN" | "UP",
 *   "latency":    null | 42,
 *   "ssl_expiry": "2026-08-15" | null,    // ISO date or null
 *   "ssl_days":   42 | null,              // days until expiry or null
 *   "dmarc":      "reject"|"quarantine"|"none"|"missing",
 *   "spf":        "~all"|"-all"|null,     // null = missing
 *   "ns":         "Cloudflare",
 *   "mx":         "Google"
 * }
 *
 * POST body (JSON) — test email:
 * { "action": "test" }
 *
 * Security:
 *   - API key AES-256-GCM decrypted from ase_config.json + notify_secret.key
 *   - Rate limit: 10 emails/hour
 *   - All inputs sanitised before rendering in HTML
 *
 * @version 3.3.0
 * @author  Paul Fleury / Perplexity Computer
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

define('CONFIG_FILE',     __DIR__ . '/ase_config.json');
define('SECRET_FILE',     __DIR__ . '/notify_secret.key');
define('RATE_LIMIT_FILE', __DIR__ . '/notify_rate.json');
define('MAX_EMAILS_PER_HOUR', 10);

/* ── Helpers ── */

function readConfig() {
    if (!file_exists(CONFIG_FILE)) return [];
    $raw = json_decode(file_get_contents(CONFIG_FILE), true);
    return is_array($raw) ? $raw : [];
}

function getOrCreateSecret() {
    if (file_exists(SECRET_FILE)) return trim(file_get_contents(SECRET_FILE));
    $secret = bin2hex(random_bytes(32));
    file_put_contents(SECRET_FILE, $secret);
    chmod(SECRET_FILE, 0600);
    return $secret;
}

function decryptApiKey(string $encoded, string $secret) {
    $raw = base64_decode($encoded);
    if (strlen($raw) < 29) return false;
    $key    = hash('sha256', $secret, true);
    $iv     = substr($raw, 0, 12);
    $tag    = substr($raw, 12, 16);
    $cipher = substr($raw, 28);
    return openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
}

function checkRateLimit(): bool {
    $data   = [];
    $now    = time();
    $cutoff = $now - 3600;
    if (file_exists(RATE_LIMIT_FILE)) {
        $raw = json_decode(file_get_contents(RATE_LIMIT_FILE), true);
        if (is_array($raw)) $data = $raw;
    }
    $data = array_filter($data, function($ts) use ($cutoff) { return $ts > $cutoff; });
    if (count($data) >= MAX_EMAILS_PER_HOUR) return false;
    $data[] = $now;
    file_put_contents(RATE_LIMIT_FILE, json_encode(array_values($data)));
    return true;
}

function sendViaResend(string $apiKey, string $from, string $to, string $subject, string $html): array {
    $payload = json_encode(['from' => $from, 'to' => [$to], 'subject' => $subject, 'html' => $html]);
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/json\r\nAuthorization: Bearer {$apiKey}\r\nContent-Length: " . strlen($payload),
        'content' => $payload,
        'timeout' => 10,
        'ignore_errors' => true
    ]]);
    $response = @file_get_contents('https://api.resend.com/emails', false, $ctx);
    $httpCode = 0;
    if (isset($http_response_header)) {
        foreach ($http_response_header as $h) {
            if (preg_match('/HTTP\/[\d.]+ (\d+)/', $h, $m)) $httpCode = intval($m[1]);
        }
    }
    if ($response === false || ($httpCode !== 200 && $httpCode !== 201)) {
        $err = $response ? (json_decode($response, true)['message'] ?? $response) : 'Network error';
        return ['error' => "Resend API ({$httpCode}): {$err}"];
    }
    return ['ok' => true, 'id' => json_decode($response, true)['id'] ?? null];
}

/** Sanitise string for safe HTML output */
function h($val): string {
    return htmlspecialchars((string)($val ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Analyse domain health and return an array of alert items.
 * Each item: [ 'level' => 'warning'|'critical', 'label' => '...', 'detail' => '...' ]
 */
function analyseHealth(array $p): array {
    $alerts = [];

    /* SSL expiry */
    $sslDays = isset($p['ssl_days']) && $p['ssl_days'] !== null ? intval($p['ssl_days']) : null;
    if ($sslDays !== null) {
        if ($sslDays <= 0) {
            $alerts[] = ['level' => 'critical', 'label' => 'SSL Expired',
                         'detail' => 'Certificate is expired — visitors see a security warning'];
        } elseif ($sslDays <= 7) {
            $alerts[] = ['level' => 'critical', 'label' => 'SSL Expiring Very Soon',
                         'detail' => "Expires in {$sslDays} day" . ($sslDays === 1 ? '' : 's') . " — renew immediately"];
        } elseif ($sslDays <= 30) {
            $alerts[] = ['level' => 'warning', 'label' => 'SSL Expiring Soon',
                         'detail' => "Expires in {$sslDays} days — renewal recommended"];
        }
    }

    /* DMARC */
    $dmarc = strtolower(trim($p['dmarc'] ?? ''));
    if ($dmarc === 'missing' || $dmarc === '') {
        $alerts[] = ['level' => 'warning', 'label' => 'DMARC Missing',
                     'detail' => 'No DMARC policy — domain is vulnerable to email spoofing'];
    } elseif ($dmarc === 'none') {
        $alerts[] = ['level' => 'warning', 'label' => 'DMARC Not Enforced',
                     'detail' => 'p=none — policy defined but not enforced; consider p=quarantine or p=reject'];
    }

    /* SPF */
    $spf = trim($p['spf'] ?? '');
    if ($spf === '' || $spf === null) {
        $alerts[] = ['level' => 'warning', 'label' => 'SPF Missing',
                     'detail' => 'No SPF record — increases chance of being marked as spam'];
    }

    return $alerts;
}

/**
 * Build the full alert/health digest HTML email.
 *
 * @param string   $domain
 * @param string   $status    "DOWN" | "UP" | "TEST" | "HEALTH"
 * @param array    $extra     All additional domain health fields
 * @param bool     $isTest    True = test email layout
 */
function buildAlertEmail(string $domain, string $status, array $extra = [], bool $isTest = false): string {
    $isDown    = ($status === 'DOWN');
    $isUp      = ($status === 'UP');
    $latency   = $extra['latency']   ?? null;
    $sslExpiry = $extra['ssl_expiry'] ?? null;
    $sslDays   = isset($extra['ssl_days']) && $extra['ssl_days'] !== null ? intval($extra['ssl_days']) : null;
    $dmarc     = $extra['dmarc']     ?? null;
    $spf       = $extra['spf']       ?? null;
    $ns        = $extra['ns']        ?? null;
    $mx        = $extra['mx']        ?? null;

    /* Colour + messaging */
    if ($isTest) {
        $headerColor = '#8b5cf6';
        $headerIcon  = '🧪';
        $headerTitle = 'Test Notification — The All Seeing Eye';
        $subTitle    = 'Your email notifications are configured correctly.';
    } elseif ($isDown) {
        $headerColor = '#ef4444';
        $headerIcon  = '🔴';
        $headerTitle = "Downtime Alert: {$domain}";
        $subTitle    = 'This domain is currently unreachable.';
    } else {
        $headerColor = '#10b981';
        $headerIcon  = '✅';
        $headerTitle = "Recovered: {$domain}";
        $subTitle    = 'This domain is back online.';
    }

    $timeStr  = date('D d M Y, H:i:s T');
    $latStr   = $latency !== null ? "{$latency}ms" : '—';
    $sslStr   = $sslExpiry ? h($sslExpiry) . ($sslDays !== null ? " ({$sslDays}d)" : '') : '—';
    $dmarcStr = $dmarc ? h(ucfirst($dmarc)) : '—';
    $spfStr   = $spf   ? h($spf)   : '—';
    $nsStr    = $ns    ? h($ns)    : '—';
    $mxStr    = $mx    ? h($mx)    : '—';

    /* SSL days colour */
    $sslColor = '#374151'; /* default neutral */
    if ($sslDays !== null) {
        if ($sslDays <= 7)  $sslColor = '#ef4444';
        elseif ($sslDays <= 30) $sslColor = '#f59e0b';
        else                    $sslColor = '#10b981';
    }

    /* DMARC colour */
    $dmarcColor = '#374151';
    if ($dmarc === 'reject')     $dmarcColor = '#10b981';
    elseif ($dmarc === 'quarantine') $dmarcColor = '#f59e0b';
    elseif ($dmarc === 'none' || $dmarc === 'missing' || !$dmarc) $dmarcColor = '#ef4444';

    /* Health alerts */
    $healthAlerts = analyseHealth($extra);

    /* Build alerts HTML */
    $alertsHtml = '';
    if (!empty($healthAlerts)) {
        $alertsHtml = '<div style="margin-top:20px">';
        $alertsHtml .= '<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:10px">⚠ Health Alerts</div>';
        foreach ($healthAlerts as $a) {
            $bg    = $a['level'] === 'critical' ? '#fef2f2' : '#fffbeb';
            $bc    = $a['level'] === 'critical' ? '#fecaca' : '#fde68a';
            $lc    = $a['level'] === 'critical' ? '#dc2626' : '#d97706';
            $icon  = $a['level'] === 'critical' ? '🚨' : '⚠️';
            $alertsHtml .= "<div style=\"background:{$bg};border:1px solid {$bc};border-radius:8px;padding:10px 14px;margin-bottom:8px\">";
            $alertsHtml .= "<div style=\"font-weight:700;font-size:13px;color:{$lc};margin-bottom:3px\">{$icon} " . h($a['label']) . "</div>";
            $alertsHtml .= "<div style=\"font-size:12px;color:#374151\">" . h($a['detail']) . "</div>";
            $alertsHtml .= "</div>";
        }
        $alertsHtml .= '</div>';
    }

    /* Test domain snapshot (realistic demo for test emails) */
    $testSnapshot = '';
    if ($isTest) {
        $testSnapshot = '
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af;margin-bottom:12px">Example Notification</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><td style="padding:5px 0;color:#6b7280;width:110px">Domain</td><td style="padding:5px 0;font-weight:600;color:#111">yourdomain.com</td></tr>
            <tr><td style="padding:5px 0;color:#6b7280">Event</td><td style="padding:5px 0;font-weight:700;color:#ef4444">🔴 DOWN</td></tr>
            <tr><td style="padding:5px 0;color:#6b7280">SSL Expiry</td><td style="padding:5px 0;color:#f59e0b;font-weight:600">2026-04-15 (23d)</td></tr>
            <tr><td style="padding:5px 0;color:#6b7280">DMARC</td><td style="padding:5px 0;color:#10b981">Reject ✓</td></tr>
            <tr><td style="padding:5px 0;color:#6b7280">SPF</td><td style="padding:5px 0;color:#10b981">~all ✓</td></tr>
          </table>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;margin-top:10px;font-size:12px;color:#d97706">
            <strong>⚠ SSL Expiring Soon</strong> — Expires in 23 days — renewal recommended
          </div>
        </div>';
    }

    return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{$headerIcon} {$headerTitle}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:24px 16px">
  <div style="max-width:520px;margin:0 auto">

    <!-- Header -->
    <div style="background:{$headerColor};padding:24px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-.02em">{$headerIcon} {$headerTitle}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:14px">{$subTitle}</p>
    </div>

    <!-- Body -->
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 12px rgba(0,0,0,.08)">

      {$testSnapshot}

      <!-- Domain details table -->
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:4px">
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:9px 0;color:#6b7280;width:130px;font-size:13px">Domain</td>
          <td style="padding:9px 0;font-weight:700;color:#111">https://{$domain}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:9px 0;color:#6b7280;font-size:13px">Status</td>
          <td style="padding:9px 0;font-weight:800;color:{$headerColor}">{$status}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:9px 0;color:#6b7280;font-size:13px">Latency</td>
          <td style="padding:9px 0;color:#374151">{$latStr}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:9px 0;color:#6b7280;font-size:13px">SSL Expiry</td>
          <td style="padding:9px 0;font-weight:600;color:{$sslColor}">{$sslStr}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:9px 0;color:#6b7280;font-size:13px">DMARC</td>
          <td style="padding:9px 0;font-weight:600;color:{$dmarcColor}">{$dmarcStr}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:9px 0;color:#6b7280;font-size:13px">SPF</td>
          <td style="padding:9px 0;color:#374151">{$spfStr}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:9px 0;color:#6b7280;font-size:13px">Nameserver</td>
          <td style="padding:9px 0;color:#374151">{$nsStr}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;color:#6b7280;font-size:13px">Mail Provider</td>
          <td style="padding:9px 0;color:#374151">{$mxStr}</td>
        </tr>
      </table>

      {$alertsHtml}

      <!-- Timestamp + footer -->
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span style="font-size:11px;color:#9ca3af">{$timeStr}</span>
        <a href="https://github.com/paulfxyz/the-all-seeing-eye"
           style="font-size:11px;color:#8b5cf6;text-decoration:none;font-weight:600">
          👁 The All Seeing Eye
        </a>
      </div>
    </div>

  </div>
</body>
</html>
HTML;
}


/**
 * Build a multi-domain health digest email.
 *
 * Combines all issues across all domains into a single well-structured
 * email. Grouped by severity (critical first, then warnings).
 * Each issue shows the domain snapshot (SSL, DMARC, SPF, NS, MX).
 *
 * @param array $issues   Array of issue objects from the browser or cron
 * @param int   $totalDomains
 * @param int   $domainsDown
 */
function buildDigestEmail(array $issues, int $totalDomains, int $domainsDown): string {
    $timeStr      = date('D d M Y, H:i:s T');
    $issueCount   = count($issues);
    $criticals    = array_filter($issues, function($i) { return $i['severity'] === 'critical'; });
    $warnings     = array_filter($issues, function($i) { return $i['severity'] === 'warning'; });
    $critCount    = count($criticals);
    $warnCount    = count($warnings);
    $headerColor  = $critCount > 0 ? '#ef4444' : '#f59e0b';
    $headerIcon   = $critCount > 0 ? '🚨' : '⚠️';
    $issueWord    = $issueCount !== 1 ? 'issues' : 'issue';
    $headerTitle  = $critCount > 0
        ? "Downtime / Critical Alert — {$issueCount} {$issueWord} detected"
        : "Health Warning — {$issueCount} {$issueWord} detected";

    /* Build issue rows — pre-resolve all values before heredoc to avoid
     * PHP heredoc interpolation limitations (no function calls inside {}) */
    $rowsHtml = '';
    $allIssues = array_merge(array_values($criticals), array_values($warnings));
    foreach ($allIssues as $issue) {
        $isCritical  = ($issue['severity'] === 'critical');
        $rowBg       = $isCritical ? '#fef2f2' : '#fffbeb';
        $rowBorder   = $isCritical ? '#fecaca' : '#fde68a';
        $labelColor  = $isCritical ? '#dc2626' : '#d97706';
        $icon        = $isCritical ? '🚨' : '⚠️';

        /* Pre-resolve all display values — no expressions inside heredoc */
        $domainStr   = h($issue['domain'] ?? '');
        $labelStr    = h($issue['label']  ?? '');
        $detailStr   = h($issue['detail'] ?? '');
        $sslExpiry   = $issue['ssl_expiry'] ?? null;
        $sslDays     = $issue['ssl_days']   ?? null;
        $dmarc       = $issue['dmarc']      ?? null;
        $spfVal      = $issue['spf']        ?? null;
        $nsVal       = $issue['ns']         ?? null;
        $mxVal       = $issue['mx']         ?? null;
        $latency     = $issue['latency']    ?? null;

        /* SSL */
        $sslStr  = $sslExpiry ? h($sslExpiry) . ($sslDays !== null ? " ({$sslDays}d)" : '') : '—';
        $sslCol  = '#374151';
        if ($sslDays !== null) {
            if ($sslDays <= 7)       $sslCol = '#dc2626';
            elseif ($sslDays <= 30)  $sslCol = '#d97706';
            else                     $sslCol = '#059669';
        }

        /* DMARC */
        $dmarcStr = $dmarc ? h(ucfirst($dmarc)) : '—';
        $dmarcCol = '#374151';
        if ($dmarc === 'reject')                              $dmarcCol = '#059669';
        elseif ($dmarc === 'quarantine')                      $dmarcCol = '#d97706';
        elseif ($dmarc === 'none' || $dmarc === 'missing')    $dmarcCol = '#dc2626';

        /* SPF, NS, MX — pre-resolved to avoid ternaries inside heredoc */
        $spfStr  = $spfVal  ? h($spfVal)  : '<span style="color:#dc2626">missing</span>';
        $nsStr   = $nsVal   ? h($nsVal)   : '—';
        $mxStr   = $mxVal   ? h($mxVal)   : '—';
        $latStr  = $latency !== null ? "{$latency}ms" : '—';

        $rowsHtml .= <<<ROW
        <div style="background:{$rowBg};border:1px solid {$rowBorder};border-radius:10px;padding:16px 18px;margin-bottom:12px">
          <div style="margin-bottom:10px">
            <span style="font-size:16px;font-weight:800;color:#111">{$icon} {$domainStr}</span>
            <span style="margin-left:10px;display:inline-block;background:{$labelColor};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;letter-spacing:.04em;text-transform:uppercase">{$labelStr}</span>
          </div>
          <p style="margin:0 0 10px;font-size:13px;color:#374151">{$detailStr}</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <tr>
              <td style="padding:3px 8px 3px 0;color:#6b7280;width:90px">Latency</td>
              <td style="padding:3px 0;color:#374151">{$latStr}</td>
              <td style="padding:3px 8px 3px 16px;color:#6b7280;width:70px">SSL</td>
              <td style="padding:3px 0;font-weight:600;color:{$sslCol}">{$sslStr}</td>
            </tr>
            <tr>
              <td style="padding:3px 8px 3px 0;color:#6b7280">DMARC</td>
              <td style="padding:3px 0;font-weight:600;color:{$dmarcCol}">{$dmarcStr}</td>
              <td style="padding:3px 8px 3px 16px;color:#6b7280">SPF</td>
              <td style="padding:3px 0;color:#374151">{$spfStr}</td>
            </tr>
            <tr>
              <td style="padding:3px 8px 3px 0;color:#6b7280">NS</td>
              <td style="padding:3px 0;color:#374151">{$nsStr}</td>
              <td style="padding:3px 8px 3px 16px;color:#6b7280">MX</td>
              <td style="padding:3px 0;color:#374151">{$mxStr}</td>
            </tr>
          </table>
        </div>
ROW;
    }

    /* Summary line — pre-built string (no inline quotes that could break parsing) */
    $summaryParts = [];
    if ($domainsDown > 0) {
        $summaryParts[] = '<strong style="color:#ef4444">' . $domainsDown . ' DOWN</strong>';
    }
    if ($critCount > 0) $summaryParts[] = $critCount . ' critical';
    if ($warnCount > 0) $summaryParts[] = $warnCount . ' warning' . ($warnCount !== 1 ? 's' : '');
    $summary = implode(' &middot; ', $summaryParts);

    return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:24px 16px">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:{$headerColor};padding:22px 24px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800">{$headerIcon} {$headerTitle}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px">
        {$totalDomains} domains monitored · {$summary} · {$timeStr}
      </p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 12px rgba(0,0,0,.08)">

      {$rowsHtml}

      <div style="margin-top:16px;padding-top:14px;border-top:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;color:#9ca3af">{$timeStr}</span>
        <a href="https://github.com/paulfxyz/the-all-seeing-eye"
           style="font-size:11px;color:#8b5cf6;text-decoration:none;font-weight:600">👁 The All Seeing Eye</a>
      </div>
    </div>
  </div>
</body>
</html>
HTML;
}

/* ── Main ── */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body   = file_get_contents('php://input');
$posted = json_decode($body, true);
if (!is_array($posted)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$action = $posted['action'] ?? 'notify';

/* Load config */
$cfg = readConfig();
if (empty($cfg['notify_enabled'])) {
    echo json_encode(['ok' => false, 'message' => 'Notifications disabled']);
    exit;
}
if (empty($cfg['notify_api_key_enc']) || empty($cfg['notify_from']) || empty($cfg['notify_to'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Notification settings incomplete — configure in dashboard']);
    exit;
}

$secret = getOrCreateSecret();
$apiKey = decryptApiKey($cfg['notify_api_key_enc'], $secret);
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to decrypt API key — reconfigure in dashboard']);
    exit;
}

$from = $cfg['notify_from'];
$to   = $cfg['notify_to'];

/* ── Test email ── */
if ($action === 'test') {
    /* Build a realistic demo digest showing all possible alert types */
    $demoIssues = [
        [
            'domain'     => 'app.yourdomain.com',
            'type'       => 'down',
            'severity'   => 'critical',
            'label'      => 'Domain Unreachable',
            'detail'     => 'A record lookup returned no results — domain is not resolving.',
            'latency'    => null,
            'ssl_expiry' => date('Y-m-d', strtotime('+18 days')),
            'ssl_days'   => 18,
            'dmarc'      => 'quarantine',
            'spf'        => '~all',
            'ns'         => 'Cloudflare',
            'mx'         => 'Google',
        ],
        [
            'domain'     => 'mail.yourdomain.com',
            'type'       => 'ssl_expiry',
            'severity'   => 'critical',
            'label'      => 'SSL Expiring — Urgent',
            'detail'     => 'Certificate expires in 5 days.',
            'latency'    => 84,
            'ssl_expiry' => date('Y-m-d', strtotime('+5 days')),
            'ssl_days'   => 5,
            'dmarc'      => 'reject',
            'spf'        => '~all',
            'ns'         => 'AWS',
            'mx'         => 'ProtonMail',
        ],
        [
            'domain'     => 'blog.yourdomain.com',
            'type'       => 'dmarc_missing',
            'severity'   => 'warning',
            'label'      => 'DMARC Missing',
            'detail'     => 'No DMARC policy — domain is vulnerable to email spoofing.',
            'latency'    => 210,
            'ssl_expiry' => date('Y-m-d', strtotime('+90 days')),
            'ssl_days'   => 90,
            'dmarc'      => 'missing',
            'spf'        => '~all',
            'ns'         => 'SiteGround',
            'mx'         => 'Google',
        ],
    ];

    $subject = '🧪 Test — The All Seeing Eye notification digest';
    $html    = buildDigestEmail($demoIssues, 34, 1);
    $result  = sendViaResend($apiKey, $from, $to, $subject, $html);
    echo json_encode($result);
    exit;
}

/* ── Health digest (multi-domain report) ── */
if ($action === 'digest') {
    $issues       = $posted['issues']         ?? [];
    $totalDomains = intval($posted['total_domains'] ?? 0);
    $domainsDown  = intval($posted['domains_down']  ?? 0);

    if (empty($issues) || !is_array($issues)) {
        echo json_encode(['ok' => false, 'message' => 'No issues provided']);
        exit;
    }

    /* Count critical issues for subject line */
    $critCount = count(array_filter($issues, function($i) { return isset($i['severity']) ? $i['severity'] === 'critical' : false; }));
    $warnCount = count($issues) - $critCount;
    $subject   = $critCount > 0
        ? "🚨 {$critCount} critical alert" . ($critCount !== 1 ? 's' : '') . " — The All Seeing Eye"
        : "⚠️ {$warnCount} health warning" . ($warnCount !== 1 ? 's' : '') . " — The All Seeing Eye";

    if (!checkRateLimit()) {
        echo json_encode(['ok' => false, 'message' => 'Rate limit reached (10 emails/hour)']);
        exit;
    }

    $html   = buildDigestEmail($issues, $totalDomains, $domainsDown);
    $result = sendViaResend($apiKey, $from, $to, $subject, $html);
    echo json_encode($result);
    exit;
}

/* ── Downtime / recovery notification ── */
$domain = trim($posted['domain'] ?? '');
$status = strtoupper(trim($posted['status'] ?? 'DOWN'));

if (!$domain) {
    http_response_code(400);
    echo json_encode(['error' => 'domain required']);
    exit;
}

if (!checkRateLimit()) {
    echo json_encode(['ok' => false, 'message' => 'Rate limit reached (10 emails/hour)']);
    exit;
}

/* Collect all health fields from the POST body */
$extra = [
    'latency'    => isset($posted['latency'])    && $posted['latency']    !== null ? intval($posted['latency'])    : null,
    'ssl_expiry' => isset($posted['ssl_expiry'])  && $posted['ssl_expiry'] !== '' ? $posted['ssl_expiry']  : null,
    'ssl_days'   => isset($posted['ssl_days'])    && $posted['ssl_days']   !== null ? intval($posted['ssl_days'])   : null,
    'dmarc'      => $posted['dmarc'] ?? null,
    'spf'        => $posted['spf']   ?? null,
    'ns'         => $posted['ns']    ?? null,
    'mx'         => $posted['mx']    ?? null,
];

$emoji   = $status === 'DOWN' ? '🔴' : '✅';
$subject = $status === 'DOWN'
    ? "🔴 DOWN: {$domain} is unreachable"
    : "✅ RECOVERED: {$domain} is back online";

$html   = buildAlertEmail($domain, $status, $extra);
$result = sendViaResend($apiKey, $from, $to, $subject, $html);
echo json_encode($result);
