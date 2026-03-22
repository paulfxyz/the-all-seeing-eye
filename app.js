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
   4. Domain data   — BUILTIN top-30 list + TOOLTIPS for hover details
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
   Defaults to dark. No storage — state lives in the checkbox.
   ──────────────────────────────────────────────────────────────── */
(function() {
  document.documentElement.setAttribute('data-theme', 'dark');
  var cb = document.getElementById('theme-checkbox');
  if (cb) {
    cb.checked = false;
    cb.addEventListener('change', function() {
      document.documentElement.setAttribute('data-theme', this.checked ? 'light' : 'dark');
    });
  }
})();


/* ────────────────────────────────────────────────────────────────
   4. DOMAIN DATA — built-in top-30 seed + tooltip details
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
    var spfCls      = d.spf === '~all' ? 'spf-soft' : (d.spf ? 'spf-pass' : 'spf-missing');
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
      '<td><span class="cat-badge cat-' + (d.cat||'custom') + '">' + (CAT_LABELS[d.cat]||'Custom') + '</span></td>' +
      '<td><div class="status-cell">' +
        '<span class="status-dot ' + dotCls + '"></span>' +
        '<span class="status-label ' + statusCls + '">' + statusLabel + '</span>' +
        '<div class="sparkline">' + sparklineHTML(st.history) + '</div>' +
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
var _lastCheckAll   = 0;       /* timestamp of last full run */
var _domainLastCheck = {};     /* timestamp of last per-domain check */
var CHECK_ALL_MIN_GAP  = 10000;  /* ms — minimum gap between full refreshes */
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

  /* ── Registrar / branded NS that contains the domain name ──
   * e.g. ns1.paulfleury.com → "Paulfleury", ns1.mysite.net → "Mysite"
   * Only triggers when at least one NS host contains the domain apex.
   */
  var hasDomainInNS = hosts.some(function(host) { return host.includes(domainApex); });
  if (hasDomainInNS) return capitalise(domainApex.split('.')[0]);

  return 'Own';
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
  return 'Own';
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
 * For built-in top-30 domains, NS/MX/DMARC/SPF are pre-seeded
 * from scan data. For custom domains, we look them up live.
 *
 * @param {string} domain — bare domain name e.g. "paulfleury.com"
 * @param {boolean} fullScan — if true, also fetch NS/MX/TXT/DMARC
 */

/**
 * Fetch SSL certificate expiry for a domain via crt.sh.
 *
 * crt.sh is a certificate transparency log search service.
 * We query for all valid certs for the domain, sort by expiry
 * (newest first), and return the soonest-expiring valid cert.
 *
 * @param  {string} domain — bare domain name
 * @returns {Promise<{expiry:string, issuer:string}|null>}
 *          ISO date string + short issuer name, or null on failure
 */
async function fetchSSLExpiry(domain) {
  try {
    /* Use ?q=domain to get all certs including wildcards and SANs.
     * exclude=expired avoids loading thousands of old records. */
    var url = 'https://crt.sh/?q=' + encodeURIComponent(domain) + '&output=json&exclude=expired';
    var res = await fetch(url, {
      signal: AbortSignal.timeout(5000) /* generous timeout — crt.sh can be slow */
    });
    if (!res.ok) return null;
    var certs = await res.json();
    if (!Array.isArray(certs) || certs.length === 0) return null;

    var now = new Date();

    /* Filter to certs that are genuinely valid today, then sort
     * by expiry descending so we pick the one expiring latest. */
    var valid = certs
      .filter(function(c) { return c.not_after && new Date(c.not_after) > now; })
      .sort(function(a, b) { return new Date(b.not_after) - new Date(a.not_after); });

    if (valid.length === 0) return null;

    var best = valid[0];

    /* Parse expiry — crt.sh returns ISO format: "2026-05-18T12:00:00" */
    var expiry = best.not_after.split('T')[0]; /* keep YYYY-MM-DD only */

    /* Detect issuer — Let's Encrypt uses CN starting with E5/E6/E7/R3/R10/R11 */
    var cn = (best.issuer_name || '').replace(/.*CN=/, '').replace(/,.*/, '').trim();
    var isLE = /^(R\d+|E\d+|Let'?s Encrypt)/i.test(cn);
    var issuer = isLE ? 'LE' : (cn.length > 20 ? cn.slice(0, 20) : cn);

    return { expiry: expiry, issuer: issuer };
  } catch(e) {
    /* Timeout or CORS error — fail silently */
    return null;
  }
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
   * The built-in top-30 list has accurate seeded expiry dates from a
   * real scan — we only enrich custom domains (sslExpiry === null).
   * ──────────────────────────────────────────────────────────────── */
  /* ── SSL expiry check ────────────────────────────────────────────────
   * Fires for any domain without a seeded expiry date (i.e. all domains
   * loaded from domains.list that aren't in the built-in top-30).
   * Uses _sslChecked set to avoid re-querying on every refresh cycle.
   * crt.sh is CORS-enabled; 5s timeout; result updates row when ready.
   * ──────────────────────────────────────────────────────────────── */
  if (entry && !entry.sslExpiry && !_sslChecked[domain]) {
    _sslChecked[domain] = true; /* mark so we don't re-fetch on next refresh */
    fetchSSLExpiry(domain).then(function(result) {
      if (result && entry) {
        entry.sslExpiry = result.expiry;
        entry.sslIssuer = result.issuer;
        renderTable();
        updateStats();
      } else {
        /* crt.sh failed — allow retry on next page load but not this session */
        /* _sslChecked[domain] stays true to avoid hammering crt.sh */
      }
    });
  }

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
  saveDomainsStats();

  /* Hide the animated scan progress bar */
  var spw = document.getElementById('scan-progress-wrap');
  if (spw) spw.classList.add('hidden');

  _checkRunning = false;
}

/**
 * REFRESH BUTTON — resets countdown and calls checkAll.
 *
 * Visual feedback:
 *  - Button icon becomes a spinning ↺ while scan runs
 *  - Button text shows "Checking…"
 *  - Button is disabled to prevent double-click
 *  - On completion, button restores to original state
 *  - If rate-limited, button shows remaining wait time
 */
function triggerRefresh() {
  var now = Date.now();
  var btn = document.getElementById('btn-refresh');

  /* Anti-spam: show wait feedback if too soon */
  if (_checkRunning || now - _lastCheckAll < CHECK_ALL_MIN_GAP) {
    if (btn) {
      var waitSec = Math.ceil((CHECK_ALL_MIN_GAP - (now - _lastCheckAll)) / 1000);
      btn.innerHTML = _checkRunning
        ? '<span style="display:inline-flex;align-items:center;gap:6px"><svg style="animation:spin 0.7s linear infinite" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>Running…</span>'
        : '⏳ Wait ' + waitSec + 's';
      btn.disabled = true;
      setTimeout(function() { setRefreshBtnNormal(); }, Math.max(2000, CHECK_ALL_MIN_GAP - (now - _lastCheckAll)));
    }
    return;
  }

  refreshTimer = 180;
  var pf = document.getElementById('progress-fill');
  if (pf) pf.style.width = '100%';

  /* Set button to "checking" state */
  setRefreshBtnLoading();

  /* Run the checks — restore button when done */
  checkAll().then(function() {
    setRefreshBtnNormal();
  });
}

/** Set refresh button to spinning/loading state */
function setRefreshBtnLoading() {
  var btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.disabled = true;
  btn.setAttribute('data-original', btn.innerHTML);
  btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px">'
    + '<svg style="animation:spin 0.7s linear infinite;flex-shrink:0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>'
    + 'Checking…</span>';
}

/** Restore refresh button to normal state */
function setRefreshBtnNormal() {
  var btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.disabled = false;
  var orig = btn.getAttribute('data-original');
  if (orig) btn.innerHTML = orig;
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
   Falls back silently to BUILTIN top-30 if file is absent.
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
    console.log('[Eye] domains.list unavailable (' + e.message + ') — using built-in top-30');
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
  var cat = document.getElementById('add-cat');
  if (cat) cat.value = 'custom';
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

  var cat = (document.getElementById('add-cat')||{}).value || 'custom';
  pendingQueue.push({ domain: domain, cat: cat });
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
      pendingQueue.push({ domain: domain, cat: (document.getElementById('add-cat')||{}).value||'custom' });
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
  if (m) m.classList.add('open');
}
function closeWebhookModal() {
  var m = document.getElementById('webhook-modal');
  if (m) m.classList.remove('open');
}
function openInfoModal() {
  var m = document.getElementById('info-modal');
  if (m) m.classList.add('open');
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

  /* Attempt to persist the new hash into index.html via HTTP PUT */
  spPersistHash(newHash).then(function(saved) {
    var overlay = document.getElementById('set-pin-overlay');
    if (overlay) overlay.style.display = 'none';
    if (!saved) {
      /* PUT failed — show the hash so they can update manually */
      showPinSuccessModal(newHash);
    }
    initDashboard();
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
 * Try to rewrite the PIN_HASH line in index.html via HTTP PUT.
 * This works on servers that support it (Apache mod_dav, Nginx with
 * dav_methods, or a custom write endpoint). Fails silently on static
 * hosts — the user gets a manual instruction dialog instead.
 *
 * @param {string} newHash — the new SHA-256 hash to write
 * @returns {Promise<boolean>} true if successfully saved
 */
async function spPersistHash(newHash) {
  try {
    /* Fetch the current index.html source */
    var res = await fetch('./index.html', { cache: 'no-cache' });
    if (!res.ok) return false;
    var src = await res.text();

    /* Replace the PIN_HASH line — match both the old default and any previous custom hash */
    var updated = src.replace(
      /var PIN_HASH = '[a-f0-9]{64}';/,
      "var PIN_HASH = '" + newHash + "';"
    );
    if (updated === src) return false; /* no replacement made */

    /* PUT the updated file back */
    var put = await fetch('./index.html', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: updated
    });
    return put.ok;
  } catch(e) {
    return false;
  }
}


/* ────────────────────────────────────────────────────────────────
   14. INIT — entry point after PIN unlock
   1. Load domains.list (or fall back to BUILTIN)
   2. Render table immediately (shows domains before checks run)
   3. Run live DNS checks in background
   ──────────────────────────────────────────────────────────────── */
async function initDashboard() {
  await loadDomainList();
  renderTable();
  updateStats();
  await checkAll();
}

/* On page load: check for webhook mode first. If not webhook, show PIN. */
if (!checkWebhookMode()) {
  /* Normal mode — PIN gate is already visible in the HTML.
     initDashboard() is called by pinCheck() after successful unlock. */
  console.log('[Eye] Ready. Waiting for PIN...');
}
