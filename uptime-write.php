<?php
/**
 * uptime-write.php — All-Seeing-Eye uptime persistence endpoint
 *
 * Provides server-side storage for uptime history so records are shared
 * across all browsers and devices — not locked to a single browser cookie.
 *
 * uptime.json schema (one key per domain):
 * {
 *   "example.com": {
 *     "checks":    142,          // total DNS A-record checks performed
 *     "ups":       141,          // checks where domain resolved (was UP)
 *     "firstSeen": 1711062400000, // Unix ms timestamp of first check
 *     "lastDown":  1711065000000  // Unix ms timestamp of most recent DOWN, or null
 *   },
 *   ...
 * }
 *
 * Endpoints:
 *   GET  uptime-write.php           → returns current uptime.json (or {})
 *   POST uptime-write.php           → merges a single domain record
 *
 * POST body (JSON):
 * {
 *   "domain": "example.com",
 *   "checks":    5,        // delta to add to stored checks count
 *   "ups":       4,        // delta to add to stored ups count
 *   "firstSeen": 1711062400000,  // only written if not already stored
 *   "lastDown":  null | 1711065000000  // null = no downtime; timestamp = last DOWN
 * }
 *
 * Security:
 *   - Domain validated against RFC-1123
 *   - Numeric fields validated (non-negative integers)
 *   - Atomic write (temp file + rename, LOCK_EX)
 *   - Max 500 domains stored (trims least-checked)
 *   - uptime.json protected from direct access via .htaccess
 *
 * @version 3.1.0
 * @author  Paul Fleury
 */

header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

define('UPTIME_FILE', __DIR__ . '/uptime.json');
define('MAX_DOMAINS', 500);

/* ── Helpers ── */

function readUptime() {
    if (!file_exists(UPTIME_FILE)) return [];
    $raw = file_get_contents(UPTIME_FILE);
    if ($raw === false) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function writeUptime(array $data) {
    /* Trim to MAX_DOMAINS by least checks */
    if (count($data) > MAX_DOMAINS) {
        uasort($data, function($a, $b) {
            return ($a['checks'] ?? 0) - ($b['checks'] ?? 0);
        });
        $data = array_slice($data, -MAX_DOMAINS, MAX_DOMAINS, true);
    }

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    $tmp  = UPTIME_FILE . '.tmp.' . getmypid();
    $fp   = fopen($tmp, 'w');
    if (!$fp) return false;
    if (!flock($fp, LOCK_EX)) { fclose($fp); @unlink($tmp); return false; }
    fwrite($fp, $json);
    flock($fp, LOCK_UN);
    fclose($fp);
    return rename($tmp, UPTIME_FILE);
}

function isValidDomain($d) {
    return is_string($d)
        && strlen($d) >= 3
        && strlen($d) <= 253
        && preg_match('/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/', $d);
}

/* ── Routing ── */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    echo json_encode(readUptime());
    exit;
}

if ($method === 'POST') {
    $body   = file_get_contents('php://input');
    $posted = json_decode($body, true);

    if (!is_array($posted)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON body']);
        exit;
    }

    /* Validate domain */
    $domain = $posted['domain'] ?? null;
    if (!$domain || !isValidDomain($domain)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing or invalid domain']);
        exit;
    }
    $domain = strtolower(trim($domain));

    /* Validate numeric fields */
    $deltaChecks = intval($posted['checks'] ?? 0);
    $deltaUps    = intval($posted['ups']    ?? 0);
    if ($deltaChecks < 0 || $deltaUps < 0 || $deltaUps > $deltaChecks) {
        http_response_code(400);
        echo json_encode(['error' => 'checks/ups must be non-negative; ups <= checks']);
        exit;
    }

    $firstSeen = isset($posted['firstSeen']) ? intval($posted['firstSeen']) : null;
    $lastDown  = isset($posted['lastDown'])  ? ($posted['lastDown'] === null ? null : intval($posted['lastDown'])) : false;

    /* Merge into stored data */
    $data = readUptime();

    if (!isset($data[$domain])) {
        $data[$domain] = [
            'checks'    => 0,
            'ups'       => 0,
            'firstSeen' => $firstSeen ?? (time() * 1000),
            'lastDown'  => null
        ];
    }

    $rec = &$data[$domain];
    $rec['checks'] += $deltaChecks;
    $rec['ups']    += $deltaUps;

    /* firstSeen: only update if not already stored */
    if (!$rec['firstSeen'] && $firstSeen) {
        $rec['firstSeen'] = $firstSeen;
    }

    /* lastDown: update if a new timestamp is provided (more recent wins) */
    if ($lastDown !== false && $lastDown !== null) {
        if ($rec['lastDown'] === null || $lastDown > $rec['lastDown']) {
            $rec['lastDown'] = $lastDown;
        }
    }

    if (!writeUptime($data)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to write uptime.json — check directory permissions']);
        exit;
    }

    echo json_encode([
        'ok'     => true,
        'domain' => $domain,
        'record' => $data[$domain]
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
