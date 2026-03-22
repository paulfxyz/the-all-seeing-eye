<?php
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  THE ALL SEEING EYE — ssl-check.php  v2.0.0                  ║
 * ║                                                              ║
 * ║  Server-side SSL certificate expiry checker.                 ║
 * ║  Called by the browser dashboard instead of crt.sh because: ║
 * ║   - PHP can open real TLS connections (browser cannot)       ║
 * ║   - No CORS issues (same-origin request)                     ║
 * ║   - Works for any domain, including small/private ones       ║
 * ║   - crt.sh has CT log gaps and frequent timeouts             ║
 * ║                                                              ║
 * ║  BATCH MODE (v2.0.0)                                         ║
 * ║  Supports checking multiple domains in a single HTTP request ║
 * ║  to avoid 34 separate browser→PHP calls.                     ║
 * ║                                                              ║
 * ║  Single:  GET /ssl-check.php?domain=example.com              ║
 * ║  Batch:   GET /ssl-check.php?domains=a.com,b.com,c.com       ║
 * ║                                                              ║
 * ║  Response:                                                   ║
 * ║  Single: {"domain":"…","expiry":"2026-06-06","issuer":"LE",  ║
 * ║           "days_remaining":76}                               ║
 * ║  Batch:  [{"domain":"…","expiry":"…"},{"domain":"…",...}]    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

/* ── Output headers ─────────────────────────────────────────── */
header('Content-Type: application/json');
header('Cache-Control: public, max-age=3600'); /* cert rarely changes within an hour */
header('Access-Control-Allow-Origin: *');

/* ── Helper: validate a hostname ────────────────────────────── */
function is_valid_hostname(string $h): bool {
    return (bool) preg_match('/^[a-zA-Z0-9\.\-]{1,253}$/', $h)
        && str_contains($h, '.');
}

/**
 * Connect to port 443 and return cert metadata, or an error string.
 *
 * @param  string $domain
 * @param  int    $timeout  seconds
 * @return array  keys: domain, expiry, issuer, days_remaining, valid | error
 */
function check_ssl(string $domain, int $timeout = 8): array {
    $domain = strtolower(trim($domain));

    $context = stream_context_create([
        'ssl' => [
            'capture_peer_cert' => true,
            'verify_peer'       => false, /* want data even for expired/misconfigured certs */
            'verify_peer_name'  => false,
            'SNI_enabled'       => true,
            'peer_name'         => $domain,
        ]
    ]);

    $stream = @stream_socket_client(
        'ssl://' . $domain . ':443',
        $errno, $errstr,
        $timeout,
        STREAM_CLIENT_CONNECT,
        $context
    );

    if (!$stream) {
        return ['domain' => $domain, 'error' => $errstr ?: 'Connection failed (errno '.$errno.')'];
    }

    $params = stream_context_get_params($stream);
    fclose($stream);

    $cert = $params['options']['ssl']['peer_certificate'] ?? null;
    if (!$cert) {
        return ['domain' => $domain, 'error' => 'No certificate in handshake'];
    }

    $info = openssl_x509_parse($cert);
    if (!$info) {
        return ['domain' => $domain, 'error' => 'Certificate parse failed'];
    }

    $validTo = $info['validTo_time_t'] ?? null;
    if (!$validTo) {
        return ['domain' => $domain, 'error' => 'No expiry date in certificate'];
    }

    /* Detect issuer — Let's Encrypt uses CN patterns R3, R10, R11, E5, E6, E7… */
    $cn    = $info['issuer']['CN'] ?? $info['issuer']['O'] ?? 'Unknown';
    $isLE  = stripos($cn, "let's encrypt") !== false
          || preg_match('/^[RE]\d+$/', $cn);
    $issuer = $isLE ? 'LE' : (strlen($cn) > 25 ? substr($cn, 0, 25) : $cn);

    $days = (int) round(($validTo - time()) / 86400);

    return [
        'domain'         => $domain,
        'expiry'         => date('Y-m-d', $validTo),
        'issuer'         => $issuer,
        'days_remaining' => $days,
        'valid'          => $days > 0,
    ];
}

/* ── Route: batch (preferred) ───────────────────────────────── */
if (!empty($_GET['domains'])) {
    $raw     = $_GET['domains'];
    $parts   = array_slice(explode(',', $raw), 0, 50); /* cap at 50 domains per request */
    $results = [];

    foreach ($parts as $raw_domain) {
        $domain = strtolower(trim($raw_domain));
        if (!is_valid_hostname($domain)) {
            $results[] = ['domain' => $domain, 'error' => 'Invalid hostname'];
            continue;
        }
        $results[] = check_ssl($domain);
    }

    echo json_encode($results);
    exit;
}

/* ── Route: single domain ───────────────────────────────────── */
$domain = strtolower(trim($_GET['domain'] ?? ''));

if (!$domain || !is_valid_hostname($domain)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing or invalid domain parameter']);
    exit;
}

/* Simple per-domain rate limit: max 1 check/domain/2s */
$rateFile = sys_get_temp_dir() . '/ase_ssl_' . md5($domain) . '.rate';
if (file_exists($rateFile) && (time() - filemtime($rateFile)) < 2) {
    /* Return cached error rather than 429 — browser won't retry */
    echo json_encode(['domain' => $domain, 'error' => 'rate_limited']);
    exit;
}
@touch($rateFile);

echo json_encode(check_ssl($domain));
