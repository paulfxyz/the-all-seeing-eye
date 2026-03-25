/*
 * The All Seeing Eye — app.js
 * All JavaScript for the dashboard.
 * Loaded by index.html via <script src="app.js"></script>
 */


/* ════════════════════════════════════════════════════════════════
   THE ALL SEEING EYE — Core JavaScript
   ════════════════════════════════════════════════════════════════

   ARCHITECTURE
   ─────────────────────────────────────────────────────────────
   1. SHA-256       — pure-JS hash for PIN verification (no crypto.subtle)
   2. PIN gate      — 6-digit PIN check via inline onclick attributes
   3. Theme switch  — dark/light toggle via checkbox, no storage needed
   4. Domain data   — BUILTIN top-50 list + TOOLTIPS for hover details
   5. Live state    — domainState{} holds up/latency/history per domain
   6. DNS checks    — Cloudflare DoH API (cloudflare-dns.com/dns-query)
   7. Render        — renderTable() builds the tbody HTML from DOMAINS[]
   8. Stats         — updateStats() refreshes the 5 header cards
   9. Add domain    — confirmAddDomains() adds + immediately checks new domains
  10. Export        — exportCSV() / saveDomainsStats() write data files
  11. Webhook       — checkWebhookMode() detects headless cron invocation
  12. Auto-refresh  — setInterval countdown, triggerRefresh() resets it

   KNOWN CHALLENGES SOLVED
   ─────────────────────────────────────────────────────────────
   • SHA-256 caching bug: function must be stateless (no sha256.h/k cache)
   • onclick vs addEventListener: sandboxed iframes block DOMContentLoaded;
     all interactive elements use inline onclick/oninput/onchange instead
   • PIN double-fire: only 'click' is used (not mousedown+touchstart+click)
   • Add domain flow: pendingQueue must be captured BEFORE clearing
   • Async initDashboard: PIN overlay hides BEFORE the async init starts,
     so the user sees the dashboard immediately even if checks take time
   ════════════════════════════════════════════════════════════════ */


/* ────────────────────────────────────────────────────────────────
   1. SHA-256 — stateless, recomputes primes each call
   No caching on the function object (that caused wrong hashes on repeat calls)
   ──────────────────────────────────────────────────────────────── */
function sha256(ascii) {
  /* Stateless SHA-256 — recomputes primes each call, no caching bug */
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  var maxWord = Math.pow(2, 32);
  var i, j, result = '', words = [];
  var asciiBitLength = ascii.length * 8;
  var hash = [], k = [], isComposite = {};
  for (var candidate = 2; hash.length < 8 || k.length < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      if (hash.length < 8)  hash.push((Math.pow(candidate, .5)   * maxWord) | 0);
      if (k.length   < 64) k.push(   (Math.pow(candidate, 1/3) * maxWord) | 0);
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 !== 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words.push(0, asciiBitLength);
  for (j = 0; j < words.length;) {
    var w = words.slice(j, j += 16);
    var oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var a = oldHash[0], e = oldHash[4];
      var temp1 = oldHash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & oldHash[5]) ^ (~e & oldHash[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (
            w[i-16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i-7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
      var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & oldHash[1]) ^ (a & oldHash[2]) ^ (oldHash[1] & oldHash[2]));
      oldHash = [temp1 + temp2 | 0, a, oldHash[1], oldHash[2],
                 oldHash[3] + temp1 | 0, e, oldHash[5], oldHash[6]];
    }
    for (i = 0; i < 8; i++) hash[i] = hash[i] + oldHash[i] | 0;
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}


/* ────────────────────────────────────────────────────────────────
   1b. SERVER-SIDE CONFIG  (ase_config.json via config-write.php)
   ─────────────────────────────────────────────────────────────────
   Provides persistent, server-side storage for settings that must
   survive across browsers, incognito sessions, and devices.

   Fields stored in ase_config.json:
     • pin_hash        — SHA-256 of the current PIN (overrides hardcoded value)
     • theme           — "light" | "dark" default preference
     • custom_domains  — array of user-added domain names

   Strategy:
     1. On page load,  loadConfig() fetches ase_config.json (if present).
        If pin_hash differs from the in-memory default → override PIN_HASH.
     2. After any PIN change, saveConfig({pin_hash: newHash}) posts to
        config-write.php — no HTTP PUT to index.html, no fragile file rewrite.
     3. Cookie fallback: pin_hash is ALSO stored in ase_pin cookie so that
        even if config-write.php is unavailable, the hash persists for the
        current browser (but not across browsers/incognito).

   Why not localStorage?
     localStorage is blocked in sandboxed iframes (Perplexity preview, etc.)
     Cookies work in all contexts. ase_config.json works across all devices.
   ──────────────────────────────────────────────────────────────── */

/** In-memory config (merged from ase_config.json + cookie on startup) */
var _asmConfig = {};

/**
 * Fetch ase_config.json and apply any stored overrides.
 * Called ONCE at startup, before the PIN overlay is shown.
 * Returns a Promise that resolves when config is applied.
 */
async function loadConfig() {
  /* 1. Try cookie first (instant, no network) */
  var cookieHash = _readPinCookie();
  if (cookieHash) {
    PIN_HASH = cookieHash;
  }

  /* 2. Load uptime data from server in parallel with config */
  var uptimePromise = uptimeLoad();

  /* 3. Try server config (authoritative, works across devices/incognito) */
  try {
    var res = await fetch('./config-write.php', { cache: 'no-cache' });
    if (res.ok) {
      var cfg = await res.json();
      _asmConfig = cfg;

      /* Apply PIN hash if present and valid */
      if (cfg.pin_hash && /^[a-f0-9]{64}$/.test(cfg.pin_hash)) {
        PIN_HASH = cfg.pin_hash;
        _writePinCookie(cfg.pin_hash); /* keep cookie in sync */
      }

      /* Apply theme preference */
      if (cfg.theme === 'dark' || cfg.theme === 'light') {
        var cb = document.getElementById('theme-checkbox');
        document.documentElement.setAttribute('data-theme', cfg.theme);
        if (cb) cb.checked = (cfg.theme === 'light');
      }

      /* Apply notification config */
      applyNotifyConfig(cfg);

      /* Restore notification send timestamps (cooldown persistence) */
      _notifyLoadState(cfg);
    }
  } catch(e) {
    /* config-write.php unavailable (static host, permissions) — silently continue */
  }

  /* Wait for uptime load to complete */
  await uptimePromise;
}

/**
 * Persist a partial config update to config-write.php.
 * Only the provided fields are updated; others remain unchanged.
 *
 * @param {Object} partial  e.g. { pin_hash: '...' } or { theme: 'dark' }
 * @returns {Promise<boolean>}  true if saved to server
 */
async function saveConfig(partial) {
  try {
    var res = await fetch('./config-write.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial)
    });
    return res.ok;
  } catch(e) {
    return false;
  }
}

/* ── PIN cookie helpers (fallback persistence for PIN hash) ── */

/** Read the ase_pin cookie. Returns the 64-char hash or null. */
function _readPinCookie() {
  var m = document.cookie.match(/(?:^|; )ase_pin=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

/** Write the ase_pin cookie (1-year expiry, SameSite=Lax). */
function _writePinCookie(hash) {
  document.cookie = 'ase_pin=' + hash + '; max-age=31536000; path=/; SameSite=Lax';
}


/* ────────────────────────────────────────────────────────────────
   2. PIN GATE
   PIN "123456" → stored as SHA-256 hash only. Never plaintext.
   Buttons use onclick attributes (set in HTML) — no event listeners.
   Physical keyboard also works via the keydown handler below.
   ──────────────────────────────────────────────────────────────── */
var PIN_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';
var pinBuffer = '';

function pinUpdateDots(mode) {
  for (var i = 0; i < 6; i++) {
    var dot = document.getElementById('dot-' + i);
    if (!dot) continue;
    dot.className = 'pin-dot';
    if (mode === 'error')      dot.classList.add('error');
    else if (i < pinBuffer.length) dot.classList.add('filled');
  }
}

/* Called by onclick="pinDigit('N')" on each numpad button */
function pinDigit(d) {
  if (pinBuffer.length >= 6) return;
  pinBuffer += String(d);
  pinUpdateDots('normal');
  document.getElementById('pin-error').textContent = '';
  if (pinBuffer.length === 6) setTimeout(pinCheck, 150);
}

function pinDelete() {
  pinBuffer = pinBuffer.slice(0, -1);
  pinUpdateDots('normal');
  document.getElementById('pin-error').textContent = '';
}

function pinCheck() {
  if (sha256(pinBuffer) === PIN_HASH) {
    var overlay = document.getElementById('pin-overlay');
    overlay.classList.add('unlocking');
    /* Hide overlay immediately, then start loading data in background */
    setTimeout(function() {
      overlay.style.display = 'none';
      checkFirstUse(); /* check if default PIN — may show set-PIN modal */
    }, 320);
  } else {
    pinUpdateDots('error');
    document.getElementById('pin-error').textContent = 'Incorrect PIN — try again';
    setTimeout(function() { pinBuffer = ''; pinUpdateDots('normal'); }, 700);
  }
}

/* Keyboard support for the SET-PIN modal */
document.addEventListener('keydown', function(e) {
  var spOverlay = document.getElementById('set-pin-overlay');
  if (spOverlay && spOverlay.style.display === 'flex') {
    if (e.key >= '0' && e.key <= '9') { spDigit(e.key); return; }
    if (e.key === 'Backspace') { e.preventDefault(); spDelete(); return; }
  }
});

/* Keyboard support for the LOGIN PIN entry */
document.addEventListener('keydown', function(e) {
  var overlay = document.getElementById('pin-overlay');
  if (!overlay || overlay.style.display === 'none') return;
  if (e.key >= '0' && e.key <= '9') pinDigit(e.key);
  if (e.key === 'Backspace') { e.preventDefault(); pinDelete(); }
  if (e.key === 'Enter' && pinBuffer.length === 6) pinCheck();
});


/* ────────────────────────────────────────────────────────────────
   3. THEME SWITCH
   checkbox unchecked = dark mode, checked = light mode.
   Defaults to light (v2.0.2+). loadConfig() may override with server preference.
   Theme changes are persisted to ase_config.json via saveConfig().
   ──────────────────────────────────────────────────────────────── */
(function() {
  document.documentElement.setAttribute('data-theme', 'light');
  var cb = document.getElementById('theme-checkbox');
  if (cb) {
    cb.checked = true; /* checked = light mode */
    cb.addEventListener('change', function() {
      var theme = this.checked ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      /* Persist theme preference to server config */
      saveConfig({ theme: theme });
    });
  }
})();


/* ────────────────────────────────────────────────────────────────
   4. DOMAIN DATA — built-in top-50 seed + tooltip details
   When domains.list is present on the server, this is replaced.
   If the file is missing or unreadable, BUILTIN is used as fallback.
   ──────────────────────────────────────────────────────────────── */
var BUILTIN = [
  { rank:1,  domain:'google.com',        cat:'search',  sslExpiry:'2026-05-18', ns:'Google',    mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:2,  domain:'youtube.com',       cat:'video',   sslExpiry:'2026-05-18', ns:'Google',    mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:3,  domain:'facebook.com',      cat:'social',  sslExpiry:'2026-03-30', ns:'Domain',       mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:4,  domain:'instagram.com',     cat:'social',  sslExpiry:'2026-03-30', ns:'Domain',       mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:5,  domain:'chatgpt.com',       cat:'ai',      sslExpiry:'2026-06-06', ns:'Cloudflare',mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:6,  domain:'x.com',            cat:'social',  sslExpiry:'2026-05-02', ns:'Own',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:7,  domain:'reddit.com',        cat:'social',  sslExpiry:'2026-05-22', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:8,  domain:'wikipedia.org',     cat:'content', sslExpiry:'2026-05-07', ns:'Wikimedia', mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:9,  domain:'whatsapp.com',      cat:'comm',    sslExpiry:'2026-03-30', ns:'Domain',       mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:10, domain:'bing.com',          cat:'search',  sslExpiry:'2026-08-01', ns:'Azure',     mxType:'Microsoft',  dmarc:'reject',     spf:'~all', custom:false },
  { rank:11, domain:'tiktok.com',        cat:'video',   sslExpiry:'2026-06-15', ns:'Akamai',    mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:12, domain:'amazon.com',        cat:'shop',    sslExpiry:'2027-01-23', ns:'Own',       mxType:'Amazon SES', dmarc:'reject',     spf:'~all', custom:false },
  { rank:13, domain:'yahoo.com',         cat:'news',    sslExpiry:'2026-08-26', ns:'Domain',       mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:14, domain:'linkedin.com',      cat:'social',  sslExpiry:'2026-09-19', ns:'NS1',       mxType:'Microsoft',  dmarc:'reject',     spf:'~all', custom:false },
  { rank:15, domain:'netflix.com',       cat:'video',   sslExpiry:'2027-02-18', ns:'AWS',       mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:16, domain:'duckduckgo.com',    cat:'search',  sslExpiry:'2026-12-20', ns:'NS1',       mxType:'Mimecast',   dmarc:'reject',     spf:'~all', custom:false },
  { rank:17, domain:'twitch.tv',         cat:'video',   sslExpiry:'2026-06-08', ns:'AWS',       mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:18, domain:'github.com',        cat:'dev',     sslExpiry:'2026-06-03', ns:'Own',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:19, domain:'discord.com',       cat:'comm',    sslExpiry:'2026-06-02', ns:'Cloudflare',mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:20, domain:'microsoft.com',     cat:'product', sslExpiry:'2026-09-06', ns:'Azure',     mxType:'Microsoft',  dmarc:'reject',     spf:'~all', custom:false },
  { rank:21, domain:'apple.com',         cat:'product', sslExpiry:'2026-05-27', ns:'Domain',       mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:22, domain:'office.com',        cat:'product', sslExpiry:'2027-02-12', ns:'Azure',     mxType:'Microsoft',  dmarc:'reject',     spf:'~all', custom:false },
  { rank:23, domain:'temu.com',          cat:'shop',    sslExpiry:'2026-08-14', ns:'Azure',     mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:24, domain:'canva.com',         cat:'product', sslExpiry:'2026-12-17', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:25, domain:'spotify.com',       cat:'content', sslExpiry:'2026-12-08', ns:'Google',    mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:26, domain:'openai.com',        cat:'ai',      sslExpiry:'2026-04-23', ns:'Azure',     mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:27, domain:'cloudflare.com',    cat:'cloud',   sslExpiry:'2026-06-10', ns:'Domain',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:28, domain:'stackoverflow.com', cat:'dev',     sslExpiry:'2026-05-20', ns:'Cloudflare',mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:29, domain:'nytimes.com',       cat:'news',    sslExpiry:'2026-09-13', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:30, domain:'pinterest.com',     cat:'social',  sslExpiry:'2026-08-23', ns:'Domain',       mxType:'Own',        dmarc:'quarantine', spf:'~all', custom:false },
  { rank:31, domain:'zoom.us',            cat:'comm',    sslExpiry:'2026-11-12', ns:'AWS',       mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:32, domain:'salesforce.com',     cat:'product', sslExpiry:'2026-07-30', ns:'AWS',       mxType:'Microsoft',  dmarc:'reject',     spf:'~all', custom:false },
  { rank:33, domain:'paypal.com',         cat:'finance', sslExpiry:'2026-10-14', ns:'Domain',    mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:34, domain:'ebay.com',           cat:'shop',    sslExpiry:'2026-08-05', ns:'AWS',       mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:35, domain:'wordpress.com',      cat:'content', sslExpiry:'2026-07-22', ns:'Domain',    mxType:'Own',        dmarc:'quarantine', spf:'~all', custom:false },
  { rank:36, domain:'adobe.com',          cat:'product', sslExpiry:'2026-10-09', ns:'Akamai',    mxType:'Own',        dmarc:'reject',     spf:'~all', custom:false },
  { rank:37, domain:'dropbox.com',        cat:'cloud',   sslExpiry:'2026-09-18', ns:'AWS',       mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:38, domain:'shopify.com',        cat:'shop',    sslExpiry:'2026-06-25', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:39, domain:'tesla.com',          cat:'product', sslExpiry:'2026-11-03', ns:'AWS',       mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:40, domain:'airbnb.com',         cat:'travel',  sslExpiry:'2026-12-01', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:41, domain:'uber.com',           cat:'travel',  sslExpiry:'2026-08-19', ns:'AWS',       mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:42, domain:'twitter.com',        cat:'social',  sslExpiry:'2026-05-02', ns:'Domain',    mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:43, domain:'twilio.com',         cat:'dev',     sslExpiry:'2026-10-22', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:44, domain:'stripe.com',         cat:'finance', sslExpiry:'2026-07-08', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:45, domain:'notion.so',          cat:'product', sslExpiry:'2026-09-27', ns:'Cloudflare',mxType:'Google',     dmarc:'quarantine', spf:'~all', custom:false },
  { rank:46, domain:'slack.com',          cat:'comm',    sslExpiry:'2026-11-30', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:47, domain:'atlassian.com',      cat:'dev',     sslExpiry:'2026-08-14', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:48, domain:'hubspot.com',        cat:'product', sslExpiry:'2026-10-05', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:49, domain:'figma.com',          cat:'dev',     sslExpiry:'2026-07-14', ns:'Cloudflare',mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
  { rank:50, domain:'vercel.com',         cat:'dev',     sslExpiry:'2026-09-02', ns:'AWS',       mxType:'Google',     dmarc:'reject',     spf:'~all', custom:false },
];



var TOOLTIPS = {
  'google.com':        { ns:'ns1–4.google.com',                            mx:'aspmx.l.google.com (pri 1)',                dmarc:'v=DMARC1; p=reject; rua=mailto:mailauth-reports@google.com', spf:'v=spf1 include:_spf.google.com ~all' },
  'youtube.com':       { ns:'ns1–4.google.com',                            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject',                                         spf:'v=spf1 include:_spf.google.com ~all' },
  'facebook.com':      { ns:'a/b/c/d.ns.facebook.com',                     mx:'smtpin.vvv.facebook.com',                   dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@fb.com',                spf:'v=spf1 include:spf.facebook.com ~all' },
  'instagram.com':     { ns:'a/b/c/d.ns.instagram.com',                    mx:'smtpin.vvv.facebook.com',                   dmarc:'v=DMARC1; p=reject',                                         spf:'v=spf1 include:_spf.facebook.com ~all' },
  'chatgpt.com':       { ns:'hassan.ns.cloudflare.com / vera.ns.cloudflare.com', mx:'aspmx.l.google.com',                  dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'x.com':             { ns:'b/c.r10.twtrdns.net',                         mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@twitter.com',           spf:'v=spf1 include:_spf.google.com ~all' },
  'reddit.com':        { ns:'ns-378.awsdns-47.com + 3 others',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; pct=100',                                spf:'v=spf1 include:_spf.google.com ~all' },
  'wikipedia.org':     { ns:'ns0/1/2.wikimedia.org',                       mx:'mx1001.wikimedia.org',                      dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@wikimedia.org',         spf:'v=spf1 include:wikimedia.org ~all' },
  'whatsapp.com':      { ns:'a/b/c/d.ns.whatsapp.net',                     mx:'mx.whatsapp.com',                           dmarc:'v=DMARC1; p=reject',                                         spf:'v=spf1 include:_spf.facebook.com ~all' },
  'bing.com':          { ns:'ns2-204.azure-dns.net + 3 others',            mx:'bing-com.mail.protection.outlook.com',      dmarc:'v=DMARC1; p=reject; fo=1',                                   spf:'v=spf1 include:spf.protection.outlook.com ~all' },
  'tiktok.com':        { ns:'a12-66.akam.net + Akamai cluster',            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'amazon.com':        { ns:'ns1.amzndns.co.uk + 3 others',               mx:'amazon-smtp.amazon.com (SES)',              dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@amazon.com',            spf:'v=spf1 include:amazonses.com ~all' },
  'yahoo.com':         { ns:'ns1–5.yahoo.com',                             mx:'mta5.am0.yahoodns.net',                     dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc_y@yahoo-inc.com',       spf:'v=spf1 redirect=_spf.mail.yahoo.com' },
  'linkedin.com':      { ns:'dns1–4.p09.nsone.net',                        mx:'linkedin-com.mail.protection.outlook.com', dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@linkedin.com',          spf:'v=spf1 include:spf.protection.outlook.com ~all' },
  'netflix.com':       { ns:'ns-81.awsdns-10.com + 3 others',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; rua=mailto:dmarc@netflix.com',       spf:'v=spf1 include:_spf.google.com ~all' },
  'duckduckgo.com':    { ns:'dns1/2.p05.nsone.net',                        mx:'us-smtp-inbound-1.mimecast.com',            dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@duckduckgo.com',        spf:'v=spf1 include:spf.mimecast.com ~all' },
  'twitch.tv':         { ns:'ns-1450.awsdns-53.org + 3 others',           mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'github.com':        { ns:'ns-520.awsdns-01.net + 3 others',            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@github.com',            spf:'v=spf1 include:_spf.google.com ~all' },
  'discord.com':       { ns:'gabe.ns.cloudflare.com / roxy.ns.cloudflare.com', mx:'aspmx.l.google.com',                  dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'microsoft.com':     { ns:'ns3-39.azure-dns.org + 3 others',            mx:'microsoft-com.mail.protection.outlook.com',dmarc:'v=DMARC1; p=reject; fo=1',                                   spf:'v=spf1 include:spf.protection.outlook.com ~all' },
  'apple.com':         { ns:'a/b/c.ns.apple.com',                          mx:'mx.apple.com',                              dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc-rua@apple.com',         spf:'v=spf1 include:icloud.com ~all' },
  'office.com':        { ns:'ns2-05.azure-dns.net + 3 others',            mx:'office365.com mail.protection.outlook.com',dmarc:'v=DMARC1; p=reject; fo=1',                                   spf:'v=spf1 include:spf.protection.outlook.com ~all' },
  'temu.com':          { ns:'ns3-35.azure-dns.org + 3 others',            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'canva.com':         { ns:'ns-730.awsdns-27.net + 3 others',            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@canva.com',             spf:'v=spf1 include:_spf.google.com ~all' },
  'spotify.com':       { ns:'ns-cloud-a1–4.googledomains.com',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@spotify.com',           spf:'v=spf1 include:_spf.google.com ~all' },
  'openai.com':        { ns:'ns4-02.azure-dns.info + 3 others',           mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'cloudflare.com':    { ns:'ns3/4.cloudflare.com (self-hosted)',          mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@cloudflare.com',        spf:'v=spf1 include:_spf.google.com ~all' },
  'stackoverflow.com': { ns:'damian/dina.ns.cloudflare.com',               mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; pct=100',                                spf:'v=spf1 include:_spf.google.com ~all' },
  'nytimes.com':       { ns:'ns-1652.awsdns-14.co.uk + 3 others',        mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@nytimes.com',           spf:'v=spf1 include:_spf.google.com ~all' },
  'pinterest.com':     { ns:'ns1–5.pinterest.com',                         mx:'mx.pinterest.com',                          dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.pinterest.com ~all' },
  'zoom.us':           { ns:'ns-869.awsdns-44.net + 3 others',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'salesforce.com':    { ns:'ns1-04.azure-dns.com + 3 others',             mx:'salesforce-com.mail.protection.outlook.com',dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@salesforce.com',        spf:'v=spf1 include:_spf.salesforce.com ~all' },
  'paypal.com':        { ns:'ns1.p57.dynect.net + 3 others',               mx:'mx1.paypalcorp.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@paypal.com',            spf:'v=spf1 include:paypal.com ~all' },
  'ebay.com':          { ns:'ns1.p28.dynect.net + 3 others',               mx:'mx1.ebay.com',                              dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@ebay.com',              spf:'v=spf1 include:ebay.com ~all' },
  'wordpress.com':     { ns:'ns1–4.wordpress.com',                         mx:'mx1.wordpress.com',                         dmarc:'v=DMARC1; p=quarantine; rua=mailto:dmarc@wordpress.com',    spf:'v=spf1 include:_spf.wordpress.com ~all' },
  'adobe.com':         { ns:'a9-64.akam.net + Akamai cluster',             mx:'adobe-com.mail.protection.outlook.com',     dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@adobe.com',             spf:'v=spf1 include:spf.protection.outlook.com ~all' },
  'dropbox.com':       { ns:'ns1-204.awsdns-25.com + 3 others',            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; rua=mailto:dmarc@dropbox.com',       spf:'v=spf1 include:_spf.google.com ~all' },
  'shopify.com':       { ns:'ns-cloud-d1.googledomains.com + 3 others',    mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@shopify.com',           spf:'v=spf1 include:_spf.google.com ~all' },
  'tesla.com':         { ns:'ns1-03.azure-dns.com + 3 others',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'airbnb.com':        { ns:'ns-1260.awsdns-29.org + 3 others',            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@airbnb.com',            spf:'v=spf1 include:_spf.google.com ~all' },
  'uber.com':          { ns:'ns-1543.awsdns-00.co.uk + 3 others',          mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'twitter.com':       { ns:'b/c.r10.twtrdns.net',                         mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@twitter.com',           spf:'v=spf1 include:_spf.google.com ~all' },
  'twilio.com':        { ns:'ns-369.awsdns-46.com + 3 others',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@twilio.com',            spf:'v=spf1 include:_spf.google.com ~all' },
  'stripe.com':        { ns:'ns-cloud-b1.googledomains.com + 3 others',    mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@stripe.com',            spf:'v=spf1 include:_spf.google.com ~all' },
  'notion.so':         { ns:'noah.ns.cloudflare.com / linda.ns.cloudflare.com', mx:'aspmx.l.google.com',                   dmarc:'v=DMARC1; p=quarantine; pct=100',                            spf:'v=spf1 include:_spf.google.com ~all' },
  'slack.com':         { ns:'ns-393.awsdns-49.com + 3 others',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@slack.com',             spf:'v=spf1 include:_spf.google.com ~all' },
  'atlassian.com':     { ns:'ns1-105.awsdns-10.org + 3 others',            mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@atlassian.com',         spf:'v=spf1 include:_spf.google.com ~all' },
  'hubspot.com':       { ns:'ns-cloud-e1.googledomains.com + 3 others',    mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@hubspot.com',           spf:'v=spf1 include:_spf.google.com ~all' },
  'figma.com':         { ns:'jake.ns.cloudflare.com / kara.ns.cloudflare.com', mx:'aspmx.l.google.com',                    dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@figma.com',             spf:'v=spf1 include:_spf.google.com ~all' },
  'vercel.com':        { ns:'ns1-33.awsdns-04.com + 3 others',             mx:'aspmx.l.google.com',                        dmarc:'v=DMARC1; p=reject; rua=mailto:dmarc@vercel.com',            spf:'v=spf1 include:_spf.google.com ~all' },
};


/* ────────────────────────────────────────────────────────────────
   5. LIVE STATE
   DOMAINS[]      — the active list being monitored
   domainState{}  — live check results keyed by domain name
   pendingQueue[] — domains queued in the Add Domain modal
   refreshTimer   — countdown seconds until next auto-refresh
   activeFilter   — current filter: null | 'alerts' | 'up'
   ──────────────────────────────────────────────────────────────── */
var DOMAINS       = [];
var domainState   = {};
var pendingQueue  = [];
var refreshTimer  = 180;
var activeFilter  = null;
var _sslChecked   = {}; /* tracks which domains have had SSL fetched this session */
var DOH           = 'https://cloudflare-dns.com/dns-query?name=';


/* ────────────────────────────────────────────────────────────────
   UPTIME PERSISTENCE  (v3.1.0+)
   ─────────────────────────────────────────────────────────────
   Uptime data is stored server-side in uptime.json via uptime-write.php.
   This means ALL devices and browsers share the same history — checks from
   any visitor accumulate into one authoritative record.

   Architecture:
   1. On startup, uptimeLoad() fetches uptime.json from the server.
      Falls back to the ase_uptime cookie if the server is unavailable.
   2. After each checkDomain(), uptimeRecord() stores the result in memory
      AND queues a server write (debounced — fires once after all batch checks).
   3. uptimeSave() POSTs delta records to uptime-write.php. Also writes
      the cookie as a local fallback (survives server downtime).

   uptime.json format: { "domain.com": { checks, ups, firstSeen, lastDown } }
   Cookie fallback:    ase_uptime (same JSON, 4KB cap, 1-year expiry)
   ──────────────────────────────────────────────────────────────── */

var _uptimeData    = {};    /* in-memory map, loaded from server or cookie */
var _uptimeDelta   = {};    /* domains with pending writes since last save */
var _uptimeFromServer = false; /* true once server data is loaded */

/**
 * Load uptime data from server (uptime-write.php) with cookie fallback.
 * Called once at startup, before the first render.
 */
async function uptimeLoad() {
  /* 1. Try server (authoritative — shared across all devices) */
  try {
    var res = await fetch('./uptime-write.php', { cache: 'no-cache' });
    if (res.ok) {
      var data = await res.json();
      if (data && typeof data === 'object') {
        _uptimeData = data;
        _uptimeFromServer = true;
        return;
      }
    }
  } catch(e) { /* server unavailable — fall through to cookie */ }

  /* 2. Cookie fallback (single-device history) */
  try {
    var match = document.cookie.match(/(?:^|; )ase_uptime=([^;]*)/);
    if (match) {
      _uptimeData = JSON.parse(decodeURIComponent(match[1])) || {};
    }
  } catch(e) { _uptimeData = {}; }
}

/**
 * Save uptime data.
 * POSTs each delta record to uptime-write.php (server-side accumulation),
 * and also writes the full snapshot to the ase_uptime cookie as fallback.
 */
async function uptimeSave() {
  /* Server: POST only domains that changed this cycle (delta) */
  if (Object.keys(_uptimeDelta).length > 0) {
    var deltas = _uptimeDelta;
    _uptimeDelta = {};
    Object.keys(deltas).forEach(async function(domain) {
      var d = deltas[domain];
      try {
        await fetch('./uptime-write.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain:    domain,
            checks:    d.deltaChecks,
            ups:       d.deltaUps,
            firstSeen: _uptimeData[domain] ? _uptimeData[domain].firstSeen : Date.now(),
            lastDown:  _uptimeData[domain] ? _uptimeData[domain].lastDown  : null
          })
        });
      } catch(e) { /* server unavailable — cookie fallback below */ }
    });
  }

  /* Cookie: always write full snapshot as local fallback */
  try {
    var value = encodeURIComponent(JSON.stringify(_uptimeData));
    if (value.length > 3800) {
      var sorted = Object.keys(_uptimeData)
        .sort(function(a, b) { return (_uptimeData[b].checks||0) - (_uptimeData[a].checks||0); })
        .slice(0, 40);
      var trimmed = {};
      sorted.forEach(function(k) { trimmed[k] = _uptimeData[k]; });
      _uptimeData = trimmed;
      value = encodeURIComponent(JSON.stringify(_uptimeData));
    }
    document.cookie = 'ase_uptime=' + value + '; max-age=31536000; path=/; SameSite=Lax';
  } catch(e) {}
}

/** Record a check result for a domain */
/**
 * Record a single check result for a domain.
 * Updates in-memory data, marks delta for server sync, and detects
 * UP→DOWN transitions for email notifications.
 *
 * @param {string}  domain
 * @param {boolean} isUp    true = A record resolved; false = no response
 * @param {number|null} latency  round-trip ms or null
 */
function uptimeRecord(domain, isUp, latency) {
  var wasUp = _uptimeData[domain] ? (_uptimeData[domain].ups > 0 &&
    _uptimeData[domain].ups === _uptimeData[domain].checks) : null;

  if (!_uptimeData[domain]) {
    _uptimeData[domain] = { checks: 0, ups: 0, firstSeen: Date.now(), lastDown: null };
  }
  var rec = _uptimeData[domain];
  rec.checks++;
  if (isUp) {
    rec.ups++;
  } else {
    rec.lastDown = Date.now();
  }

  /* Track delta for server sync */
  if (!_uptimeDelta[domain]) _uptimeDelta[domain] = { deltaChecks: 0, deltaUps: 0 };
  _uptimeDelta[domain].deltaChecks++;
  if (isUp) _uptimeDelta[domain].deltaUps++;

  /* Detect UP→DOWN transition and trigger notification */
  if (wasUp === true && !isUp) {
    notifyDowntime(domain, 'DOWN', latency);
  }
  /* Detect DOWN→UP recovery */
  if (wasUp === false && isUp && rec.checks > 1) {
    notifyDowntime(domain, 'UP', latency);
  }
}

/** Get uptime percentage string for a domain */
function uptimePercent(domain) {
  var rec = _uptimeData[domain];
  if (!rec || rec.checks < 2) return null;
  return Math.round((rec.ups / rec.checks) * 1000) / 10; /* 1 decimal */
}

/** Get number of days since first check */
function uptimeDaysSince(domain) {
  var rec = _uptimeData[domain];
  if (!rec || !rec.firstSeen) return null;
  return Math.max(1, Math.round((Date.now() - rec.firstSeen) / 86400000));
}

/** Build tooltip HTML for the status cell */
function uptimeTooltipHTML(domain, currentState) {
  var rec = _uptimeData[domain];
  if (!rec || rec.checks < 2) {
    return '<div class="tooltip-box"><div class="tt-title">Uptime</div>' +
      '<div class="tt-row"><span class="tt-label">Status</span>' +
      '<span class="tt-val">Monitoring started — check again soon</span></div></div>';
  }
  var pct       = uptimePercent(domain);
  var days      = uptimeDaysSince(domain);
  var lastDownStr = rec.lastDown
    ? new Date(rec.lastDown).toLocaleDateString()
    : 'Never recorded';
  var color = pct >= 99 ? 'var(--green)' : pct >= 95 ? 'var(--yellow)' : 'var(--red)';
  return (
    '<div class="tooltip-box" style="min-width:200px">' +
      '<div class="tt-title">Uptime (this device)</div>' +
      '<div class="tt-row"><span class="tt-label">Uptime</span>' +
        '<span class="tt-val" style="color:' + color + ';font-weight:700">' + pct + '%</span></div>' +
      '<div class="tt-row"><span class="tt-label">Checks</span>' +
        '<span class="tt-val">' + rec.checks + ' checks over ' + days + ' day' + (days===1?'':'s') + '</span></div>' +
      '<div class="tt-row"><span class="tt-label">Last down</span>' +
        '<span class="tt-val">' + lastDownStr + '</span></div>' +
    '</div>'
  );
}

/* Load uptime data immediately */
/* uptimeLoad() is called async in bootstrap — see loadConfig() sequence */

/* Snapshot of the Refresh button's original HTML — captured at first use.
 * Used to restore the button after loading/countdown states. */
var REFRESH_BTN_ORIGINAL = null;
(function() {
  /* Run after DOM is ready (script is at end of body) */
  var btn = document.getElementById('btn-refresh');
  if (btn) REFRESH_BTN_ORIGINAL = btn.innerHTML;
})();


/* ────────────────────────────────────────────────────────────────
   6. HELPER FUNCTIONS
   ──────────────────────────────────────────────────────────────── */

/** Days from today to an ISO date string. Returns null if unknown. */
function daysUntil(iso) {
  if (!iso || iso === '2099-01-01') return null;
  return Math.round((new Date(iso) - new Date()) / 86400000);
}

/** CSS class for SSL days value */
function sslClass(days) {
  if (days === null)  return 'ssl-unknown';
  if (days < 0)       return 'ssl-expired';
  if (days < 14)      return 'ssl-urgent';
  if (days < 30)      return 'ssl-warn';
  return 'ssl-ok';
}

/** CSS class for latency in ms */
function latClass(ms) {
  if (ms === null || ms === undefined) return 'lat-none';
  if (ms < 120)  return 'lat-fast';
  if (ms < 400)  return 'lat-ok';
  return 'lat-slow';
}

/** Build sparkline bar HTML from a history array (last 10 entries) */
function sparklineHTML(history) {
  var arr = history.slice(-10);
  while (arr.length < 10) arr.unshift(null);
  return arr.map(function(v) {
    if (!v)      return '<span class="spark empty" style="height:6px"></span>';
    if (!v.up)   return '<span class="spark down"  style="height:18px"></span>';
    var h = Math.max(4, Math.min(18, 18 - Math.round((v.latency || 80) / 25)));
    return '<span class="spark" style="height:' + h + 'px"></span>';
  }).join('');
}

/** Build hover tooltip HTML for NS/MX/DMARC/SPF columns */
function tooltipHTML(domain, col) {
  var td = TOOLTIPS[domain];
  if (!td) return '';
  var TITLES = { ns:'Name Servers', mx:'Mail Exchange', dmarc:'DMARC Policy', spf:'SPF Record' };
  return (
    '<div class="tooltip-box">' +
      '<div class="tt-title">' + TITLES[col] + '</div>' +
      '<div class="tt-row"><span class="tt-label">Record</span>' +
      '<span class="tt-val">' + (td[col] || '—') + '</span></div>' +
    '</div>'
  );
}

/** Map NS provider name → badge CSS class */
function nsBadgeCls(ns) {
  var map = { 'Google':'ns-google','AWS':'ns-aws','Cloudflare':'ns-cf',
    'Azure':'ns-azure','NS1':'ns-nsone','Akamai':'ns-akamai',
    'Wikimedia':'ns-wiki','Own':'ns-own' };
  return map[ns] || 'ns-own';
}

/** Map MX provider name → badge CSS class */
function mxBadgeCls(mx) {
  var map = { 'Google':'mx-google','Microsoft':'mx-microsoft','ProtonMail':'mx-proton',
    'Amazon SES':'mx-amazon','Mimecast':'mx-mimecast','Own':'mx-own','None':'mx-none' };
  return map[mx] || 'mx-own';
}

var CAT_LABELS = {
  search:'Search', video:'Video', social:'Social', shop:'Shopping', ai:'AI',
  news:'News', dev:'Dev', content:'Content', cloud:'Cloud', comm:'Comms',
  product:'Product', custom:'Custom'
};


/* ────────────────────────────────────────────────────────────────
   7. RENDER TABLE
   Reads DOMAINS[] + domainState{}, applies search/sort/filter,
   and rewrites tbody innerHTML. Called after every state change.
   ──────────────────────────────────────────────────────────────── */
function renderTable() {
  var query  = ((document.getElementById('search-input') || {}).value || '').toLowerCase().trim();
  var sortBy = ((document.getElementById('sort-select')  || {}).value || 'rank');

  /* Filter */
  var rows = DOMAINS.filter(function(d) {
    if (query && d.domain.indexOf(query) < 0 && d.cat.indexOf(query) < 0) return false;
    if (activeFilter === 'up' && !(domainState[d.domain] || {}).up) return false;
    if (activeFilter === 'alerts') {
      var days = daysUntil(d.sslExpiry);
      if (days === null || days >= 30) return false;
    }
    return true;
  });

  /* Sort */
  rows.sort(function(a, b) {
    switch (sortBy) {
      case 'ssl': {
        var da = daysUntil(a.sslExpiry), db = daysUntil(b.sslExpiry);
        if (da === null) return 1; if (db === null) return -1;
        return da - db;
      }
      case 'latency': {
        var la = (domainState[a.domain] || {}).latency || 99999;
        var lb = (domainState[b.domain] || {}).latency || 99999;
        return la - lb;
      }
      case 'status': {
        var ua = (domainState[a.domain] || {}).up ? 1 : 0;
        var ub = (domainState[b.domain] || {}).up ? 1 : 0;
        return ub - ua;
      }
      case 'az': return a.domain.localeCompare(b.domain);
      default:   return a.rank - b.rank;
    }
  });

  /* Update domain count stat */
  var el = document.getElementById('stat-total');
  if (el) el.textContent = DOMAINS.length;

  /* Build rows HTML */
  var html = rows.map(function(d) {
    var st   = domainState[d.domain] || { up: null, latency: null, history: [] };
    var days = daysUntil(d.sslExpiry);

    var rankHTML    = d.custom ? '<span style="color:var(--accent)">★</span>' : d.rank;
    var dotCls      = st.up === null ? 'dot-unknown' : (st.up ? 'dot-up' : 'dot-down');
    var statusCls   = st.up === null ? '' : (st.up ? 'status-up' : 'status-down');
    var statusLabel = st.up === null ? '…' : (st.up ? 'UP' : 'DOWN');
    var latStr      = (st.latency !== null && st.latency !== undefined) ? st.latency + ' ms' : '—';
    /* SSL days string — null means not yet fetched (custom domain)
     * Negative means cert has already expired */
    var sslStr  = days === null ? '—' : (days < 0 ? 'EXPIRED' : days + ' d');
    /* Let's Encrypt badge — shown when issuer is 'LE' */
    var leBadge = (d.sslIssuer === 'LE')
      ? '<span class="le-badge">LE</span>' : '';
    var dmarcLabel  = { reject:'✓ reject', quarantine:'~ quarantine', none:'~ none', missing:'✗ missing' }[d.dmarc] || '—';
    // Both ~all (soft fail) and -all (hard fail) are valid SPF — display green.
    // The tooltip already shows the full SPF record for detail.
    var spfCls      = d.spf ? 'spf-pass' : 'spf-missing';
    var spfLabel    = d.spf ? '✓ ' + d.spf : '✗ missing';
    /* Per-row actions: refresh icon always, delete only for custom domains */
    var rowBtnId = 'rbtn-' + d.domain.replace(/\./g,'-');
    var refreshRowBtn = '<button id="' + rowBtnId + '" class="row-refresh-btn" ' +
      'onclick="refreshRow(\'' + d.domain + '\',this)" title="Re-scan this domain">↺</button>';
    var delCell = '<td class="td-actions">' + refreshRowBtn +
      (d.custom ? '<button class="del-btn" onclick="deleteDomain(\'' + d.domain + '\')" title="Remove">✕</button>' : '') +
      '</td>';

    return (
      '<tr' + (d.custom ? ' class="is-custom"' : '') + ' data-domain="' + d.domain + '">' +
      '<td class="td-rank">'  + rankHTML + '</td>' +
      '<td><div class="domain-cell">' +
        '<div class="favicon-wrap"><img src="https://www.google.com/s2/favicons?domain=' + d.domain + '&sz=32" ' +
          'width="18" height="18" loading="lazy" alt="" onerror="this.style.opacity=0"></div>' +
        '<a class="domain-link" href="https://' + d.domain + '" target="_blank" rel="noopener">' + d.domain + '</a>' +
      '</div></td>' +

      '<td><div class="status-cell">' +
        '<div class="tooltip-host">' +
          '<div style="display:flex;align-items:center;gap:var(--space-2)">' +
            '<span class="status-dot ' + dotCls + '"></span>' +
            '<span class="status-label ' + statusCls + '">' + statusLabel + '</span>' +
            '<div class="sparkline">' + sparklineHTML(st.history) + '</div>' +
          '</div>' +
          uptimeTooltipHTML(d.domain, st.up) +
        '</div>' +
      '</div></td>' +
      '<td class="latency ' + latClass(st.latency) + '">' + latStr + '</td>' +
      '<td><div class="ssl-cell"><span class="ssl-days ' + sslClass(days) + '">' + sslStr + '</span>' + leBadge + '</div></td>' +
      '<td class="info-cell"><div class="tooltip-host"><span class="info-badge ' + nsBadgeCls(d.ns) + '">'   + d.ns    + '</span>' + tooltipHTML(d.domain,'ns')    + '</div></td>' +
      '<td class="info-cell"><div class="tooltip-host"><span class="info-badge ' + mxBadgeCls(d.mxType) + '">'+ d.mxType+ '</span>' + tooltipHTML(d.domain,'mx')    + '</div></td>' +
      '<td class="info-cell"><div class="tooltip-host"><span class="info-badge dmarc-' + d.dmarc + '">'    + dmarcLabel+ '</span>' + tooltipHTML(d.domain,'dmarc')  + '</div></td>' +
      '<td class="info-cell"><div class="tooltip-host"><span class="info-badge ' + spfCls + '">'           + spfLabel  + '</span>' + tooltipHTML(d.domain,'spf')    + '</div></td>' +
      delCell +
      '</tr>'
    );
  }).join('');

  var tbody = document.getElementById('table-body');
  if (tbody) tbody.innerHTML = html;
}

/** Delete a custom domain from the list */
function deleteDomain(domain) {
  DOMAINS = DOMAINS.filter(function(d) { return d.domain !== domain; });
  delete domainState[domain];
  renderTable();
  updateStats();
}

/** Recompute and display the 5 stat cards + SSL alert banner */
function updateStats() {
  var online  = DOMAINS.filter(function(d) { return (domainState[d.domain]||{}).up === true; }).length;
  var sslOK   = DOMAINS.filter(function(d) { var days = daysUntil(d.sslExpiry); return days !== null && days >= 30; }).length;
  var alerts  = DOMAINS.filter(function(d) { var days = daysUntil(d.sslExpiry); return days !== null && days >= 0 && days < 30; }).length;
  var lats    = DOMAINS.map(function(d) { return (domainState[d.domain]||{}).latency; }).filter(function(x) { return x != null; });
  var avg     = lats.length ? Math.round(lats.reduce(function(a,b){return a+b;},0)/lats.length) : null;

  function set(id, val) { var el=document.getElementById(id); if(el) el.textContent=val; }
  set('stat-total',   DOMAINS.length);
  set('stat-online',  online);
  set('stat-ssl-ok',  sslOK);
  set('stat-alerts',  alerts);
  set('stat-latency', avg ? avg + ' ms' : '—');

  /* Show/hide SSL alert banner */
  var expiring = DOMAINS.filter(function(d) { var days=daysUntil(d.sslExpiry); return days!==null&&days>=0&&days<30; });
  var banner = document.getElementById('alert-banner');
  if (!banner) return;
  if (expiring.length) {
    var txt = document.getElementById('alert-text');
    if (txt) txt.innerHTML = '<strong>SSL expiring soon:</strong> ' +
      expiring.map(function(d){ return '<strong>'+d.domain+'</strong> ('+daysUntil(d.sslExpiry)+'d)'; }).join(' · ') +
      ' — These are high-traffic domains; certs auto-renew in production.';
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

/** Toggle active filter; called by filter button onclick */
function toggleFilter(type) {
  activeFilter = (activeFilter === type) ? null : type;
  var fa = document.getElementById('filter-alerts');
  var fu = document.getElementById('filter-up');
  if (fa) fa.classList.toggle('active', activeFilter === 'alerts');
  if (fu) fu.classList.toggle('active', activeFilter === 'up');
  renderTable();
}


/* ────────────────────────────────────────────────────────────────
   8. LIVE DNS CHECKS via Cloudflare DoH
   Each check fires a JSON HTTPS request to cloudflare-dns.com.
   No CORS issues, no rate limits for reasonable usage.
   Timeout: 6s per domain. Results update domainState immediately.
   ──────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────
   RATE LIMITER + ANTI-SPAM
   ─────────────────────────────────────────────────────────────
   Challenge: if a user hammers Refresh or adds many domains at
   once, we'd fire hundreds of DNS queries in seconds and hit
   Cloudflare DoH rate limits (or look like abuse).

   Solution:
   • Global "is a check running?" flag — blocks overlapping runs.
   • Minimum gap of 10s between full checkAll() calls.
   • Per-row refresh is rate-limited to 5s per domain.
   • DNS queries are staggered in small batches (5 at a time)
     rather than all-at-once to avoid burst flooding.
   ──────────────────────────────────────────────────────────────── */
var _checkRunning   = false;   /* true while a full checkAll() is in progress */
var _manualRefresh  = false;   /* true when user clicked Refresh (vs auto-refresh) */
var _lastCheckAll   = 0;       /* timestamp of last full run */
var _domainLastCheck = {};     /* timestamp of last per-domain check */
var CHECK_ALL_MIN_GAP  = 5000;   /* 5s minimum between full refreshes */  /* ms — minimum gap between full refreshes */
var CHECK_ROW_MIN_GAP  = 5000;   /* ms — minimum gap for per-row refresh */
var DNS_BATCH_SIZE     = 5;      /* domains per concurrent batch */
var DNS_BATCH_DELAY    = 300;    /* ms between batches */

/** Helper: sleep for N milliseconds */
function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

/** Helper: query Cloudflare DoH for a given domain + record type.
 *  Returns the Answer array, or [] on error. */
async function dohQuery(domain, type) {
  try {
    var res = await fetch(DOH + encodeURIComponent(domain) + '&type=' + type, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(6000)
    });
    var j = await res.json();
    return (j && j.Answer) ? j.Answer : [];
  } catch(e) {
    return [];
  }
}

/** Detect NS provider from nameserver hostname */
/**
 * Detect NS provider from nameserver hostname records.
 *
 * Strategy:
 * 1. Check well-known provider patterns (AWS, Cloudflare, etc.)
 * 2. Check SiteGround explicitly (very common shared host)
 * 3. If all NS hostnames share their apex domain with the monitored
 *    domain itself, label it "Domain" — e.g. apple.com using a.ns.apple.com
 * 4. If NS is a subdomain of the monitored domain (ns1.yourdomain.com),
 *    extract and capitalise the apex domain name — e.g. "Yourdomain"
 *
 * @param {Array}  nsRecords — DoH Answer records for NS query
 * @param {string} domain    — the domain being monitored (for self-NS detection)
 * @returns {string} Human-readable provider name
 */
function detectNSProvider(nsRecords, domain) {
  if (!nsRecords || nsRecords.length === 0) return '—';

  /* Collect all NS hostnames (lowercase, strip trailing dot) */
  var hosts = nsRecords.map(function(r) {
    return (r.data || '').toLowerCase().replace(/\.$/, '');
  });
  var all = hosts.join(' ');

  /* ── Well-known commercial providers ── */
  if (all.includes('awsdns'))                             return 'AWS';
  if (all.includes('azure-dns') || all.includes('azure-dns'))  return 'Azure';
  if (all.includes('googledomains') || all.includes('google.com') || all.includes('ns-cloud')) return 'Google';
  if (all.includes('nsone.net') || /\.p\d{2}\.nsone/.test(all)) return 'NS1';
  if (all.includes('akam.net') || all.includes('akamai')) return 'Akamai';
  if (all.includes('wikimedia'))                          return 'Wikimedia';
  if (all.includes('cloudns.net'))                        return 'ClouDNS';
  if (all.includes('dnsimple'))                           return 'DNSimple';
  if (all.includes('route53') || all.includes('amazonaws')) return 'AWS';
  /* Cloudflare last — after checking for cloudflare.com self-NS below */

  /* ── SiteGround ── */
  if (all.includes('siteground'))                         return 'SiteGround';

  /* ── Self-NS detection ──
   * Extract the "apex" domain (last 2 labels) of both the NS host
   * and the monitored domain, then compare.
   *
   * Examples:
   *   domain=cloudflare.com, ns=ns3.cloudflare.com → apex match → "Domain"
   *   domain=apple.com, ns=a.ns.apple.com          → apex match → "Domain"
   *   domain=amazon.com, ns=ns1.amzndns.co.uk       → no match  → "Own"
   *   domain=paulfleury.com, ns=ns1.myregistrar.com → no match  → check Cloudflare
   */
  var domainApex = apexDomain(domain);
  var allSelfHosted = hosts.every(function(host) {
    return apexDomain(host) === domainApex;
  });
  if (allSelfHosted) return 'Domain';

  /* Cloudflare check here so cloudflare.com's own NS isn't labelled "Domain" */
  if (all.includes('cloudflare'))                         return 'Cloudflare';

  /* ── Registrar / branded NS ──
   * If the NS hostname contains the domain apex (e.g. ns1.paulfleury.com
   * for paulfleury.com), label it with the capitalised domain name.
   * Otherwise extract the registrar name from the NS host:
   * e.g. ns1.registrar-servers.com → "Registrar-servers"
   * This is more informative than the generic "Own" label.
   */
  var hasDomainInNS = hosts.some(function(host) { return host.includes(domainApex); });
  if (hasDomainInNS) return capitalise(domainApex.split('.')[0]);

  /* Last resort: extract the second-level domain from the first NS host
   * and capitalise it — e.g. ns1.registrar-servers.com → "Registrar-servers" */
  if (hosts.length > 0) {
    var firstHost = hosts[0].replace(/\.$/, '');
    var parts = firstHost.split('.');
    if (parts.length >= 2) {
      return capitalise(parts[parts.length - 2]);
    }
  }
  return '—';
}

/** Extract apex domain — last two labels, e.g. "sub.example.co.uk" → "co.uk"
 *  is wrong, so we use a simple heuristic: last 2 labels.
 *  This is sufficient for our pattern-matching purposes. */
function apexDomain(hostname) {
  var parts = hostname.replace(/\.$/, '').split('.');
  return parts.slice(-2).join('.');
}

/** Capitalise first letter of a string */
function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Detect MX / mail provider from MX records.
 *
 * DoH MX data format: "10 mail.protonmail.ch." (priority + space + hostname)
 * We strip the priority prefix and trailing dot before matching.
 */
function detectMXProvider(mxRecords) {
  if (!mxRecords || mxRecords.length === 0) return 'None';

  /* Strip priority prefix ("10 ") and trailing dot, then lowercase */
  var all = mxRecords.map(function(r) {
    return (r.data || '').replace(/^\d+\s+/, '').replace(/\.$/, '').toLowerCase();
  }).join(' ');

  if (all.includes('google') || all.includes('aspmx') || all.includes('smtp.google')) return 'Google';
  if (all.includes('outlook') || all.includes('protection.outlook') || all.includes('microsoft')) return 'Microsoft';
  if (all.includes('protonmail') || all.includes('proton.ch')) return 'ProtonMail';
  if (all.includes('amazonses') || all.includes('amazon-smtp') || all.includes('amzn')) return 'Amazon SES';
  if (all.includes('mimecast'))   return 'Mimecast';
  if (all.includes('mailgun'))    return 'Mailgun';
  if (all.includes('sendgrid'))   return 'SendGrid';
  if (all.includes('zoho'))       return 'Zoho';
  if (all.includes('fastmail'))   return 'Fastmail';
  if (all.includes('icloud') || all.includes('apple.com')) return 'Apple';

  /* Extract registrar/provider name from the first MX hostname
   * e.g. "10 mail.example.com." → "Example"
   * Better than generic "Own" which tells the user nothing. */
  if (mxRecords.length > 0) {
    var raw  = (mxRecords[0].data || '').replace(/^\d+\s+/, '').replace(/\.$/, '');
    var parts = raw.split('.');
    if (parts.length >= 2) {
      return capitalise(parts[parts.length - 2]);
    }
  }
  return '—';
}

/**
 * Parse DMARC policy from _dmarc TXT records.
 * Strips surrounding double-quotes before matching.
 * Returns: 'reject', 'quarantine', 'none', or 'missing'.
 */
function parseDMARCPolicy(txtRecords) {
  for (var i = 0; i < txtRecords.length; i++) {
    /* Strip surrounding double-quotes that DoH adds */
    var val = (txtRecords[i].data || txtRecords[i] || '').replace(/^"+|"+$/g, '').toLowerCase();
    if (val.indexOf('v=dmarc1') >= 0) {
      if (val.indexOf('p=reject')     >= 0) return 'reject';
      if (val.indexOf('p=quarantine') >= 0) return 'quarantine';
      if (val.indexOf('p=none')       >= 0) return 'none';
      return 'none'; /* DMARC record exists but no explicit p= tag */
    }
  }
  return 'missing';
}

/** Parse SPF from TXT records */
function parseSPF(txtRecords) {
  /*
   * Parse SPF qualifier from TXT records.
   * Cloudflare DoH wraps TXT data in double-quotes: '"v=spf1 ..."'
   * We strip those before matching.
   * Returns: '~all', '-all', '+all', '?all', or '' if no SPF found.
   */
  for (var i = 0; i < txtRecords.length; i++) {
    /* Strip surrounding double-quotes that DoH adds to TXT records */
    var val = (txtRecords[i].data || txtRecords[i] || '').replace(/^"+|"+$/g, '');
    if (val.toLowerCase().indexOf('v=spf1') >= 0) {
      var m = val.match(/([~\-+?]all)/i);
      return m ? m[1].toLowerCase() : '~all';
    }
  }
  return '';
}

/*
 * ROW LOADING STATE — 500ms minimum dim duration
 * ─────────────────────────────────────────────────────────────
 * Challenge: some DNS queries resolve in <50ms. Without a minimum
 * duration, rows flash so quickly the user can't see anything is
 * happening. We enforce a 500ms floor so the progressive scan
 * is always visually apparent.
 *
 * Implementation:
 *  - setRowLoading(domain, true)  → adds 'is-checking' class,
 *    records the start timestamp in _rowLoadingStart[domain]
 *  - setRowLoading(domain, false) → checks elapsed time; if less
 *    than MIN_ROW_LOADING_MS, defers the un-dim by the remainder
 *    so the row stays dim for at least that long.
 *  - On un-dim, swaps 'is-checking' for 'is-checking-done' which
 *    triggers the slow fade-in transition (600ms in CSS).
 */
var MIN_ROW_LOADING_MS = 500;  /* minimum dim duration in ms */
var _rowLoadingStart   = {};   /* domain → timestamp when loading started */

function setRowLoading(domain, loading) {
  var row = document.querySelector('tr[data-domain="' + domain + '"]');
  if (!row) return;

  if (loading) {
    /* Mark start time so we can enforce the minimum */
    _rowLoadingStart[domain] = Date.now();
    row.classList.remove('is-checking-done');
    row.classList.add('is-checking');

  } else {
    /* Calculate how long this row has been in loading state */
    var elapsed  = Date.now() - (_rowLoadingStart[domain] || 0);
    var remaining = Math.max(0, MIN_ROW_LOADING_MS - elapsed);

    setTimeout(function() {
      if (!row) return;
      row.classList.remove('is-checking');
      row.classList.add('is-checking-done');
      /* Remove done class after the CSS transition completes (600ms) */
      setTimeout(function() { row.classList.remove('is-checking-done'); }, 650);
    }, remaining);
  }
}

/**
 * CHECK A SINGLE DOMAIN — full DNS scan.
 *
 * Queries in parallel: A (uptime + latency), NS (provider),
 * MX (mail provider), TXT (SPF), and _dmarc TXT (DMARC policy).
 *
 * For built-in top-50 domains, NS/MX/DMARC/SPF are pre-seeded
 * from scan data. For custom domains, we look them up live.
 *
 * @param {string} domain — bare domain name e.g. "paulfleury.com"
 * @param {boolean} fullScan — if true, also fetch NS/MX/TXT/DMARC
 */

/**
 * Fetch SSL expiry for a SINGLE domain.
 * Tries ssl-check.php first (fast, server-side TLS).
 * Falls back to crt.sh if PHP endpoint not available.
 *
 * NOTE: For bulk checks, use fetchAllSSLExpiry() instead —
 * it batches all domains into one HTTP request.
 *
 * @param  {string} domain
 * @returns {Promise<{expiry:string, issuer:string}|null>}
 */
async function fetchSSLExpiry(domain) {
  /* Strategy 1: ssl-check.php on same server */
  try {
    var phpRes = await fetch('./ssl-check.php?domain=' + encodeURIComponent(domain), {
      signal: AbortSignal.timeout(8000)
    });
    if (phpRes.ok) {
      var d = await phpRes.json();
      if (d && d.expiry && !d.error && d.error !== 'rate_limited') {
        return { expiry: d.expiry, issuer: d.issuer || '' };
      }
    }
    if (phpRes.status !== 404) throw new Error('php-err');
  } catch(e) { /* fall through */ }

  /* Strategy 2: crt.sh certificate transparency */
  try {
    var res = await fetch(
      'https://crt.sh/?q=' + encodeURIComponent(domain) + '&output=json&exclude=expired',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    var certs = await res.json();
    if (!Array.isArray(certs) || !certs.length) return null;
    var now   = new Date();
    var valid = certs
      .filter(function(c) { return c.not_after && new Date(c.not_after) > now; })
      .sort(function(a, b) { return new Date(b.not_after) - new Date(a.not_after); });
    if (!valid.length) return null;
    var best  = valid[0];
    var expiry = (best.not_after || '').split('T')[0];
    var cn    = (best.issuer_name || '').replace(/.*CN=/, '').replace(/,.*/, '').trim();
    var isLE  = /^[RE]\d+$/i.test(cn) || cn.toLowerCase().indexOf("let") >= 0;
    return { expiry: expiry, issuer: isLE ? 'LE' : cn.slice(0, 20) };
  } catch(e) { return null; }
}

/**
 * BATCH SSL fetch — checks multiple domains in ONE php request.
 *
 * This is the primary SSL check path. Instead of 34 separate HTTP
 * requests (one per domain), we send a single request:
 *   GET /ssl-check.php?domains=dom1,dom2,dom3,...
 * and get back an array of results.
 *
 * Benefits:
 *  - Dramatically fewer HTTP round-trips (1 vs N)
 *  - No browser parallelism limit issues
 *  - Server processes sequentially but returns all results at once
 *
 * Falls back to individual crt.sh calls for domains that error
 * in the batch response.
 *
 * @param {string[]} domains - list of bare domain names
 * @returns {Promise<Object>} map of domain → {expiry, issuer}
 */
async function fetchAllSSLExpiry(domains) {
  var sslMap = {};
  if (!domains || !domains.length) return sslMap;

  /* Filter to only domains that need checking */
  var needed = domains.filter(function(d) {
    return !_sslChecked[d] && !DOMAINS.find(function(x){ return x.domain===d && x.sslExpiry; });
  });
  if (!needed.length) return sslMap;

  /* Mark all as checked upfront to prevent re-querying on parallel calls */
  needed.forEach(function(d) { _sslChecked[d] = true; });

  /* Strategy 1: batch php call */
  try {
    /* Split into chunks of 20 to stay well within URL length limits */
    var CHUNK = 20;
    for (var i = 0; i < needed.length; i += CHUNK) {
      var chunk  = needed.slice(i, i + CHUNK);
      var params = chunk.map(encodeURIComponent).join(',');
      var phpRes = await fetch('./ssl-check.php?domains=' + params, {
        signal: AbortSignal.timeout(30000) /* generous: PHP processes sequentially */
      });

      if (phpRes.status === 404) {
        /* ssl-check.php not uploaded — fall through to crt.sh */
        throw new Error('no-php');
      }
      if (!phpRes.ok) continue;

      var results = await phpRes.json();
      if (!Array.isArray(results)) continue;

      results.forEach(function(r) {
        if (r && r.domain && r.expiry && !r.error) {
          sslMap[r.domain] = { expiry: r.expiry, issuer: r.issuer || '' };
        }
      });
    }
    return sslMap;
  } catch(phpErr) {
    /* PHP not available — fall through to per-domain crt.sh */
  }

  /* Strategy 2: parallel crt.sh calls (one per domain) */
  var crtResults = await Promise.all(needed.map(function(domain) {
    return fetchSSLExpiry(domain).then(function(r) {
      return { domain: domain, result: r };
    });
  }));
  crtResults.forEach(function(item) {
    if (item.result) sslMap[item.domain] = item.result;
  });

  return sslMap;
}


async function checkDomain(domain, fullScan) {
  /* Ensure state entry exists */
  if (!domainState[domain]) {
    domainState[domain] = { up: null, latency: null, history: [] };
  }
  var st = domainState[domain];

  /* Find the domain entry in the list */
  var entry = DOMAINS.find(function(d){ return d.domain === domain; });
  /* Custom domains (or those with placeholder data) always get a full scan */
  var needFullScan = fullScan || !entry || entry.custom || entry.ns === '—';

  /* ── A record: uptime + latency ── */
  var t0 = Date.now();
  try {
    var aRecords = await dohQuery(domain, 'A');
    var ms  = Date.now() - t0;
    var up  = aRecords.length > 0;
    st.up      = up;
    st.latency = ms;
    st.history.push({ up: up, latency: ms });
    if (st.history.length > 20) st.history.shift();
    uptimeRecord(domain, up, ms);
  } catch(e) {
    st.up      = false;
    st.latency = null;
    st.history.push({ up: false, latency: null });
    if (st.history.length > 20) st.history.shift();
  }

  /* ── SSL expiry enrichment ──────────────────────────────────────────
   * For custom domains (sslExpiry is null or unknown), we try to fetch
   * the live SSL cert expiry from crt.sh certificate transparency logs.
   *
   * Why crt.sh:
   *  - Free, no API key, CORS-enabled
   *  - Returns all certs issued for a domain (Let's Encrypt, DigiCert, etc.)
   *  - We filter to valid (not-yet-expired) certs and take the newest
   *
   * Why not block on it:
   *  - crt.sh can be slow (1–3s) or occasionally timeout
   *  - We fire it as a non-blocking background Promise alongside DNS checks
   *  - If it resolves, we update the entry; if it times out, we keep '—'
   *
   * The built-in top-50 list has accurate seeded expiry dates from a
   * real scan — we only enrich custom domains (sslExpiry === null).
   * ──────────────────────────────────────────────────────────────── */
  /* SSL expiry is now checked in bulk via checkAll() → fetchAllSSLExpiry()
   * after all DNS checks complete. Nothing to do here per-domain. */

  /* ── Full DNS scan: NS, MX, TXT, DMARC (for custom or placeholder entries) ── */
  if (needFullScan && entry) {
    try {
      /* Fire NS, MX, TXT, and _dmarc TXT in parallel — 4 queries total */
      var results = await Promise.all([
        dohQuery(domain, 'NS'),
        dohQuery(domain, 'MX'),
        dohQuery(domain, 'TXT'),
        dohQuery('_dmarc.' + domain, 'TXT')
      ]);
      var nsRecs    = results[0];
      var mxRecs    = results[1];
      var txtRecs   = results[2];
      var dmarcRecs = results[3];

      /* Update the domain entry with discovered data */
      if (nsRecs.length > 0)    entry.ns     = detectNSProvider(nsRecs, domain);
      if (mxRecs.length >= 0)   entry.mxType = detectMXProvider(mxRecs);
      entry.dmarc = parseDMARCPolicy(dmarcRecs);
      entry.spf   = parseSPF(txtRecs);

      /* Store raw records in TOOLTIPS for hover display */
      TOOLTIPS[domain] = {
        ns:    nsRecs.slice(0,3).map(function(r){ return r.data; }).join(', ') || '—',
        mx:    mxRecs.slice(0,3).map(function(r){ return r.data; }).join(', ') || '—',
        dmarc: dmarcRecs.map(function(r){ return r.data; }).join(' ') || '—',
        spf:   txtRecs.filter(function(r){ return (r.data||'').toLowerCase().includes('v=spf1'); })
                      .map(function(r){ return r.data; }).join(' ') || '—'
      };
    } catch(e) {
      /* Non-fatal: partial data is fine, A-record result is already stored */
    }
  }

  /* Record timestamp for per-domain rate limiting */
  _domainLastCheck[domain] = Date.now();
}

/**
 * CHECK ALL DOMAINS in staggered batches.
 *
 * Batching prevents hammering DoH with 30+ parallel queries.
 * Each batch of DNS_BATCH_SIZE domains is checked in parallel,
 * then the table is re-rendered after each batch so the user
 * sees progressive live updates row by row.
 *
 * Rate-limit guard: if a check is already running or was run
 * less than CHECK_ALL_MIN_GAP ms ago, this is a no-op.
 */
async function checkAll() {
  /* Anti-spam guard */
  var now = Date.now();
  if (_checkRunning) {
    console.log('[Eye] Check already running — ignoring duplicate request');
    return;
  }
  if (now - _lastCheckAll < CHECK_ALL_MIN_GAP) {
    var wait = Math.ceil((CHECK_ALL_MIN_GAP - (now - _lastCheckAll)) / 1000);
    console.log('[Eye] Rate limit: please wait ' + wait + 's before refreshing again');
    return;
  }

  _checkRunning = true;
  _lastCheckAll = now;

  /* Show "Checking…" in the status bar */
  var el = document.getElementById('last-checked');
  if (el) el.textContent = 'Checking…';

  /* Show the animated sweep progress bar */
  var spw = document.getElementById('scan-progress-wrap');
  if (spw) spw.classList.remove('hidden');

  /* Dim ALL rows — each will un-dim after its check + 500ms minimum */
  DOMAINS.forEach(function(d) { setRowLoading(d.domain, true); });

  /* Process in batches — stagger to avoid firewall triggers */
  for (var i = 0; i < DOMAINS.length; i += DNS_BATCH_SIZE) {
    var batch = DOMAINS.slice(i, i + DNS_BATCH_SIZE);
    await Promise.all(batch.map(function(d) { return checkDomain(d.domain); }));

    /* Un-dim this batch immediately so user sees progressive results */
    batch.forEach(function(d) { setRowLoading(d.domain, false); });

    /* Re-render after each batch so results appear progressively */
    renderTable();
    updateStats();

    /* Small pause between batches — spreads load, looks nice */
    if (i + DNS_BATCH_SIZE < DOMAINS.length) {
      await sleep(DNS_BATCH_DELAY);
    }
  }

  if (el) el.textContent = 'Last checked: ' + new Date().toLocaleTimeString();
  updateStats();
  renderTable();

  /* Batch SSL — fetch expiry for all domains still showing "—".
   * One PHP request covers all missing domains.
   * Runs after DNS checks so latency/uptime appears first. */
  var needSSL = DOMAINS
    .filter(function(d) { return !d.sslExpiry && !_sslChecked[d.domain]; })
    .map(function(d) { return d.domain; });
  if (needSSL.length > 0) {
    fetchAllSSLExpiry(needSSL).then(function(sslMap) {
      var updated = false;
      Object.keys(sslMap).forEach(function(domain) {
        var entry = DOMAINS.find(function(d) { return d.domain === domain; });
        if (entry && sslMap[domain]) {
          entry.sslExpiry = sslMap[domain].expiry;
          entry.sslIssuer = sslMap[domain].issuer;
          updated = true;
        }
      });
      if (updated) { renderTable(); updateStats(); }

      /* After SSL data is merged, run the full health report scan.
       * Pass isManual flag so manual refreshes use shorter cooldowns. */
      var wasManual = _manualRefresh;
      _manualRefresh = false;
      sendHealthReport(wasManual);
    });
  }

  /* If all SSL data was already known, run health check now.
   * Pass isManual flag so manual refreshes use shorter cooldowns. */
  if (needSSL.length === 0) {
    var wasManual2 = _manualRefresh;
    _manualRefresh = false;
    sendHealthReport(wasManual2);
  } else {
    /* Reset flag here too — sendHealthReport inside .then() captured it already */
    _manualRefresh = false;
  }

  saveDomainsStats();
  uptimeSave(); /* persist uptime data to cookie */

  /* Hide the scan progress bar */
  var spw = document.getElementById('scan-progress-wrap');
  if (spw) spw.classList.add('hidden');

  _checkRunning = false;
}

/**
 * REFRESH BUTTON — resets the auto-refresh countdown and fires checkAll.
 *
 * Rate-limit handling (CHECK_ALL_MIN_GAP = 5s):
 *  - If a check is already running: button shows "Running…" and is disabled
 *    until the current check finishes (not a fixed timeout).
 *  - If the gap hasn't elapsed: button shows a live countdown ("Wait 3s…")
 *    and AUTOMATICALLY fires checkAll when the gap expires — user doesn't
 *    need to click again.
 *
 * Visual states:
 *  - Clicking Refresh: button → spinning icon + "Checking…", disabled
 *  - Rate-limited:     button → "⏳ Wait Ns…", disabled, counts down
 *  - After countdown:  checkAll fires automatically
 *  - After check:      button restored to normal
 */
function triggerRefresh() {
  var now = Date.now();
  var btn = document.getElementById('btn-refresh');

  /* Already running — show feedback but don't double-fire */
  if (_checkRunning) {
    if (btn) {
      var origHtml = btn.getAttribute('data-original') || btn.innerHTML;
      btn.setAttribute('data-original', origHtml);
      btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px">' +
        '<svg style="animation:spin 0.7s linear infinite;flex-shrink:0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>' +
        'Running…</span>';
      btn.disabled = true;
      /* Re-enable once check completes (polled) */
      var poll = setInterval(function() {
        if (!_checkRunning) { clearInterval(poll); setRefreshBtnNormal(); }
      }, 200);
    }
    return;
  }

  var remaining = CHECK_ALL_MIN_GAP - (now - _lastCheckAll);

  /* Enough time has passed — fire immediately */
  if (remaining <= 0) {
    refreshTimer = 180;
    var pf = document.getElementById('progress-fill');
    if (pf) pf.style.width = '100%';
    setRefreshBtnLoading();
    _manualRefresh = true;
    checkAll().then(setRefreshBtnNormal);
    return;
  }

  /* Rate-limited — show countdown, then auto-fire when ready.
   * IMPORTANT: save the real original HTML NOW (before overwriting
   * with countdown text) so setRefreshBtnNormal can restore it. */
  if (btn) {
    /* Capture and store real original HTML before any changes */
    var realOrig = btn.innerHTML;
    btn.setAttribute('data-original', realOrig);
    btn.disabled = true;

    var secs = Math.ceil(remaining / 1000);
    btn.innerHTML = '⏳ ' + secs + 's…';

    var ticker = setInterval(function() {
      secs--;
      if (secs > 0) {
        btn.innerHTML = '⏳ ' + secs + 's…';
      } else {
        clearInterval(ticker);
        /* Auto-fire — setRefreshBtnLoading will find data-original already set */
        refreshTimer = 180;
        var pf = document.getElementById('progress-fill');
        if (pf) pf.style.width = '100%';
        setRefreshBtnLoading();
        _manualRefresh = true;
        checkAll().then(setRefreshBtnNormal);
      }
    }, 1000);
  }
}


/** Set refresh button to spinning/loading state */
function setRefreshBtnLoading() {
  var btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.disabled = true;
  /* Only save original if not already saved (prevents overwriting countdown state) */
  if (!btn.getAttribute('data-original') || btn.getAttribute('data-original').includes('⏳')) {
    btn.setAttribute('data-original', REFRESH_BTN_ORIGINAL);
  }
  btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px">'
    + '<svg style="animation:spin 0.7s linear infinite;flex-shrink:0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>'
    + 'Checking…</span>';
}

/** Restore refresh button to normal state */
function setRefreshBtnNormal() {
  var btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.disabled = false;
  /* Use stored original; fall back to the snapshot taken at page load */
  var orig = btn.getAttribute('data-original');
  if (orig && !orig.includes('⏳') && !orig.includes('Checking')) {
    btn.innerHTML = orig;
  } else if (REFRESH_BTN_ORIGINAL) {
    btn.innerHTML = REFRESH_BTN_ORIGINAL;
  }
  btn.removeAttribute('data-original');
}

/**
 * PER-ROW REFRESH — re-scan a single domain.
 * Rate-limited to once per CHECK_ROW_MIN_GAP per domain.
 * Does a fullScan=true so NS/MX/DMARC/SPF are re-fetched.
 *
 * @param {string} domain — the domain to re-check
 * @param {HTMLElement} btn — the refresh icon button element
 */
async function refreshRow(domain, btn) {
  var now = Date.now();
  var last = _domainLastCheck[domain] || 0;

  if (now - last < CHECK_ROW_MIN_GAP) {
    var wait = Math.ceil((CHECK_ROW_MIN_GAP - (now - last)) / 1000);
    if (btn) { btn.textContent = wait + 's'; setTimeout(function(){ btn.textContent = '↺'; }, (CHECK_ROW_MIN_GAP - (now - last))); }
    return;
  }

  /* Spin the button icon and dim the row */
  if (btn) btn.classList.add('is-spinning');
  setRowLoading(domain, true);

  await checkDomain(domain, true); /* fullScan=true: re-fetch NS/MX/DMARC/SPF */

  setRowLoading(domain, false);
  if (btn) btn.classList.remove('is-spinning');

  renderTable();
  updateStats();
}

/* ────────────────────────────────────────────────────────────────
   9. DOMAINS.LIST LOADER
   Tries to fetch `domains.list` from the same directory.
   Lines starting with # are comments. Empty lines are ignored.
   Falls back silently to BUILTIN top-50 if file is absent.
   ──────────────────────────────────────────────────────────────── */
async function loadDomainList() {
  try {
    var res = await fetch('./domains.list', { cache: 'no-cache' });
    if (!res.ok) throw new Error('not found (' + res.status + ')');
    var text  = await res.text();
    var lines = text.split('\n')
      .map(function(l) { return l.trim(); })
      .filter(function(l) { return l.length > 0 && l[0] !== '#'; });
    if (lines.length === 0) throw new Error('empty file');

    /* Use BUILTIN data for known domains, create minimal entries for others */
    var builtinMap = {};
    BUILTIN.forEach(function(d) { builtinMap[d.domain] = d; });
    DOMAINS = lines.map(function(domain, idx) {
      return builtinMap[domain] || {
        rank: idx + 1, domain: domain, cat: 'custom',
        sslExpiry: null, ns: '—', mxType: '—',
        dmarc: 'missing', spf: '', custom: false
      };
    });
    console.log('[Eye] Loaded ' + DOMAINS.length + ' domains from domains.list');
  } catch(e) {
    DOMAINS = BUILTIN.slice();
    console.log('[Eye] domains.list unavailable (' + e.message + ') — using built-in top-50');
  }

  /* Initialise empty state for all domains, reset SSL check cache */
  _sslChecked = {};
  DOMAINS.forEach(function(d) {
    if (!domainState[d.domain]) {
      domainState[d.domain] = { up: null, latency: null, history: [] };
    }
  });

  /* Try to load SSL expiry data from domains.json (written by update-stats.php).
   * This is the authoritative SSL source when the PHP cron is running.
   * It populates sslExpiry before the first DNS check, so SSL shows immediately. */
  try {
    var jsonRes = await fetch('./domains.json', { cache: 'no-cache' });
    if (jsonRes.ok) {
      var jsonData = await jsonRes.json();
      if (jsonData && jsonData.domains) {
        var sslMap = {};
        jsonData.domains.forEach(function(d) {
          if (d.domain && d.ssl_expiry) sslMap[d.domain] = { expiry: d.ssl_expiry, issuer: d.ssl_issuer || '' };
        });
        /* Apply SSL data to DOMAINS array */
        DOMAINS.forEach(function(d) {
          if (sslMap[d.domain] && !d.sslExpiry) {
            d.sslExpiry = sslMap[d.domain].expiry;
            d.sslIssuer = sslMap[d.domain].issuer;
            _sslChecked[d.domain] = true; /* don't re-query crt.sh for these */
          }
        });
        console.log('[Eye] SSL data loaded from domains.json for ' + Object.keys(sslMap).length + ' domains');
      }
    }
  } catch(e) { /* domains.json not available — crt.sh fallback will run */ }
}

/** Attempt to persist a new domain to domains.list via HTTP PUT */
async function persistDomainToFile(domain) {
  try {
    var res = await fetch('./domains.list', { cache: 'no-cache' });
    if (!res.ok) return false;
    var text = await res.text();
    var NL = String.fromCharCode(10);
    if (text.split(NL).some(function(l){ return l.trim()===domain; })) return true;
    var put = await fetch('./domains.list', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: text.trimEnd() + NL + domain + NL
    });
    return put.ok;
  } catch(e) { return false; }
}


/* ────────────────────────────────────────────────────────────────
   10. ADD DOMAIN MODAL
   Users type a domain, optionally queue multiple, then confirm.
   On confirm: each domain is added to DOMAINS[], state is created,
   DNS check fires immediately, table re-renders on completion.
   ──────────────────────────────────────────────────────────────── */
function openAddModal() {
  pendingQueue = [];
  var tags = document.getElementById('queued-tags');
  if (tags) tags.innerHTML = '';
  var inp = document.getElementById('add-input');
  if (inp) inp.value = '';
  /* cat selector removed in v2.0.0 */
  var overlay = document.getElementById('add-overlay');
  if (overlay) overlay.classList.add('open');
  setTimeout(function(){ var i=document.getElementById('add-input'); if(i) i.focus(); }, 80);
}

function closeAddModal() {
  var overlay = document.getElementById('add-overlay');
  if (overlay) overlay.classList.remove('open');
  pendingQueue = [];
}

/** Parse and clean a domain string typed by the user */
function parseDomain(raw) {
  return (raw || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

/** Add the currently typed domain to pendingQueue */
function queueDomain() {
  var inp = document.getElementById('add-input');
  if (!inp) return;
  var domain = parseDomain(inp.value);
  if (!domain || domain.indexOf('.') < 0) return;

  /* Skip if already monitored or already in queue */
  if (DOMAINS.some(function(d){ return d.domain===domain; })) { inp.value=''; return; }
  if (pendingQueue.some(function(x){ return x.domain===domain; })) { inp.value=''; return; }

  pendingQueue.push({ domain: domain, cat: 'custom' });
  inp.value = '';

  /* Show a tag chip */
  var tags = document.getElementById('queued-tags');
  if (tags) {
    var tag = document.createElement('span');
    tag.className = 'queued-tag';
    tag.setAttribute('data-d', domain);
    tag.innerHTML = domain + '<button type="button" onclick="removeQueueTag(\'' + domain + '\')">✕</button>';
    tags.appendChild(tag);
  }
  inp.focus();
}

function removeQueueTag(domain) {
  pendingQueue = pendingQueue.filter(function(x){ return x.domain !== domain; });
  var tag = document.querySelector('.queued-tag[data-d="' + domain + '"]');
  if (tag) tag.remove();
}

/** Commit queued domains: add to list, run checks, update table */
function confirmAddDomains() {
  /* Also pick up anything still typed in the input */
  var inp = document.getElementById('add-input');
  if (inp) {
    var domain = parseDomain(inp.value);
    if (domain && domain.indexOf('.')>=0 && !DOMAINS.some(function(d){return d.domain===domain;})) {
      pendingQueue.push({ domain: domain, cat: 'custom' });
    }
  }
  if (pendingQueue.length === 0) { closeAddModal(); return; }

  /* Snapshot the queue NOW before clearing it */
  var toAdd = pendingQueue.slice();
  pendingQueue = [];
  closeAddModal();

  /* Add each domain to the live list */
  toAdd.forEach(function(item) {
    /* Skip if somehow already present */
    if (DOMAINS.some(function(d){ return d.domain===item.domain; })) return;
    DOMAINS.push({
      rank: 99, domain: item.domain, cat: item.cat||'custom',
      sslExpiry: null, ns: '—', mxType: '—',
      dmarc: 'missing', spf: '', custom: true
    });
    domainState[item.domain] = { up: null, latency: null, history: [] };
    /* Try to persist to domains.list — silent failure on static hosts */
    persistDomainToFile(item.domain);
  });

  /* Show domains immediately (status will be "…" until checks complete) */
  renderTable();
  updateStats();

  /* Run DNS checks for new domains, then re-render with live results */
  Promise.all(toAdd.map(function(item) {
    return checkDomain(item.domain);
  })).then(function() {
    renderTable();
    updateStats();
    saveDomainsStats();
  });
}


/* ────────────────────────────────────────────────────────────────
   11. EXPORT & STATS PERSISTENCE
   exportCSV()        — triggers a browser download
   buildStatsCSV()    — builds CSV string with timestamp
   saveDomainsStats() — PUTs the CSV to domains.stats (server write needed)
   ──────────────────────────────────────────────────────────────── */
function buildStatsCSV() {
  var now = new Date().toISOString();
  var headers = ['Timestamp','Rank','Domain','Category','Status',
                 'Latency (ms)','SSL Days','NS','MX','DMARC','SPF'];
  var rows = DOMAINS.map(function(d) {
    var st   = domainState[d.domain] || {};
    var days = daysUntil(d.sslExpiry);
    return [
      now, d.rank, d.domain, d.cat,
      st.up===true ? 'UP' : st.up===false ? 'DOWN' : 'UNKNOWN',
      (st.latency!=null) ? st.latency : '',
      days!==null ? days : '',
      d.ns, d.mxType, d.dmarc, d.spf
    ].map(function(v) {
      var s = String(v);
      return (s.indexOf(',')>=0||s.indexOf('"')>=0) ? '"'+s.replace(/"/g,'""')+'"' : s;
    }).join(',');
  });
  var NL = String.fromCharCode(10);
  return [headers.join(',')].concat(rows).join(NL);
}

async function saveDomainsStats() {
  /* Write CSV snapshot to domains.stats via PUT.
   * Works on local/Apache/Nginx with write permissions.
   * On static hosts (Netlify, S3, GitHub Pages) this silently fails — that's OK. */
  try {
    var csv = buildStatsCSV();
    var resp = await fetch('./domains.stats', {
      method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: csv
    });
    if (resp.ok) console.log('[Eye] domains.stats saved (' + DOMAINS.length + ' domains)');
  } catch(e) { /* static host — ignore */ }
}

function exportCSV() {
  var csv  = buildStatsCSV();
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = 'the-all-seeing-eye-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/* ────────────────────────────────────────────────────────────────
   12. WEBHOOK HANDLER
   Detects headless/cron invocation via URL path or #webhook hash.
   When triggered: skips PIN, loads domains.list, checks all,
   writes domains.stats. Designed to be called by an external
   cron service (cron-job.org, GitHub Actions, UptimeRobot, etc.)
   pointing to: https://yourdomain.com/webhook.do
   ──────────────────────────────────────────────────────────────── */
function checkWebhookMode() {
  var path = window.location.pathname;
  var hash = window.location.hash;
  if (!path.endsWith('webhook.do') && hash !== '#webhook') return false;

  console.log('[Eye] Webhook mode — skipping PIN, running headless check');
  var overlay = document.getElementById('pin-overlay');
  if (overlay) overlay.style.display = 'none';

  loadDomainList().then(function() {
    renderTable();
    return checkAll();
  }).then(function() {
    console.log('[Eye] Webhook complete. ' + DOMAINS.length + ' domains checked.');
  });
  return true;
}

/* WEBHOOK + INFO MODALS */
function openWebhookModal() {
  var m = document.getElementById('webhook-modal');
  if (!m) return;
  m.classList.add('open');
  /* Reset body scroll to top on every open */
  var body = m.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
}
function closeWebhookModal() {
  var m = document.getElementById('webhook-modal');
  if (m) m.classList.remove('open');
}
function openInfoModal() {
  var m = document.getElementById('info-modal');
  if (!m) return;
  m.classList.add('open');
  /* Reset body scroll to top on every open */
  var body = m.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
}
function closeInfoModal() {
  var m = document.getElementById('info-modal');
  if (m) m.classList.remove('open');
}


/* ────────────────────────────────────────────────────────────────
   13. AUTO-REFRESH COUNTDOWN — ticks every second
   ──────────────────────────────────────────────────────────────── */
setInterval(function() {
  refreshTimer = Math.max(0, refreshTimer - 1);
  if (refreshTimer === 0) { triggerRefresh(); return; }
  var m = Math.floor(refreshTimer / 60);
  var s = refreshTimer % 60;
  var cd = document.getElementById('countdown');
  if (cd) cd.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  var pf = document.getElementById('progress-fill');
  if (pf) pf.style.width = (refreshTimer / 180 * 100) + '%';
}, 1000);



/* ────────────────────────────────────────────────────────────────
   FIRST-PIN-SETS-PIN FLOW
   ─────────────────────────────────────────────────────────────
   Challenge: the default PIN (123456) is public knowledge. Anyone
   who finds the dashboard URL can get in. We want to nudge the user
   to set a personal PIN immediately on first use.

   How it works:
   1. pinCheck() detects if the entered PIN matches the default hash.
   2. If so, instead of going straight to the dashboard, it shows
      the Set-PIN modal (a second numpad for new PIN + confirm).
   3. The user enters their new PIN twice — if they match, we:
      a. Update PIN_HASH in memory (takes effect immediately)
      b. Attempt to rewrite index.html via HTTP PUT so the change
         persists across page reloads (works on writable servers)
      c. Show the new hash + manual instruction if PUT fails
   4. If the user skips, we proceed to the dashboard normally.

   Security note: the new PIN hash is written to the HTML file in
   plain sight inside index.html — just like the original. This is
   a client-side-only protection; anyone with server access can read
   the file. Suitable for casual access control, not for secrets.
   ──────────────────────────────────────────────────────────────── */

/* SHA-256 hash of the DEFAULT PIN "123456" — used to detect first-use */
var DEFAULT_PIN_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

var spPhase  = 1;    /* 1 = entering new PIN, 2 = confirming new PIN */
var spPin1   = '';   /* first entry */
var spPin2   = '';   /* confirmation entry */

/** Called after correct PIN unlock — check if it was the default */
function checkFirstUse() {
  if (PIN_HASH !== DEFAULT_PIN_HASH) {
    /* Custom PIN set — go straight to dashboard */
    initDashboard();
    return;
  }
  /* Default PIN — go to set-PIN modal */
  var overlay = document.getElementById('set-pin-overlay');
  if (overlay) overlay.style.display = 'flex';
  spPhase = 1; spPin1 = ''; spPin2 = '';
  spUpdateDots();
}

/* PIN_HASH checked after login — see checkFirstUse() */

/** Update the two rows of dots in the Set-PIN modal */
function spUpdateDots(errorRow) {
  for (var row = 1; row <= 2; row++) {
    var buf = (row === 1) ? spPin1 : spPin2;
    for (var i = 0; i < 6; i++) {
      var dot = document.getElementById('sp-dot-' + row + '-' + i);
      if (!dot) continue;
      dot.className = 'pin-dot';
      if (errorRow === row)   dot.classList.add('error');
      else if (i < buf.length) dot.classList.add('filled');
    }
  }
  /* Dim confirm row until new PIN is complete */
  var label = document.getElementById('sp-confirm-label');
  if (label) label.style.opacity = (spPin1.length === 6) ? '1' : '0.4';
}

/** Digit pressed in Set-PIN modal */
function spDigit(d) {
  if (spPhase === 1) {
    if (spPin1.length >= 6) return;
    spPin1 += d;
    spUpdateDots();
    if (spPin1.length === 6) {
      /* Move to confirm phase after short pause */
      setTimeout(function() { spPhase = 2; spUpdateDots(); }, 200);
    }
  } else {
    if (spPin2.length >= 6) return;
    spPin2 += d;
    spUpdateDots();
    if (spPin2.length === 6) setTimeout(spConfirm, 200);
  }
}

/** Delete in Set-PIN modal */
function spDelete() {
  if (spPhase === 1) { spPin1 = spPin1.slice(0,-1); }
  else               { spPin2 = spPin2.slice(0,-1); }
  spUpdateDots();
  document.getElementById('sp-error').textContent = '';
}

/** Check if the two PINs match and apply */
function spConfirm() {
  if (spPin1 !== spPin2) {
    /* Mismatch — flash error on row 2, reset confirmation */
    spUpdateDots(2);
    document.getElementById('sp-error').textContent = "PINs don't match — try again";
    setTimeout(function() { spPin2 = ''; spPhase = 2; spUpdateDots(); }, 700);
    return;
  }
  /* Match — compute new hash and apply */
  var newHash = sha256(spPin1);
  PIN_HASH = newHash;
  document.getElementById('sp-error').textContent = '';

  /* Persist via config-write.php + cookie (replaces unreliable HTTP PUT) */
  spPersistHash(newHash).then(function(saved) {
    var overlay = document.getElementById('set-pin-overlay');
    if (overlay) overlay.style.display = 'none';
    /* Show success modal — pass null if server-saved (no manual step needed),
       or the hash if config-write.php unavailable (static host fallback) */
    showPinSuccessModal(saved ? null : newHash);
  });
}

/** Skip — proceed with default PIN */
function spSkip() {
  var overlay = document.getElementById('set-pin-overlay');
  if (overlay) overlay.style.display = 'none';
  initDashboard();
}

/**
 * Show a nice success modal after PIN is set.
 * Replaces the jarring browser alert() with an in-UI confirmation.
 *
 * @param {string|null} newHash — the hash if manual update is needed, null if auto-saved
 */
function showPinSuccessModal(newHash) {
  /* Create modal if it doesn't exist */
  var existing = document.getElementById('pin-success-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'pin-success-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(15,17,23,0.85);' +
    'backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;' +
    'animation:card-in 0.25s cubic-bezier(.34,1.56,.64,1)';

  var note = newHash
    ? '<p style="font-size:var(--text-xs);color:var(--text-muted);background:var(--surface-2);' +
      'border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3) var(--space-4);' +
      'margin-top:var(--space-4);font-family:var(--font-mono);word-break:break-all;line-height:1.6">' +
      '⚠ To make it permanent, update PIN_HASH in index.html to:<br><strong>' + newHash + '</strong></p>'
    : '';

  /* Build inner HTML safely — use a temp div approach to avoid quote nesting */
  var successMsg = newHash
    ? 'Your new PIN is active. See note below to make it permanent.'
    : 'Your new PIN has been saved permanently.';

  var inner = document.createElement('div');
  inner.style.cssText = 'background:var(--surface);border:1px solid var(--border);' +
    'border-radius:var(--radius-xl);padding:var(--space-10) var(--space-8);width:min(400px,92vw);' +
    'text-align:center;box-shadow:var(--shadow-lg),var(--shadow-glow)';

  var icon = document.createElement('div');
  icon.style.cssText = 'font-size:48px;margin-bottom:var(--space-4)';
  icon.textContent = '🔐';

  var title = document.createElement('h2');
  title.style.cssText = 'font-family:var(--font-display);font-size:var(--text-lg);font-weight:700;' +
    'letter-spacing:-0.02em;margin-bottom:var(--space-2)';
  title.textContent = 'PIN set!';

  var msg = document.createElement('p');
  msg.style.cssText = 'font-size:var(--text-sm);color:var(--text-muted);margin-bottom:var(--space-2)';
  msg.textContent = successMsg;

  var btn = document.createElement('button');
  btn.style.cssText = 'margin-top:var(--space-6);padding:var(--space-3) var(--space-8);' +
    'background:var(--accent);color:#fff;border:none;border-radius:var(--radius-md);' +
    'font-family:var(--font-display);font-size:var(--text-sm);font-weight:700;cursor:pointer';
  btn.textContent = 'Open Dashboard →';
  btn.addEventListener('click', function() {
    document.getElementById('pin-success-modal').remove();
    initDashboard();
  });

  inner.appendChild(icon);
  inner.appendChild(title);
  inner.appendChild(msg);
  if (note) {
    var noteEl = document.createElement('div');
    noteEl.innerHTML = note;
    inner.appendChild(noteEl);
  }
  inner.appendChild(btn);
  modal.appendChild(inner);

  document.body.appendChild(modal);
}

/**
 * Persist a new PIN hash via config-write.php → ase_config.json.
 * Also writes to the ase_pin cookie as an immediate fallback.
 *
 * Replaces the old HTTP PUT approach (which required WebDAV/mod_dav
 * and silently failed on most shared hosts). ase_config.json is
 * written by a same-origin PHP script and works on any PHP host.
 *
 * @param {string} newHash — the new SHA-256 hash to write
 * @returns {Promise<boolean>} true if saved to server
 */
async function spPersistHash(newHash) {
  /* Always update the cookie immediately (browser-local fallback) */
  _writePinCookie(newHash);
  /* Attempt server-side persistence via config-write.php */
  return saveConfig({ pin_hash: newHash });
}



/* ────────────────────────────────────────────────────────────────
   CHANGE PIN MODAL
   Three-phase flow:
     Phase 1: Enter CURRENT PIN (verify it's correct)
     Phase 2: Enter NEW PIN
     Phase 3: Confirm NEW PIN (must match phase 2)
   On success: updates PIN_HASH in memory, attempts to persist
   to index.html via HTTP PUT (same as the set-PIN flow).
   ──────────────────────────────────────────────────────────────── */

var CP_PHASE   = 1;  /* 1=current, 2=new, 3=confirm */
var cpBuffer   = ''; /* current input buffer */
var cpNewPin   = ''; /* stored new PIN from phase 2 */

var CP_TITLES = {
  1: 'Change PIN',
  2: 'Change PIN',
  3: 'Change PIN'
};
var CP_SUBS = {
  1: 'Enter your current PIN',
  2: 'Enter your new PIN',
  3: 'Confirm your new PIN'
};

function openChangePinModal() {
  /* Activate mobile input mode (hides numpad + dots, shows native keyboard input) */
  if (_isTouchDevice) {
    var cpCard  = document.getElementById('cp-card');
    var cpInput = document.getElementById('cp-mobile-input');
    var cpDots  = document.getElementById('cp-dots');
    var cpGrid  = document.getElementById('cp-grid');

    if (cpCard)  cpCard.classList.add('mobile-pin-active');
    if (cpInput) {
      cpInput.style.display = 'block';
      cpInput.value = '';
      cpInput.classList.remove('error');
    }
    /* Dots and grid are hidden via CSS .mobile-pin-active rules,
     * but also hide explicitly for safety */
    if (cpDots) cpDots.style.display = 'none';
    if (cpGrid) cpGrid.style.display = 'none';

    /* Focus after animation completes (card-in is 250ms) */
    setTimeout(function() { try { cpInput && cpInput.focus(); } catch(e) {} }, 300);
  }
  CP_PHASE = 1; cpBuffer = ''; cpNewPin = '';
  cpUpdateDots();
  var el = document.getElementById('cp-error');
  if (el) el.textContent = '';
  cpSetTitles();
  var overlay = document.getElementById('change-pin-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeChangePinModal() {
  /* Reset mobile input on close */
  if (_isTouchDevice) {
    var cpInput = document.getElementById('cp-mobile-input');
    if (cpInput) { cpInput.value = ''; cpInput.classList.remove('error'); }
  }
  var overlay = document.getElementById('change-pin-overlay');
  if (overlay) overlay.style.display = 'none';
  CP_PHASE = 1; cpBuffer = ''; cpNewPin = '';
}

function cpSetTitles() {
  var t = document.getElementById('cp-title');
  var s = document.getElementById('cp-subtitle');
  if (t) t.textContent = CP_TITLES[CP_PHASE] || 'Change PIN';
  if (s) s.textContent = CP_SUBS[CP_PHASE] || '';
}

function cpUpdateDots(mode) {
  for (var i = 0; i < 6; i++) {
    var dot = document.getElementById('cp-dot-' + i);
    if (!dot) continue;
    dot.className = 'pin-dot';
    if (mode === 'error') dot.classList.add('error');
    else if (i < cpBuffer.length) dot.classList.add('filled');
  }
}

function cpDigit(d) {
  if (cpBuffer.length >= 6) return;
  cpBuffer += d;
  cpUpdateDots();
  document.getElementById('cp-error').textContent = '';
  if (cpBuffer.length === 6) setTimeout(cpCheck, 150);
}

function cpDelete() {
  cpBuffer = cpBuffer.slice(0, -1);
  cpUpdateDots();
  document.getElementById('cp-error').textContent = '';
}

function cpCheck() {
  if (CP_PHASE === 1) {
    /* Verify current PIN */
    if (sha256(cpBuffer) !== PIN_HASH) {
      cpUpdateDots('error');
      document.getElementById('cp-error').textContent = 'Incorrect PIN — try again';
      setTimeout(function() { cpBuffer = ''; cpUpdateDots(); }, 700);
      return;
    }
    /* Current PIN correct — move to new PIN */
    CP_PHASE = 2; cpBuffer = '';
    cpUpdateDots(); cpSetTitles();
    /* Clear mobile input for next phase entry */
    _cpClearMobileInput();

  } else if (CP_PHASE === 2) {
    /* Store new PIN, move to confirmation */
    cpNewPin = cpBuffer;
    CP_PHASE = 3; cpBuffer = '';
    cpUpdateDots(); cpSetTitles();
    _cpClearMobileInput();

  } else if (CP_PHASE === 3) {
    /* Confirm new PIN */
    if (cpBuffer !== cpNewPin) {
      cpUpdateDots('error');
      document.getElementById('cp-error').textContent = "PINs don't match — try again";
      setTimeout(function() { cpBuffer = ''; CP_PHASE = 2; cpNewPin = ''; cpUpdateDots(); cpSetTitles(); }, 700);
      return;
    }
    /* PINs match — apply change */
    var newHash = sha256(cpNewPin);
    PIN_HASH = newHash;
    closeChangePinModal();
    /* Attempt to persist */
    spPersistHash(newHash).then(function(saved) {
      showPinSuccessModal(saved ? null : newHash);
    });
  }
}

/* Keyboard support for Change PIN modal */
document.addEventListener('keydown', function(e) {
  var overlay = document.getElementById('change-pin-overlay');
  if (!overlay || overlay.style.display === 'none') return;
  if (e.key >= '0' && e.key <= '9') { cpDigit(e.key); }
  if (e.key === 'Backspace') { e.preventDefault(); cpDelete(); }
  if (e.key === 'Escape') { closeChangePinModal(); }
});


/* ────────────────────────────────────────────────────────────────
   14. INIT — entry point after PIN unlock
   1. Load domains.list (or fall back to BUILTIN)
   2. Render table immediately (shows domains before checks run)
   3. Run live DNS checks in background
   ──────────────────────────────────────────────────────────────── */

function toggleHeaderMenu(e) {
  e.stopPropagation();
  var menu   = document.getElementById('header-dropdown-menu');
  var toggle = e.currentTarget;
  var isOpen = menu.classList.contains('open');
  if (isOpen) {
    closeHeaderMenu();
  } else {
    /* Position the menu relative to the toggle button using fixed coords
       so it escapes the header's stacking context (position:sticky z-index:100) */
    var rect = toggle.getBoundingClientRect();
    menu.style.top   = (rect.bottom + 6) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.left  = 'auto';
    menu.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }
}

function closeHeaderMenu() {
  var menu   = document.getElementById('header-dropdown-menu');
  var toggle = document.querySelector('.header-dropdown-toggle');
  if (menu)   menu.classList.remove('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

/* Outside-click: close dropdown when clicking anywhere outside the .header-dropdown.
   Uses document-level listener — avoids z-index stacking context conflicts
   caused by the sticky header's own stacking context. */
document.addEventListener('click', function(e) {
  var dropdown = document.querySelector('.header-dropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    closeHeaderMenu();
  }
});

/**
 * initDashboard — called after successful PIN unlock (or webhook mode).
 * Loads domain list, renders skeleton table immediately, then fires
 * a full DNS+SSL check automatically — no manual Refresh needed.
 */
async function initDashboard() {
  await loadDomainList();
  renderTable();   /* render skeleton with domain names right away */
  updateStats();
  /* Auto-scan fires immediately on login — table populates progressively */
  await checkAll();
}


/* ────────────────────────────────────────────────────────────────
   MOBILE PIN INPUT
   On touch devices, the custom numpad causes double-tap zoom.
   Instead, we show a native <input type="password" inputmode="numeric">
   which triggers the system numeric keyboard — no zoom, no double-tap
   issues, full OS-level accessibility.

   Detection: navigator.maxTouchPoints > 0 (covers iOS, Android, tablets).
   The numpad is hidden on touch devices; the input field is shown.
   Both paths call the same pinBuffer + pinCheck() logic.

   Why not replace the numpad entirely?
   The numpad still works in sandboxed iframes (Perplexity preview) where
   focus() may not work. We keep both: numpad for non-touch, input for touch.
   ──────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────
   MOBILE PIN INPUT — INIT  (v4.1.0)
   ─────────────────────────────────────────────────────────────────
   Called once at page load to set up the native numeric keyboard
   experience on touch devices (phones, tablets).

   WHAT WAS WRONG (v3.x / v4.0.0):
   ─────────────────────────────────
   1. DUPLICATE DOTS: the original pin-dots (6 circles) were left visible
      alongside the native input which shows its own • • • • • • placeholder.
      Fix: add .mobile-pin-active class to .pin-card → CSS hides pin-dots and
      pin-grid via .pin-card.mobile-pin-active rules in app.css.

   2. INPUT NOT CENTRED: width:200px with no margin:auto — rendered
      left-aligned inside the card. Fix: width:100%, max-width:280px,
      margin: 0 auto, set in app.css.

   3. AUTO-FOCUS NEVER FIRED: the MutationObserver watched for style.display
      changes on #pin-overlay, but the overlay is visible from page load
      with no style attribute — it's shown via CSS, not JS. The observer
      never triggered because there was never a style change to observe.
      Fix: use requestAnimationFrame + setTimeout chain after DOMContentLoaded.
      Also re-focus whenever the overlay is un-hidden (pin error reset).

   4. CHANGE PIN MODAL: same focus issue — fixed by calling focusMobilePinInput()
      from openChangePinModal() and openNotifyModal() where PIN entry is needed.
   ──────────────────────────────────────────────────────────────── */

/** True when running on a touch device — set once at init */
var _isTouchDevice = false;

(function initMobilePinInput() {
  /* Detect genuine touch devices — exclude laptops with touch screens
     by also checking pointer type and screen width */
  var hasTouch   = navigator.maxTouchPoints > 0;
  var isNarrow   = window.innerWidth < 1024;
  if (!hasTouch || !isNarrow) return;

  _isTouchDevice = true;

  var card  = document.querySelector('.pin-card');
  var input = document.getElementById('pin-mobile-input');
  var hint  = document.querySelector('.pin-hint');
  if (!input || !card) return;

  /* ── 1. Switch pin-card to mobile mode ──────────────────────
     Adding .mobile-pin-active causes CSS to hide:
       • .pin-dots   (the 6 circle indicators)
       • .pin-grid   (the custom numpad)
     The native input replaces both visually. */
  card.classList.add('mobile-pin-active');
  input.style.display = 'block';

  /* Update the hint text to match the new UX */
  if (hint) hint.textContent = 'Tap to type your PIN';

  /* ── 2. Auto-focus immediately on page load ─────────────────
     The PIN overlay is visible from initial page render (no JS
     display:none set on it). We can't use a MutationObserver
     because there's no style change to observe on first load.
     requestAnimationFrame ensures the DOM is painted before focus(). */
  requestAnimationFrame(function() {
    setTimeout(function() { _focusMobilePin(); }, 120);
  });
})();

/**
 * Focus the mobile PIN input, if on a touch device.
 * Called from openChangePinModal() and whenever the PIN overlay
 * is re-shown (e.g. after a PIN error reset).
 *
 * Uses a small delay to ensure the element is visible and interactive
 * before calling focus() — iOS requires this.
 */
function _focusMobilePin() {
  if (!_isTouchDevice) return;
  var input = document.getElementById('pin-mobile-input');
  if (!input || input.style.display === 'none') return;
  /* Clear any previous value */
  input.value = '';
  input.classList.remove('error');
  /* Small delay: iOS needs the element to be in a painted, interactive state */
  setTimeout(function() {
    try { input.focus(); } catch(e) {}
  }, 80);
}

/**
 * Handler for the mobile <input> PIN field.
 * Keeps the input in sync with pinBuffer and calls pinCheck when 6 digits entered.
 * @param {HTMLInputElement} el
 */
function pinMobileInput(el) {
  /* Strip non-digits (some keyboards may inject other chars) */
  var raw = el.value.replace(/\D/g, '').slice(0, 6);
  el.value = raw;

  /* Sync with pinBuffer so the dot indicators update */
  pinBuffer = raw;
  pinUpdateDots('normal');
  document.getElementById('pin-error').textContent = '';

  if (raw.length === 6) {
    el.blur(); /* dismiss keyboard */
    setTimeout(function() {
      /* Run check — on failure, clear the input */
      var valid = (sha256(pinBuffer) === PIN_HASH);
      if (!valid) {
        el.value = '';
        el.classList.add('error');
        setTimeout(function() { el.classList.remove('error'); }, 700);
      }
      pinCheck();
    }, 150);
  }
}


/* ────────────────────────────────────────────────────────────────
   EMAIL NOTIFICATIONS (v3.1.0+)
   ─────────────────────────────────────────────────────────────────
   Sends email alerts via notify.php → Resend API when a domain
   transitions UP→DOWN or DOWN→UP (recovery).

   Configuration is stored encrypted in ase_config.json.
   The API key is encrypted server-side (AES-256-GCM) and never
   exposed to the browser in plaintext.

   Rate limiting (server-side): max 10 emails per hour.
   ──────────────────────────────────────────────────────────────── */

/** In-memory notification config (loaded from server config) */
var _notifyConfig = { enabled: false, from: '', to: '' };

/** Update notification config from server config object */
function applyNotifyConfig(cfg) {
  _notifyConfig.enabled = !!(cfg && cfg.notify_enabled);
  _notifyConfig.from    = (cfg && cfg.notify_from) || '';
  _notifyConfig.to      = (cfg && cfg.notify_to)   || '';
  _notifyConfig.hasKey  = !!(cfg && cfg.notify_api_key_enc);
  /* Update menu dot once config is loaded */
  if (typeof _notifyUpdateMenuDot === 'function') _notifyUpdateMenuDot();
}

/**
 * Fire a downtime or recovery notification.
 * Enriches the payload with the full domain health snapshot:
 * SSL expiry, DMARC, SPF, NS, MX — so the email shows a complete
 * health digest, not just "domain is down".
 *
 * Non-blocking — errors are caught silently.
 * Only fires if notifications are enabled and configured.
 *
 * @param {string}      domain
 * @param {string}      status   "DOWN" | "UP"
 * @param {number|null} latency  round-trip ms or null
 */
async function notifyDowntime(domain, status, latency) {
  if (!_notifyConfig.enabled || !_notifyConfig.hasKey) return;

  /* Collect full domain health snapshot from in-memory DOMAINS array.
   * domainState holds live check results (up/latency/history).
   * DOMAINS holds the enriched entry (sslExpiry, dmarc, spf, ns, mxType). */
  var entry = DOMAINS.find(function(d) { return d.domain === domain; }) || {};
  /* domainState[domain] is available for future enrichment (e.g. history) */

  /* Calculate SSL days remaining */
  var sslDays = null;
  if (entry.sslExpiry) {
    var expMs = new Date(entry.sslExpiry).getTime();
    if (!isNaN(expMs)) {
      sslDays = Math.ceil((expMs - Date.now()) / 86400000);
    }
  }

  try {
    await fetch('./notify.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:     'notify',
        domain:     domain,
        status:     status,
        latency:    latency || null,
        ssl_expiry: entry.sslExpiry  || null,
        ssl_days:   sslDays,
        dmarc:      entry.dmarc      || null,
        spf:        entry.spf        || null,
        ns:         entry.ns         || null,
        mx:         entry.mxType     || null
      })
    });
  } catch(e) { /* silent — notifications are best-effort */ }
}

/**
 * Send a test email via notify.php.
 * Returns { ok: true } or { error: '...' }.
 */
async function sendTestNotification() {
  try {
    var res = await fetch('./notify.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' })
    });
    return await res.json();
  } catch(e) {
    return { error: e.message };
  }
}


/* ────────────────────────────────────────────────────────────────
   NOTIFICATIONS MODAL  (v3.1.0+)
   ─────────────────────────────────────────────────────────────────
   UI for configuring Resend email alerts.
   Settings are saved to ase_config.json via config-write.php.
   The API key is encrypted server-side before storage — this JS
   only ever sees the plaintext key while the user is typing.
   ──────────────────────────────────────────────────────────────── */

function openNotifyModal() {
  var m = document.getElementById('notify-modal');
  if (!m) return;
  m.classList.add('open');
  var body = m.querySelector('.modal-body');
  if (body) body.scrollTop = 0;

  /* Populate fields from in-memory config */
  var toggle = document.getElementById('notify-enabled-toggle');
  if (toggle) {
    toggle.checked = _notifyConfig.enabled;
    _notifyUpdateToggleTrack(toggle.checked);
  }
  var fromEl = document.getElementById('notify-from');
  var toEl   = document.getElementById('notify-to');
  if (fromEl) fromEl.value = _notifyConfig.from || '';
  if (toEl)   toEl.value   = _notifyConfig.to   || '';

  /* Show key status */
  var keyStatus = document.getElementById('notify-key-status');
  if (keyStatus) {
    keyStatus.textContent = _notifyConfig.hasKey
      ? '🔒 API key saved (encrypted server-side)'
      : 'No API key saved yet';
    keyStatus.style.color = _notifyConfig.hasKey ? 'var(--green)' : 'var(--text-muted)';
  }

  /* Clear any previous messages */
  var msg = document.getElementById('notify-msg');
  if (msg) msg.textContent = '';
}

function closeNotifyModal() {
  var m = document.getElementById('notify-modal');
  if (m) m.classList.remove('open');
}

function notifyToggleChanged(checkbox) {
  _notifyUpdateToggleTrack(checkbox.checked);
}

function _notifyUpdateToggleTrack(checked) {
  var track = document.getElementById('notify-toggle-track');
  if (!track) return;
  track.style.background = checked ? 'var(--accent)' : 'var(--border)';
  var thumb = track.querySelector('span');
  if (thumb) thumb.style.transform = checked ? 'translateX(20px)' : 'translateX(0)';
}

function notifyToggleKeyVisibility() {
  var input = document.getElementById('notify-api-key');
  var icon  = document.getElementById('notify-eye-icon');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    input.type = 'password';
    if (icon) icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

/**
 * Save notification settings to server via config-write.php.
 * Only sends the API key if the field is non-empty (avoids overwriting
 * an existing encrypted key with an empty string).
 */
async function saveNotifySettings() {
  var btn     = document.querySelector('#notify-modal .btn-accent');
  var msg     = document.getElementById('notify-msg');
  var enabled = document.getElementById('notify-enabled-toggle').checked;
  var from    = (document.getElementById('notify-from').value || '').trim();
  var to      = (document.getElementById('notify-to').value || '').trim();
  var apiKey  = (document.getElementById('notify-api-key').value || '').trim();

  /* Validate */
  if (enabled) {
    if (!from || !from.includes('@')) {
      if (msg) { msg.textContent = '⚠ Please enter a valid From email.'; msg.style.color = 'var(--red)'; }
      return;
    }
    if (!to || !to.includes('@')) {
      if (msg) { msg.textContent = '⚠ Please enter a valid To email.'; msg.style.color = 'var(--red)'; }
      return;
    }
    if (!apiKey && !_notifyConfig.hasKey) {
      if (msg) { msg.textContent = '⚠ Please enter your Resend API key.'; msg.style.color = 'var(--red)'; }
      return;
    }
  }

  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  var payload = {
    notify_enabled: enabled,
    notify_from:    from,
    notify_to:      to
  };
  if (apiKey) payload.notify_api_key = apiKey; /* only send if user typed a new key */

  try {
    var res  = await saveConfig(payload);
    if (res) {
      /* Update in-memory config */
      _notifyConfig.enabled = enabled;
      _notifyConfig.from    = from;
      _notifyConfig.to      = to;
      if (apiKey) _notifyConfig.hasKey = true;

      /* Update status dot in menu */
      _notifyUpdateMenuDot();

      /* Clear API key field (show status instead) */
      document.getElementById('notify-api-key').value = '';
      var keyStatus = document.getElementById('notify-key-status');
      if (keyStatus) {
        keyStatus.textContent = '🔒 API key saved (encrypted server-side)';
        keyStatus.style.color = 'var(--green)';
      }

      if (msg) { msg.textContent = '✓ Settings saved.'; msg.style.color = 'var(--green)'; }
    } else {
      if (msg) { msg.textContent = '⚠ Save failed — is config-write.php uploaded?'; msg.style.color = 'var(--red)'; }
    }
  } catch(e) {
    if (msg) { msg.textContent = '⚠ Error: ' + e.message; msg.style.color = 'var(--red)'; }
  }

  if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
}

/** Update the green dot in the More menu to reflect notification status */
function _notifyUpdateMenuDot() {
  var dot = document.getElementById('notify-status-dot');
  if (!dot) return;
  dot.style.display = (_notifyConfig.enabled && _notifyConfig.hasKey) ? 'inline-block' : 'none';
}

/** Show result of test email send */
function notifyShowTestResult(result) {
  var msg = document.getElementById('notify-msg');
  if (!msg) return;
  if (result && result.ok) {
    msg.textContent = '✓ Test email sent! Check your inbox.';
    msg.style.color = 'var(--green)';
  } else {
    var err = (result && result.error) ? result.error : 'Unknown error';
    /* Handle not-configured gracefully */
    if (err.includes('disabled') || err.includes('incomplete')) {
      msg.textContent = '⚠ Save your settings first, then test.';
    } else {
      msg.textContent = '✗ Failed: ' + err;
    }
    msg.style.color = 'var(--red)';
  }
}

/* Keyboard: Escape closes notification modal */
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var m = document.getElementById('notify-modal');
    if (m && m.classList.contains('open')) { closeNotifyModal(); }
  }
});


/* ────────────────────────────────────────────────────────────────
   HEALTH REPORT NOTIFICATIONS  (v3.3.0+)
   ─────────────────────────────────────────────────────────────────
   After every full checkAll() cycle (including after SSL data arrives),
   this function scans ALL domains for health issues and sends a single
   digest email if anything is worth reporting.

   Design decisions:
   ─────────────────
   • ONE email per full scan cycle (not one per domain) — avoids flooding
     the inbox when multiple domains have the same issue.
   • Deduplication: _notifyLastSent[key] tracks when each alert type was
     last sent for each domain. Default cooldown: 24h for health issues,
     immediate for DOWN/UP transitions (those fire in uptimeRecord).
   • Threshold for "worth reporting":
       - Any domain DOWN
       - SSL expiring within 30 days
       - DMARC missing or p=none
       - SPF missing
   • If nothing is wrong, no email is sent (and nothing is logged).
   ──────────────────────────────────────────────────────────────── */

/* Tracks last notification timestamp per domain+type.
   Key format: "domain:type" e.g. "example.com:ssl_expiry"
   Prevents re-sending the same alert every 3 minutes. */
/**
 * _notifyLastSent — tracks when each domain+type alert was last sent.
 * Key: "domain:type"  Value: Unix timestamp (ms)
 *
 * Persistence: saved to ase_config.json via saveConfig() after each scan,
 * loaded by loadConfig() on startup. This means cooldowns survive page
 * reloads AND work correctly across browser sessions on the same server.
 *
 * Why not a cookie?  The data can be large (50 domains × 5 types = 250 keys).
 * ase_config.json has no size limit. Cookies are capped at 4KB.
 */
var _notifyLastSent = {};

/**
 * Cooldown periods (ms) for each alert type.
 *
 * Two modes:
 *   AUTO  — auto-refresh every 3 minutes. Use long cooldowns to prevent spam.
 *   MANUAL — user explicitly clicked Refresh. Use short cooldown (5 min) so
 *            they get confirmation that the system is working.
 *
 * Design rationale:
 *   A user who clicks Refresh wants to know the current state NOW.
 *   If their SSL is expiring, they should see an email immediately on demand.
 *   Auto-refresh running every 3 minutes should NOT generate 480 emails/day.
 */
var NOTIFY_COOLDOWN_AUTO = {
  ssl_expiry:      86400000,  /* 24h — health issues checked once/day is enough */
  dmarc_missing:   86400000,  /* 24h */
  dmarc_none:      86400000,  /* 24h */
  spf_missing:     86400000,  /* 24h */
  down:            3600000,   /* 1h  — repeated downtime reminders every hour */
};

var NOTIFY_COOLDOWN_MANUAL = {
  ssl_expiry:      300000,   /* 5 min — manual refresh gives fresh report */
  dmarc_missing:   300000,   /* 5 min */
  dmarc_none:      300000,   /* 5 min */
  spf_missing:     300000,   /* 5 min */
  down:            60000,    /* 1 min — if still down, confirm immediately */
};

/* Active cooldown map — set to MANUAL when user clicks Refresh,
 * AUTO for auto-refresh cycles. Reset after each sendHealthReport() call. */
var _activeCooldown = NOTIFY_COOLDOWN_AUTO;

/**
 * Check if a notification for domain+type is past its cooldown.
 * @param {string} domain
 * @param {string} type  — one of the NOTIFY_COOLDOWN keys
 * @returns {boolean}  true = allowed to send
 */
function _notifyCooldownOk(domain, type) {
  var key      = domain + ':' + type;
  var last     = _notifyLastSent[key] || 0;
  var cooldown = _activeCooldown[type] || 86400000;
  return (Date.now() - last) >= cooldown;
}

/**
 * Mark a notification as sent (updates cooldown timestamp).
 * @param {string} domain
 * @param {string} type
 */
function _notifyMarkSent(domain, type) {
  _notifyLastSent[domain + ':' + type] = Date.now();
}

/**
 * Scan all domains after a full check cycle and send a digest email
 * if any health issues are found.
 *
 * Called from checkAll() after both DNS and SSL data are available.
 * Also called from sendTestNotification() with isTest=true.
 *
 * A "digest" combines all issues across all domains into ONE email —
 * far more useful than per-domain emails for a monitoring dashboard.
 *
 * @param {boolean} [force=false]  If true, bypass cooldown (used for test)
 */
/**
 * @param {boolean} [isManual=false]  True = user clicked Refresh.
 *   Uses shorter cooldowns so manual checks always get a fresh report.
 * @param {boolean} [force=false]     True = bypass all cooldowns (test only).
 */
async function sendHealthReport(isManual, force) {
  if (!_notifyConfig.enabled || !_notifyConfig.hasKey) return;

  /* Switch cooldown table based on how the check was triggered */
  _activeCooldown = (force) ? { ssl_expiry:0, dmarc_missing:0, dmarc_none:0, spf_missing:0, down:0 }
                 : (isManual) ? NOTIFY_COOLDOWN_MANUAL
                 : NOTIFY_COOLDOWN_AUTO;

  var issues = [];  /* array of issue objects to include in the digest */

  DOMAINS.forEach(function(entry) {
    var domain = entry.domain;
    var st     = domainState[domain] || {};

    /* ── DOWN ── */
    if (st.up === false && (force || _notifyCooldownOk(domain, 'down'))) {
      issues.push({
        domain:     domain,
        type:       'down',
        severity:   'critical',
        label:      'Domain Unreachable',
        detail:     'A record lookup returned no results — domain is not resolving.',
        latency:    null,
        ssl_expiry: entry.sslExpiry  || null,
        ssl_days:   _calcSslDays(entry.sslExpiry),
        dmarc:      entry.dmarc      || null,
        spf:        entry.spf        || null,
        ns:         entry.ns         || null,
        mx:         entry.mxType     || null
      });
      if (!force) _notifyMarkSent(domain, 'down');
    }

    /* ── SSL expiry ── */
    var sslDays = _calcSslDays(entry.sslExpiry);
    if (sslDays !== null && sslDays <= 30) {
      var sslType = sslDays <= 7 ? 'ssl_critical' : 'ssl_expiry';
      /* Use ssl_expiry cooldown key for both */
      if (force || _notifyCooldownOk(domain, 'ssl_expiry')) {
        issues.push({
          domain:     domain,
          type:       sslType,
          severity:   sslDays <= 7 ? 'critical' : 'warning',
          label:      sslDays <= 0 ? 'SSL Expired' : (sslDays <= 7 ? 'SSL Expiring — Urgent' : 'SSL Expiring Soon'),
          detail:     sslDays <= 0
            ? 'Certificate has expired — visitors see a browser security warning.'
            : 'Certificate expires in ' + sslDays + ' day' + (sslDays === 1 ? '' : 's') + '.',
          latency:    st.latency     || null,
          ssl_expiry: entry.sslExpiry,
          ssl_days:   sslDays,
          dmarc:      entry.dmarc    || null,
          spf:        entry.spf      || null,
          ns:         entry.ns       || null,
          mx:         entry.mxType   || null
        });
        if (!force) _notifyMarkSent(domain, 'ssl_expiry');
      }
    }

    /* ── DMARC missing ── */
    if (entry.dmarc === 'missing' && (force || _notifyCooldownOk(domain, 'dmarc_missing'))) {
      issues.push({
        domain:   domain,
        type:     'dmarc_missing',
        severity: 'warning',
        label:    'DMARC Missing',
        detail:   'No DMARC policy — domain is vulnerable to email spoofing.',
        ssl_expiry: entry.sslExpiry || null,
        ssl_days:   sslDays,
        dmarc:    'missing',
        spf:      entry.spf   || null,
        ns:       entry.ns    || null,
        mx:       entry.mxType || null
      });
      if (!force) _notifyMarkSent(domain, 'dmarc_missing');
    }

    /* ── DMARC p=none (defined but not enforced) ── */
    if (entry.dmarc === 'none' && (force || _notifyCooldownOk(domain, 'dmarc_none'))) {
      issues.push({
        domain:   domain,
        type:     'dmarc_none',
        severity: 'warning',
        label:    'DMARC Not Enforced',
        detail:   'p=none — DMARC is defined but provides no protection. Use p=quarantine or p=reject.',
        ssl_expiry: entry.sslExpiry || null,
        ssl_days:   sslDays,
        dmarc:    'none',
        spf:      entry.spf   || null,
        ns:       entry.ns    || null,
        mx:       entry.mxType || null
      });
      if (!force) _notifyMarkSent(domain, 'dmarc_none');
    }

    /* ── SPF missing ── */
    if (!entry.spf && (force || _notifyCooldownOk(domain, 'spf_missing'))) {
      issues.push({
        domain:   domain,
        type:     'spf_missing',
        severity: 'warning',
        label:    'SPF Missing',
        detail:   'No SPF record — increases spam rejection risk.',
        ssl_expiry: entry.sslExpiry || null,
        ssl_days:   sslDays,
        dmarc:    entry.dmarc  || null,
        spf:      null,
        ns:       entry.ns     || null,
        mx:       entry.mxType || null
      });
      if (!force) _notifyMarkSent(domain, 'spf_missing');
    }
  });

  /* Always reset to auto cooldown for next cycle */
  _activeCooldown = NOTIFY_COOLDOWN_AUTO;

  if (issues.length === 0) {
    /* All clear — persist the updated last-sent timestamps so cooldowns
     * survive a page reload even when there's nothing to report */
    _notifySaveState();
    return;
  }

  /* Send single digest covering all issues */
  try {
    var res = await fetch('./notify.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:        'digest',
        issues:        issues,
        total_domains: DOMAINS.length,
        domains_down:  DOMAINS.filter(function(d) { return (domainState[d.domain]||{}).up === false; }).length
      })
    });
    var json = await res.json();
    if (json && json.ok) {
      console.log('[Eye] Health digest sent (' + issues.length + ' issue(s))');
      /* Persist updated send timestamps to survive page reload */
      _notifySaveState();
    }
  } catch(e) {
    /* Silent — notifications are best-effort */
  }
}

/**
 * Save _notifyLastSent to ase_config.json so cooldowns persist across
 * page reloads and browser sessions on the same server.
 * Fire-and-forget — never blocks the UI.
 */
function _notifySaveState() {
  if (Object.keys(_notifyLastSent).length === 0) return;
  saveConfig({ notify_last_sent: _notifyLastSent }).catch(function(){});
}

/**
 * Load _notifyLastSent from server config.
 * Called by loadConfig() — already runs at startup before PIN is shown.
 * @param {Object} cfg  The full config object from ase_config.json
 */
function _notifyLoadState(cfg) {
  if (cfg && cfg.notify_last_sent && typeof cfg.notify_last_sent === 'object') {
    _notifyLastSent = cfg.notify_last_sent;
    console.log('[Eye] Notification state loaded (' + Object.keys(_notifyLastSent).length + ' entries)');
  }
}

/**
 * Calculate days until SSL expiry from a date string.
 * @param {string|null} sslExpiry  — "YYYY-MM-DD" or null
 * @returns {number|null}
 */
function _calcSslDays(sslExpiry) {
  if (!sslExpiry) return null;
  var expMs = new Date(sslExpiry).getTime();
  if (isNaN(expMs)) return null;
  return Math.ceil((expMs - Date.now()) / 86400000);
}


/**
 * Handler for the mobile Change-PIN input field.
 * Mirrors cpDigit() / cpDelete() logic but driven by native keyboard input.
 * The cp-mobile-input is shown on touch devices instead of the numpad.
 *
 * @param {HTMLInputElement} el
 */

/** Clear and re-focus the cp-mobile-input between PIN phases (on mobile) */
function _cpClearMobileInput() {
  if (!_isTouchDevice) return;
  var inp = document.getElementById('cp-mobile-input');
  if (!inp) return;
  inp.value = '';
  inp.classList.remove('error');
  setTimeout(function() { try { inp.focus(); } catch(e) {} }, 100);
}

function cpMobileInput(el) {
  /* Strip non-digits */
  var raw = el.value.replace(/\D/g, '').slice(0, 6);
  el.value = raw;

  /* Sync visual dot indicators */
  cpBuffer = raw;
  cpUpdateDots();
  document.getElementById('cp-error').textContent = '';

  if (raw.length === 6) {
    el.blur();  /* dismiss keyboard */
    setTimeout(function() {
      /* Run the phase check — same path as cpDigit() reaching 6 chars */
      cpCheck();
      /* On wrong PIN: clear input + show error state */
      if (cpBuffer === '') {
        el.value = '';
        el.classList.add('error');
        setTimeout(function() { el.classList.remove('error'); el.value = ''; }, 700);
      } else {
        /* Advanced to next phase — clear input for next entry */
        el.value = '';
      }
    }, 150);
  }
}

/* ── Page bootstrap ─────────────────────────────────────────────
   Order of operations on every page load:
     1. loadConfig()     — fetch ase_config.json (may override PIN_HASH + theme)
     2. checkWebhookMode() — if webhook.do is calling us, run headless and exit
     3. PIN overlay     — shown by default in HTML; initDashboard() called on unlock
   ──────────────────────────────────────────────────────────────── */
(async function bootstrap() {
  /* Load server config BEFORE showing PIN overlay — so the correct PIN hash
     is in memory when the user enters their PIN. */
  await loadConfig();

  if (!checkWebhookMode()) {
    /* Normal mode — PIN gate is already visible in the HTML.
       initDashboard() is called by pinCheck() → checkFirstUse() after unlock. */
    console.log('[Eye] Ready. Config loaded. Waiting for PIN...');
  }
})();
