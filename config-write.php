<?php
/**
 * config-write.php — All-Seeing-Eye configuration persistence endpoint
 *
 * Reads and writes ase_config.json in the same directory.
 * Called by the browser to persist settings (PIN hash, theme, custom domains)
 * across sessions — including incognito — without relying on localStorage
 * or attempting to rewrite index.html via HTTP PUT.
 *
 * ase_config.json schema:
 * {
 *   "pin_hash":        "sha256_hex_string",   // 64 hex chars
 *   "theme":           "light" | "dark",      // default theme preference
 *   "custom_domains":  ["dom1.com", ...],     // domains added via UI
 *   "notify_enabled":     true | false,           // email notifications on/off
 *   "notify_from":      "from@example.com",       // sender email (Resend verified)
 *   "notify_to":        "to@example.com",         // recipient email
 *   "notify_api_key_enc": "base64...",            // AES-256-GCM encrypted Resend key
 *   "notify_last_sent":  {"domain:type": timestamp_ms, ...}, // cooldown persistence
 *   "updated_at":       "ISO 8601 timestamp"
 * }
 *
 * Endpoints:
 *   GET  config-write.php           → returns current ase_config.json (or {})
 *   POST config-write.php           → merges posted JSON into ase_config.json
 *
 * Security:
 *   - Only hex PIN hashes accepted (64-char [a-f0-9])
 *   - Theme must be "light" or "dark"
 *   - Domain names validated against RFC-1123 hostname pattern
 *   - Max 200 custom domains
 *   - File locked during write (LOCK_EX) to prevent race conditions
 *   - CORS header allows same-origin only (no wildcard)
 *
 * Usage (JavaScript):
 *   // Read config
 *   const cfg = await fetch('./config-write.php').then(r => r.json());
 *
 *   // Write config (partial update — only send fields you want to change)
 *   await fetch('./config-write.php', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ pin_hash: newHash })
 *   });
 *
 * @version 2.1.0
 * @author  Paul Fleury / Perplexity Computer
 */

header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

/* ── Config file path ── */
define('CONFIG_FILE', __DIR__ . '/ase_config.json');

/* ── Helpers ── */

/**
 * Read and decode ase_config.json.
 * Returns an array (never false/null — falls back to []).
 */
function readConfig() {
    if (!file_exists(CONFIG_FILE)) return [];
    $raw = file_get_contents(CONFIG_FILE);
    if ($raw === false) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Write $config to ase_config.json atomically using a temp file.
 * Uses LOCK_EX to prevent concurrent writes.
 *
 * @param array $config
 * @return bool
 */
function writeConfig(array $config) {
    $config['updated_at'] = gmdate('c'); // ISO 8601 UTC
    $json = json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    /* Write to a temp file then rename — atomic on POSIX systems */
    $tmp = CONFIG_FILE . '.tmp.' . getmypid();
    $fp = fopen($tmp, 'w');
    if (!$fp) return false;
    if (!flock($fp, LOCK_EX)) { fclose($fp); unlink($tmp); return false; }
    fwrite($fp, $json);
    flock($fp, LOCK_UN);
    fclose($fp);
    return rename($tmp, CONFIG_FILE);
}

/**
 * Validate a SHA-256 hex hash (exactly 64 lowercase hex chars).
 */
function isValidHash($h) {
    return is_string($h) && preg_match('/^[a-f0-9]{64}$/', $h);
}

/**
 * Validate a domain name (hostname, RFC-1123).
 * Allows a-z, A-Z, 0-9, hyphens, dots. Between 3 and 253 chars.
 */
function isValidDomain($d) {
    return is_string($d)
        && strlen($d) >= 3
        && strlen($d) <= 253
        && preg_match('/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/', $d);
}

/* ── Routing ── */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    /* Return the current config */
    echo json_encode(readConfig(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($method === 'POST') {
    /* Read and decode posted body */
    $body = file_get_contents('php://input');
    $posted = json_decode($body, true);

    if (!is_array($posted)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON body']);
        exit;
    }

    /* Load existing config to merge into */
    $config = readConfig();
    $changed = false;

    /* ── PIN hash ── */
    if (isset($posted['pin_hash'])) {
        if (!isValidHash($posted['pin_hash'])) {
            http_response_code(400);
            echo json_encode(['error' => 'pin_hash must be a 64-char lowercase hex SHA-256 hash']);
            exit;
        }
        $config['pin_hash'] = $posted['pin_hash'];
        $changed = true;
    }

    /* ── Theme ── */
    if (isset($posted['theme'])) {
        if (!in_array($posted['theme'], ['light', 'dark'], true)) {
            http_response_code(400);
            echo json_encode(['error' => 'theme must be "light" or "dark"']);
            exit;
        }
        $config['theme'] = $posted['theme'];
        $changed = true;
    }

    /* ── Custom domains ── */
    if (isset($posted['custom_domains'])) {
        if (!is_array($posted['custom_domains'])) {
            http_response_code(400);
            echo json_encode(['error' => 'custom_domains must be an array']);
            exit;
        }
        $domains = [];
        foreach ($posted['custom_domains'] as $d) {
            if (isValidDomain($d)) {
                $domains[] = strtolower(trim($d));
            }
        }
        /* Deduplicate and cap at 200 */
        $domains = array_slice(array_values(array_unique($domains)), 0, 200);
        $config['custom_domains'] = $domains;
        $changed = true;
    }

    /* ── Notification settings ── */
    if (isset($posted['notify_enabled'])) {
        $config['notify_enabled'] = (bool)$posted['notify_enabled'];
        $changed = true;
    }

    if (isset($posted['notify_from'])) {
        $from = filter_var(trim($posted['notify_from']), FILTER_VALIDATE_EMAIL);
        if (!$from) {
            http_response_code(400);
            echo json_encode(['error' => 'notify_from must be a valid email address']);
            exit;
        }
        $config['notify_from'] = $from;
        $changed = true;
    }

    if (isset($posted['notify_to'])) {
        $to = filter_var(trim($posted['notify_to']), FILTER_VALIDATE_EMAIL);
        if (!$to) {
            http_response_code(400);
            echo json_encode(['error' => 'notify_to must be a valid email address']);
            exit;
        }
        $config['notify_to'] = $to;
        $changed = true;
    }

    /* Resend API key — encrypted server-side before storing.
       The browser sends the plaintext key; this endpoint encrypts it
       using the same AES-256-GCM mechanism as notify.php. */
    if (isset($posted['notify_api_key'])) {
        $key = trim($posted['notify_api_key']);
        if (strlen($key) < 10) {
            http_response_code(400);
            echo json_encode(['error' => 'notify_api_key appears too short']);
            exit;
        }

        /* Load or create the server-side secret */
        $secretFile = __DIR__ . '/notify_secret.key';
        if (file_exists($secretFile)) {
            $secret = trim(file_get_contents($secretFile));
        } else {
            $secret = bin2hex(random_bytes(32));
            file_put_contents($secretFile, $secret);
            chmod($secretFile, 0600);
        }

        /* Encrypt using AES-256-GCM */
        $encKey  = hash('sha256', $secret, true);
        $iv      = random_bytes(12);
        $ciphertext = openssl_encrypt($key, 'aes-256-gcm', $encKey, OPENSSL_RAW_DATA, $iv, $tag);
        $config['notify_api_key_enc'] = base64_encode($iv . $tag . $ciphertext);
        $changed = true;
    }

    /* Allow clearing the API key */
    if (isset($posted['notify_api_key_clear']) && $posted['notify_api_key_clear'] === true) {
        unset($config['notify_api_key_enc']);
        $changed = true;
    }

    /* ── Notification send timestamps (cooldown persistence) ── */
    if (isset($posted['notify_last_sent'])) {
        if (!is_array($posted['notify_last_sent'])) {
            http_response_code(400);
            echo json_encode(['error' => 'notify_last_sent must be an object']);
            exit;
        }
        /* Validate: keys must be "domain:type" strings, values must be integers */
        $validTypes  = ['down', 'ssl_expiry', 'ssl_critical', 'dmarc_missing', 'dmarc_none', 'spf_missing'];
        $cleanSent   = [];
        foreach ($posted['notify_last_sent'] as $key => $ts) {
            if (!is_string($key) || !is_numeric($ts)) continue;
            $parts = explode(':', $key, 2);
            if (count($parts) !== 2) continue;
            $type = $parts[1];
            if (!in_array($type, $validTypes, true)) continue;
            $cleanSent[$key] = intval($ts);
        }
        $config['notify_last_sent'] = $cleanSent;
        $changed = true;
    }

    if (!$changed) {
        http_response_code(400);
        echo json_encode(['error' => 'No valid fields provided (pin_hash, theme, custom_domains, notify_*)']);
        exit;
    }

    if (!writeConfig($config)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to write config file — check directory write permissions']);
        exit;
    }

    echo json_encode(['ok' => true, 'updated_at' => $config['updated_at']]);
    exit;
}

/* Unsupported method */
http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
