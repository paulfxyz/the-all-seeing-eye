<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  THE ALL SEEING EYE — update-stats.php                       ║
 * ║                                                              ║
 * ║  PURPOSE                                                     ║
 * ║  ────────────────────────────────────────────────────────    ║
 * ║  Server-side DNS checker and stats writer.                   ║
 * ║  Runs as a cron job on SiteGround (or any PHP host).         ║
 * ║  Because it runs as YOUR user (not www-data), it can write   ║
 * ║  domains.stats without needing chmod 666 on the file.        ║
 * ║                                                              ║
 * ║  WHAT IT DOES                                                ║
 * ║  ────────────────────────────────────────────────────────    ║
 * ║  1. Reads domains.list (one domain per line)                 ║
 * ║  2. For each domain, queries:                                ║
 * ║       A record     → UP/DOWN + latency                       ║
 * ║       NS records   → nameserver provider                     ║
 * ║       MX records   → mail provider                           ║
 * ║       TXT records  → SPF policy                              ║
 * ║       _dmarc TXT   → DMARC policy                            ║
 * ║     Uses PHP's dns_get_record() — no external dependencies.  ║
 * ║  3. Writes results to domains.stats (CSV format)             ║
 * ║  4. Optionally writes a JSON file (domains.json) for the     ║
 * ║     dashboard to consume on next load                        ║
 * ║                                                              ║
 * ║  HOW TO SET UP ON SITEGROUND                                 ║
 * ║  ────────────────────────────────────────────────────────    ║
 * ║  1. Upload this file alongside index.html                    ║
 * ║  2. In cPanel → Cron Jobs, add:                              ║
 * ║       Command: php /home/YOURUSER/public_html/PATH/update-stats.php ║
 * ║       Schedule: every 10 minutes (*/10 * * * *)              ║
 * ║  3. That's it. No chmod changes needed.                      ║
 * ║                                                              ║
 * ║  SECURITY                                                    ║
 * ║  ────────────────────────────────────────────────────────    ║
 * ║  This script is safe to leave web-accessible — it only       ║
 * ║  reads/writes local files and makes DNS queries.             ║
 * ║  It outputs a plain-text log, not sensitive data.            ║
 * ║  If you want to restrict it, add to .htaccess:               ║
 * ║    <Files "update-stats.php">                                ║
 * ║      Require ip YOUR.IP.ADDRESS                              ║
 * ║    </Files>                                                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ── Configuration ─────────────────────────────────────────────
define('DOMAINS_LIST',  __DIR__ . '/domains.list');   // input
define('DOMAINS_STATS', __DIR__ . '/domains.stats');  // CSV output
define('DOMAINS_JSON',  __DIR__ . '/domains.json');   // JSON output (optional)
define('DNS_TIMEOUT',   5);     // seconds per DNS query
define('MAX_DOMAINS',   200);   // safety cap — prevents runaway cron
define('VERSION',       '1.0');

// ── Bootstrap ─────────────────────────────────────────────────
$startTime = microtime(true);
$timestamp = gmdate('Y-m-d\TH:i:s\Z');
$isCLI     = (php_sapi_name() === 'cli');

// Output helpers
function log_line(string $msg): void {
    global $isCLI;
    echo $isCLI ? $msg . "\n" : htmlspecialchars($msg) . "<br>\n";
}

function csv_escape(string $value): string {
    // Wrap in quotes if the value contains commas, quotes, or newlines
    if (str_contains($value, ',') || str_contains($value, '"') || str_contains($value, "\n")) {
        return '"' . str_replace('"', '""', $value) . '"';
    }
    return $value;
}

log_line("👁  The All Seeing Eye — update-stats.php v" . VERSION);
log_line("   Started: $timestamp");
log_line(str_repeat('─', 60));


// ── Step 1: Load domains.list ──────────────────────────────────
if (!file_exists(DOMAINS_LIST)) {
    log_line("✗  domains.list not found at " . DOMAINS_LIST);
    log_line("   Create it with one domain per line, e.g.:");
    log_line("   paulfleury.com");
    log_line("   github.com");
    exit(1);
}

$rawLines = file(DOMAINS_LIST, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
$domains  = array_values(array_filter(
    array_map('trim', $rawLines),
    fn($line) => $line !== '' && $line[0] !== '#'  // skip comments
));

if (empty($domains)) {
    log_line("✗  domains.list is empty or contains only comments.");
    exit(1);
}

// Safety cap
if (count($domains) > MAX_DOMAINS) {
    log_line("⚠  Capping domain list at " . MAX_DOMAINS . " (had " . count($domains) . ")");
    $domains = array_slice($domains, 0, MAX_DOMAINS);
}

log_line("✓  Loaded " . count($domains) . " domains from domains.list");
log_line('');


// ── Step 2: DNS helpers ────────────────────────────────────────

/**
 * Query DNS for a domain + record type.
 * Returns an array of record data strings, or empty array on failure.
 *
 * We use dns_get_record() which is built into PHP — no curl,
 * no external libraries, works on every shared host.
 */
function dns_query(string $domain, int $type): array {
    // Suppress errors — dns_get_record() returns false on NXDOMAIN
    $records = @dns_get_record($domain, $type);
    if (!$records || !is_array($records)) return [];
    return $records;
}

/**
 * Detect NS provider from nameserver hostnames.
 * Returns a human-readable provider name.
 */
function detect_ns_provider(array $nsRecords): string {
    $all = strtolower(implode(' ', array_column($nsRecords, 'target')));
    if (str_contains($all, 'awsdns'))                   return 'AWS';
    if (str_contains($all, 'azure-dns'))                return 'Azure';
    if (str_contains($all, 'cloudflare'))               return 'Cloudflare';
    if (str_contains($all, 'googledomains') ||
        str_contains($all, 'google'))                   return 'Google';
    if (str_contains($all, 'nsone') ||
        str_contains($all, '.p0') || str_contains($all, '.p09'))  return 'NS1';
    if (str_contains($all, 'akam') ||
        str_contains($all, 'akamai'))                   return 'Akamai';
    if (str_contains($all, 'wikimedia'))                return 'Wikimedia';
    if (str_contains($all, 'siteground'))               return 'SiteGround';
    if (str_contains($all, 'cloudns'))                  return 'ClouDNS';
    return 'Own';
}

/**
 * Detect MX / mail provider from MX record targets.
 */
function detect_mx_provider(array $mxRecords): string {
    if (empty($mxRecords)) return 'None';
    $all = strtolower(implode(' ', array_column($mxRecords, 'target')));
    if (str_contains($all, 'google') ||
        str_contains($all, 'aspmx'))                    return 'Google';
    if (str_contains($all, 'outlook') ||
        str_contains($all, 'protection.outlook') ||
        str_contains($all, 'microsoft'))                return 'Microsoft';
    if (str_contains($all, 'protonmail') ||
        str_contains($all, 'proton'))                   return 'ProtonMail';
    if (str_contains($all, 'amazonses') ||
        str_contains($all, 'amazon-smtp'))              return 'Amazon SES';
    if (str_contains($all, 'mimecast'))                 return 'Mimecast';
    if (str_contains($all, 'mailgun'))                  return 'Mailgun';
    if (str_contains($all, 'sendgrid'))                 return 'SendGrid';
    if (str_contains($all, 'zoho'))                     return 'Zoho';
    return 'Own';
}

/**
 * Parse DMARC policy from _dmarc TXT records.
 * Returns 'reject', 'quarantine', 'none', or 'missing'.
 */
function parse_dmarc(array $txtRecords): string {
    foreach ($txtRecords as $record) {
        $txt = strtolower($record['txt'] ?? $record['entries'][0] ?? '');
        if (str_contains($txt, 'v=dmarc1')) {
            if (str_contains($txt, 'p=reject'))     return 'reject';
            if (str_contains($txt, 'p=quarantine')) return 'quarantine';
            if (str_contains($txt, 'p=none'))       return 'none';
            return 'none';
        }
    }
    return 'missing';
}

/**
 * Parse SPF qualifier from TXT records.
 * Returns '~all', '-all', '+all', or '' if no SPF found.
 */
function parse_spf(array $txtRecords): string {
    foreach ($txtRecords as $record) {
        $txt = $record['txt'] ?? $record['entries'][0] ?? '';
        if (stripos($txt, 'v=spf1') !== false) {
            preg_match('/([~\-+?]all)/i', $txt, $m);
            return $m[1] ?? '~all';
        }
    }
    return '';
}

/**
 * Get the first few NS/MX targets as a compact string for tooltips.
 */
function format_records(array $records, string $field, int $max = 3): string {
    $values = array_column($records, $field);
    $values = array_slice($values, 0, $max);
    return implode(', ', $values) ?: '—';
}

/**
 * Get SPF full record string for tooltip.
 */
function get_spf_record(array $txtRecords): string {
    foreach ($txtRecords as $record) {
        $txt = $record['txt'] ?? $record['entries'][0] ?? '';
        if (stripos($txt, 'v=spf1') !== false) return $txt;
    }
    return '—';
}

/**
 * Get DMARC full record string for tooltip.
 */
function get_dmarc_record(array $txtRecords): string {
    foreach ($txtRecords as $record) {
        $txt = $record['txt'] ?? $record['entries'][0] ?? '';
        if (stripos($txt, 'v=dmarc1') !== false) return $txt;
    }
    return '—';
}



// ── SSL expiry helper ─────────────────────────────────────────
/**
 * Fetch SSL certificate expiry for a domain via real TLS connection.
 * Uses stream_socket_client() — no curl, works on all shared hosts.
 * Reads the peer certificate and extracts the notAfter date.
 *
 * @param  string $domain  bare domain name
 * @param  int    $timeout seconds before giving up
 * @return array|null  ['expiry'=>'YYYY-MM-DD', 'issuer'=>string] or null
 */
function get_ssl_expiry(string $domain, int $timeout = 5): ?array {
    $context = stream_context_create(['ssl' => [
        'capture_peer_cert' => true,
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'SNI_enabled'       => true,
        'peer_name'         => $domain,
    ]]);
    $stream = @stream_socket_client(
        'ssl://' . $domain . ':443', $errno, $errstr, $timeout,
        STREAM_CLIENT_CONNECT, $context
    );
    if (!$stream) return null;
    $params = stream_context_get_params($stream);
    fclose($stream);
    $cert = $params['options']['ssl']['peer_certificate'] ?? null;
    if (!$cert) return null;
    $info = openssl_x509_parse($cert);
    if (!$info) return null;
    $ts = $info['validTo_time_t'] ?? null;
    if (!$ts) return null;
    $cn = $info['issuer']['CN'] ?? $info['issuer']['O'] ?? '?';
    $isLE = stripos($cn, "let's encrypt") !== false || preg_match('/^[RE]\d+$/', $cn);
    return [
        'expiry' => date('Y-m-d', $ts),
        'issuer' => $isLE ? 'LE' : substr($cn, 0, 25),
    ];
}

// ── Step 3: Check each domain ──────────────────────────────────

$results = [];
$onlineCount = 0;
$alertCount  = 0;

foreach ($domains as $rank => $domain) {
    $rank1 = $rank + 1;
    log_line("  [{$rank1}/" . count($domains) . "] Checking $domain…");

    $t0 = microtime(true);

    // ── A record: uptime check ──
    $aRecords = dns_query($domain, DNS_A);
    $latencyMs = round((microtime(true) - $t0) * 1000);
    $status    = !empty($aRecords) ? 'UP' : 'DOWN';
    if ($status === 'UP') $onlineCount++;

    // ── SSL certificate expiry ──
    // Connect to port 443 and read the peer cert.
    // Only run if domain is UP (avoids long timeouts on down domains).
    $sslExpiry = '';
    $sslIssuer = '';
    if ($status === 'UP') {
        $ssl = get_ssl_expiry($domain, 5);
        if ($ssl) {
            $sslExpiry = $ssl['expiry'];
            $sslIssuer = $ssl['issuer'];
            // Calculate days until expiry
            $sslDays   = (int) round((strtotime($sslExpiry) - time()) / 86400);
            if ($sslDays < 30) $alertCount++; // override DNS-based alert count
        }
    }

    // ── NS records ──
    $nsRecords  = dns_query($domain, DNS_NS);
    $nsProvider = detect_ns_provider($nsRecords);
    $nsRaw      = format_records($nsRecords, 'target');

    // ── MX records ──
    $mxRecords  = dns_query($domain, DNS_MX);
    $mxProvider = detect_mx_provider($mxRecords);
    $mxRaw      = format_records($mxRecords, 'target');

    // ── TXT records (SPF) ──
    $txtRecords = dns_query($domain, DNS_TXT);
    $spf        = parse_spf($txtRecords);
    $spfRaw     = get_spf_record($txtRecords);

    // ── _dmarc TXT (DMARC) ──
    $dmarcTxt   = dns_query('_dmarc.' . $domain, DNS_TXT);
    $dmarc      = parse_dmarc($dmarcTxt);
    $dmarcRaw   = get_dmarc_record($dmarcTxt);

    // Flag as alert if DMARC is missing or SPF is absent
    if ($dmarc === 'missing' || $spf === '') $alertCount++;

    $results[] = [
        'rank'       => $rank1,
        'domain'     => $domain,
        'status'     => $status,
        'latency_ms' => $latencyMs,
        'ns'         => $nsProvider,
        'ns_raw'     => $nsRaw,
        'mx'         => $mxProvider,
        'mx_raw'     => $mxRaw,
        'dmarc'      => $dmarc,
        'dmarc_raw'  => $dmarcRaw,
        'spf'        => $spf,
        'spf_raw'    => $spfRaw,
        'timestamp'  => $timestamp,
    ];

    log_line("       → $status | {$latencyMs}ms | SSL=" . ($sslExpiry ?: '—') . " ($sslIssuer) | NS=$nsProvider | MX=$mxProvider | DMARC=$dmarc | SPF=" . ($spf ?: '—'));
}

log_line('');
log_line("✓  Checked " . count($domains) . " domains: $onlineCount UP, " . (count($domains) - $onlineCount) . " DOWN, $alertCount alerts");
log_line('');


// ── Step 4: Write domains.stats (CSV) ─────────────────────────

/**
 * CSV format matches what the browser's "Export CSV" button produces,
 * so the file can be opened in Excel / Google Sheets directly.
 */
$csvHeaders = ['Timestamp','Rank','Domain','Status','Latency (ms)',
               'SSL Expiry','SSL Issuer',
               'NS Provider','NS Records','MX Provider','MX Records',
               'DMARC','DMARC Record','SPF','SPF Record'];

$csvLines = [implode(',', $csvHeaders)];

foreach ($results as $r) {
    $csvLines[] = implode(',', array_map('csv_escape', [
        $r['timestamp'],
        (string)$r['rank'],
        $r['domain'],
        $r['status'],
        (string)$r['latency_ms'],
        $r['ns'],
        $r['ns_raw'],
        $r['mx'],
        $r['mx_raw'],
        $r['dmarc'],
        $r['dmarc_raw'],
        $r['spf'],
        $r['spf_raw'],
    ]));
}

$csvContent = implode("\n", $csvLines) . "\n";

if (file_put_contents(DOMAINS_STATS, $csvContent) !== false) {
    log_line("✓  domains.stats written (" . count($results) . " rows, " . strlen($csvContent) . " bytes)");
} else {
    log_line("✗  Failed to write domains.stats — check file permissions");
    log_line("   Run: touch " . DOMAINS_STATS . " && chmod 644 " . DOMAINS_STATS);
}


// ── Step 5: Write domains.json (optional, for future dashboard use) ──

/**
 * domains.json gives the browser dashboard a server-authoritative
 * snapshot to load on startup — useful for showing last-known state
 * before the live DNS checks complete in the browser.
 *
 * Format: { "updated": "ISO timestamp", "domains": [ {...}, ... ] }
 */
$jsonOutput = [
    'updated'  => $timestamp,
    'version'  => VERSION,
    'count'    => count($results),
    'online'   => $onlineCount,
    'alerts'   => $alertCount,
    'domains'  => $results,
];

if (file_put_contents(DOMAINS_JSON, json_encode($jsonOutput, JSON_PRETTY_PRINT)) !== false) {
    log_line("✓  domains.json written");
} else {
    log_line("⚠  domains.json not written (optional — not required for operation)");
}


// ── Done ──────────────────────────────────────────────────────

$elapsed = round(microtime(true) - $startTime, 2);
log_line('');
log_line(str_repeat('─', 60));
log_line("✓  Done in {$elapsed}s");
log_line("   Next run: set cron to */10 * * * * (every 10 minutes)");
