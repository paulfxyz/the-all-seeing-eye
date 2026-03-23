# 👁️ The All Seeing Eye

<div align="center">

![HTML](https://img.shields.io/badge/HTML-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![PHP](https://img.shields.io/badge/PHP-777BB4?style=for-the-badge&logo=php&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Version](https://img.shields.io/badge/version-4.0.0-brightgreen?style=for-the-badge)
![Self-hosted](https://img.shields.io/badge/self--hosted-no_server_needed-blue?style=for-the-badge)

**Open-source uptime, DNS, SSL and latency monitor. One HTML file. Zero dependencies.**

Know what's up — and what isn't — across all your domains, at a glance. 🌐

<a href="https://paulfleury.com/github/all-seeing-eye.jpeg">
  <img src="https://paulfleury.com/github/all-seeing-eye.jpeg" alt="The All Seeing Eye — domain monitor dashboard" width="700" />
</a>

*Click image to view full resolution*

</div>

---

## 👨‍💻 The Story Behind This

I'm **Paul Fleury** — founder, builder, and someone who manages a lot of domains across several projects and businesses. Between personal domains, client sites, SaaS products, and holding registrations, I had **30+ domains I cared about** — and no single place to see their health at a glance.

Commercial uptime monitors are either overkill (full APM suites) or too simple (just HTTP pings). I wanted something that showed:
- **Is it up?** with real latency numbers
- **Who hosts the DNS?** (SiteGround, Cloudflare, AWS…)
- **Who handles the mail?** (ProtonMail, Google, Microsoft…)
- **Is DMARC configured?** (surprisingly many domains have this missing)
- **When does the SSL expire?**

And I wanted it to be **self-hosted**, **PIN-protected**, and look good.

This project was designed and built **in collaboration with [Perplexity Computer](https://www.perplexity.ai/computer)** — from architecture through implementation, debugging the SHA-256 caching bug, fixing sandboxed iframe PIN issues, and designing the live progressive DNS scan. A real example of human + AI building something genuinely useful.

> 💡 If you manage multiple domains and want a beautiful, self-hosted status page — this is for you. Free, open-source, beautiful, simple to use.

---

## 🌟 What is this?

A **self-hosted infrastructure dashboard** that monitors uptime, DNS records, SSL certificates and mail security for any list of domains — entirely in the browser, with no backend required.

- 🔍 **Live DNS checks** via Cloudflare DoH (HTTPS, no CORS issues)
- 🔐 **PIN-protected** dashboard (SHA-256 hashed — no plaintext stored)
- 🌓 **Light / Dark mode** toggle (light by default)
- 📱 **Mobile-first** — native numeric keyboard on touch devices, touch-optimised modals
- 🔔 **Email alerts** — digest email on downtime, SSL expiry, DMARC/SPF issues; manual Refresh = immediate alert; auto-refresh = 24h cooldown; state persists across reloads
- 📊 **Cross-device uptime** — server-side `uptime.json` shared across all browsers and devices
- ⚡ **Progressive scan** — rows light up one batch at a time as results arrive
- 🔄 **Per-row refresh** — re-scan any single domain with the ↺ button
- ⏱️ **Auto-refresh** every 3 minutes with live countdown
- 🚦 **Rate limiting** — anti-spam guards prevent firewall-triggering burst queries
- 📋 **Export CSV** — download a timestamped snapshot any time
- ➕ **Add domains live** — type any domain, it's checked immediately
- 📁 **`domains.list`** — edit a plain text file to manage your watchlist
- 🤖 **PHP cron script** — runs server-side on SiteGround/cPanel, no chmod tricks
- 🔗 **Webhook endpoint** — point any external cron (cron-job.org) at `webhook.do`

---

## 🎬 What it monitors

For every domain, five DNS queries fire in parallel:

| Record | What it reveals |
|---|---|
| `A` | Is the domain resolving? Round-trip latency? |
| `NS` | Nameserver provider (Cloudflare, AWS, SiteGround, Azure…) |
| `MX` | Mail provider (Google, ProtonMail, Microsoft, Amazon SES…) |
| `TXT` | SPF record (`v=spf1 … ~all`) |
| `_dmarc TXT` | DMARC policy (`reject` / `quarantine` / `none` / `missing`) |

Results appear **progressively** as each batch of 5 domains resolves — you see the table fill in live.

---

## 🛠️ What's in the box

| File | Purpose |
|---|---|
| `index.html` | The full application — HTML shell that loads `app.css` and `app.js` |
| `app.css` | All styles (41 KB) |
| `app.js` | All JavaScript (82 KB) |
| `domains.list` | Your domain watchlist — one domain per line, `#` for comments |
| `domains.stats` | CSV snapshot updated after every check (requires server write access) |
| `domains.json` | Written by `update-stats.php` — feeds SSL expiry data to the browser |
| `update-stats.php` | Server-side cron script — real TLS cert checks, writes `domains.json` |
| `webhook.do` | Headless endpoint for external cron services (cron-job.org etc.) |
| `INSTALL.md` | Full installation guide |
---

## 📦 Quick Start

### Drop-in install (any web server)

```bash
# 1. Clone the repo (or download the ZIP — link below)
git clone https://github.com/paulfxyz/the-all-seeing-eye.git
cd the-all-seeing-eye

# 2. Upload all files to your web server
# scp -r . user@yourhost:/public_html/uptime/

# 3. Visit https://yourdomain.com/uptime/
# Enter PIN 123456 → you'll be prompted to set a personal PIN
```

No npm, no Composer, no build step. Upload `index.html`, `app.css`, `app.js`, and `domains.list` — that's everything you need.

### Using as a local file

```bash
open index.html
# Requires a local web server for domains.list to load.
# Built-in top-50 list is used as fallback.
```
---

## 🔑 Default PIN

The default PIN is **`123456`**.

On your **first login**, after entering `123456` you will be automatically prompted to set a personal PIN. Once inside the dashboard, the **⚙️ cog icon** in the More menu lets you change it at any time.

**Change it before deploying publicly** — see [INSTALL.md](./INSTALL.md#changing-the-pin).

### How PIN persistence works (three-tier system)

The PIN is stored as a SHA-256 hash — no plaintext, ever. When you change it, the new hash is saved in three places (most to least authoritative):

| Tier | Storage | Scope | Survives incognito? |
|---|---|---|---|
| 1 | `ase_config.json` (via `config-write.php`) | Server — all browsers + devices | ✅ Yes |
| 2 | `ase_pin` cookie | Current browser only | ❌ No |
| 3 | Hardcoded in `index.html` | Deployment default only | ✅ Yes (but manual) |

On every page load, `loadConfig()` reads `ase_config.json` **before the PIN overlay becomes interactive** — so the correct hash is always in memory when you type your PIN. The cookie provides an instant fallback (no network request) while the server fetch is in-flight.

If `config-write.php` is unavailable (static host, no PHP), tier 1 is silently skipped — tier 2 (cookie) still works for the same browser, and the success modal tells you the hash to paste into `index.html` manually.
## ⚙️ Automated Checks (cron)

The dashboard auto-refreshes every 3 minutes when open. For 24/7 monitoring:

### Option A — cPanel / SiteGround (PHP script)

Add to cPanel → Cron Jobs:
```bash
*/10 * * * * php /home/YOURUSER/public_html/uptime/update-stats.php >> /home/YOURUSER/public_html/uptime/cron.log 2>&1
```

Runs as your user — no `chmod 666` needed. Writes `domains.stats` + `domains.json`.

### Option B — cron-job.org (free, no server config)

1. Create free account at [cron-job.org](https://cron-job.org)
2. Add cron job: `GET https://yourdomain.com/uptime/webhook.do` every 10 minutes
3. Done — works on any host including static sites

Full setup guide: [INSTALL.md](./INSTALL.md)

---

## 🎨 Customisation

| What | Where in `index.html` | Default |
|---|---|---|
| 🔐 PIN | `var PIN_HASH = '...'` | `123456` |
| ⏱️ Auto-refresh interval | `var refreshTimer = 180` | 180 seconds |
| 🚦 Rate limit (full refresh) | `var CHECK_ALL_MIN_GAP = 10000` | 10 seconds |
| 🚦 Rate limit (per-row) | `var CHECK_ROW_MIN_GAP = 5000` | 5 seconds |
| 📦 Batch size | `var DNS_BATCH_SIZE = 5` | 5 domains/batch |
| ⏳ Batch pause | `var DNS_BATCH_DELAY = 300` | 300ms between batches |
| 🌐 DoH resolver | `var DOH = '...'` | Cloudflare (`1.1.1.1`) |
| 📄 Domain list file | `DOMAINS_LIST` in PHP | `domains.list` |

---

## 🧠 How it works under the hood

This section documents not just *what* the code does, but *why* certain decisions were made — including the bugs hit, the dead ends, and the non-obvious trade-offs.

---

### DNS-over-HTTPS (DoH)

Browsers block raw UDP/TCP DNS sockets entirely. The solution: [Cloudflare's DoH API](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/) over HTTPS — no CORS issues, no browser permissions, works everywhere including sandboxed iframes.

Each domain fires 5 parallel queries: `A`, `NS`, `MX`, `TXT`, `_dmarc.TXT`. Results are parsed from Cloudflare's JSON format (`application/dns-json`). The `A` record response time is used as latency.

**NS/MX provider detection:** A lookup table maps known nameserver hostnames to friendly labels (`Google`, `Cloudflare`, `SiteGround`, `ProtonMail`, `Amazon SES`…). For unknown providers, the second-level domain of the first NS/MX record is extracted — e.g. `ns1.registrar-servers.com` → `"Registrar-servers"`. Far more informative than the original `"Own"` fallback that showed for everything unrecognised.

---

### Progressive batch scanning

**The challenge:** Firing 50 parallel DNS queries in one burst looks like a DoH flood — it can trigger Cloudflare rate limiting and produce inconsistent results due to browser connection limits.

**The fix:** Checks run in **batches of 5** (`DNS_BATCH_SIZE`) with a 300ms pause (`DNS_BATCH_DELAY`) between each batch. After each batch the table re-renders — you see rows light up progressively. Total time for 50 domains: ~4–5 seconds. Configurable via constants in `app.js`.

---

### SSL certificate checking — three-tier strategy

The browser cannot open raw TLS sockets (`stream_socket_client` is PHP-only). SSL expiry data comes from three sources tried in priority order:

1. **`ssl-check.php?domains=d1,d2,...` (batch PHP, same-origin)** — `fetchAllSSLExpiry()` sends a single request after all DNS checks complete. PHP opens a real TLS handshake per domain, reads the cert with `openssl_x509_parse()`, and returns a JSON array. One HTTP round-trip for up to 50 domains (~50ms/domain server-side).

2. **`crt.sh` per-domain (certificate transparency logs)** — public API, free, CORS-enabled. Fallback for static hosts without PHP. **Known issue:** crt.sh can time out or have gaps for low-traffic or private domains — this was a major pain point that drove the `ssl-check.php` implementation.

3. **`domains.json` (written by PHP cron)** — seeded at page load from `update-stats.php` output. Gives instant SSL data on first render.

If none returns data, the SSL cell shows `—`. This is expected on first load on a fresh static host.

---

### Uptime persistence — server-side + cookie fallback

**v1–v2 approach (cookie only):** Uptime data lived in a `ase_uptime` browser cookie — isolated per device, lost on cookie clear or incognito, capped at 4KB. A separate device had zero history.

**v3.1+ approach:** `uptime-write.php` accumulates history in `uptime.json` server-side. Every check from every browser/device/cron contributes to one authoritative record. `uptimeRecord()` tracks a per-cycle delta (`_uptimeDelta`), then `uptimeSave()` POSTs only changed domains to the server — efficient even with 50 domains.

**Why not localStorage?** Blocked in sandboxed iframes (Perplexity Computer preview). Cookies work in all contexts. The cookie is still written as a fallback for static hosts.

On hover of the **STATUS** column, `uptimeTooltipHTML()` renders: uptime %, total checks, days monitored, last downtime date.

---

### Email notifications — security design

**The challenge:** Storing a third-party API key (Resend) securely on a shared hosting server where `config.php` files are routinely exposed.

**The solution:** AES-256-GCM encryption with a server-side secret key.

1. User enters API key in the browser → sent (HTTPS) to `config-write.php`
2. `config-write.php` generates `notify_secret.key` on first use (256-bit random, `chmod 0600`)
3. Key is encrypted: `AES-256-GCM(plaintext, SHA-256(secret), random_IV)` → base64-encoded blob stored in `ase_config.json`
4. `notify.php` reads the secret from disk, decrypts on-the-fly, never stores plaintext
5. `.htaccess` blocks direct HTTP access to `ase_config.json`, `notify_secret.key`, `notify_rate.json`

**What's in every alert email:**
- Domain, status (DOWN/UP), latency
- SSL expiry date + days remaining (colour-coded green/amber/red)
- DMARC policy with status
- SPF record
- Nameserver and mail provider
- Auto-detected health warnings (SSL expiring, DMARC missing/unenforced, SPF missing)

**Rate limiting:** Max 10 emails/hour tracked in `notify_rate.json`. Prevents alert storms from flapping domains. Only state *transitions* (UP→DOWN, DOWN→UP) trigger alerts — not repeated failures.

---

### The SHA-256 caching bug (and fix)

**The bug:** The original SHA-256 implementation cached its prime tables as properties on the function object (`sha256.h`, `sha256.k`). This worked on the first call but produced wrong hashes on subsequent calls — making PIN verification fail randomly after the first correct login.

**The fix:** A fully **stateless implementation** that recomputes all primes fresh on every call. No mutation, no side effects. This is counterintuitive (seems wasteful) but SHA-256 is fast enough that the overhead is negligible, and the correctness is guaranteed.

---

### Why `onclick` instead of `addEventListener`

**The bug:** PIN numpad buttons attached via `addEventListener('click', ...)` inside `DOMContentLoaded` silently failed in sandboxed iframes — `DOMContentLoaded` fired before the script was fully evaluated.

**The fix:** Inline `onclick="pinDigit('1')"` attributes. These are evaluated at call time, not at parse time — always reliable regardless of execution context.

**Related trap:** Binding both `click` and `touchstart` on the same element causes double-firing on mobile (both events fire on a single tap). The PIN numpad uses `click` only, with a separate `keydown` handler for keyboard — one path per input method.

---

### Header dropdown — CSS stacking context escape

**The bug:** The header has `position: sticky; z-index: 100`, which creates its own stacking context. Dropdown menus inside it are visually capped at the header's z-index in the root stacking context — even if the menu itself has `z-index: 9999`. The backdrop overlay (appended to `<body>`) was blocking all clicks on the menu items.

**The fix:** The dropdown menu uses `position: fixed` — positioned relative to the viewport, escaping the header's stacking context entirely. `toggleHeaderMenu()` calculates the menu position via `getBoundingClientRect()` on every open. Outside-click detection uses `document.addEventListener('click')` checking `dropdown.contains(e.target)` — no backdrop div needed.

**Related bug (v3.x):** Opening a modal from a dropdown item caused a race: the click bubbled to the document listener, which called `closeHeaderMenu()` — and in some timing scenarios reached the now-visible modal overlay, closing it immediately. Fix: `event.stopPropagation()` on all dropdown item buttons.

---

### Mobile PIN — native numeric keyboard

**The problem:** The custom numpad triggered double-tap zoom on iOS (300ms delay + zoom on rapid taps). `touch-action: manipulation` helps but doesn't fully solve it.

**The solution:** On touch devices (`navigator.maxTouchPoints > 0`), the numpad is hidden and replaced with `<input type="password" inputmode="numeric">`. This triggers the system numeric keyboard with no zoom issues. Font size is 28px (above the iOS 16px zoom threshold). The numpad is preserved for non-touch contexts (desktops, sandboxed iframes where `focus()` may not work).

---

### Modal architecture — the `overflow:hidden` + `position:sticky` conflict

**The bug (v2.3.x):** Modal close buttons used `position: sticky; top: 0` on the title bar. This silently did nothing because the parent card had `overflow: hidden` — **a CSS rule: `overflow: hidden` on any ancestor disables `position: sticky` on all descendants**.

**The fix (v3.0+):** The modal card is a flex column (`display: flex; flex-direction: column; max-height: 90vh`). The header and footer are `flex-shrink: 0` — they never collapse. Only the body is `overflow-y: auto`. No `overflow: hidden` anywhere. The header and footer are structurally pinned without any CSS tricks.

---

### Config persistence layer (`config-write.php` + `ase_config.json`)

Settings that must survive across browsers and devices (PIN hash, theme, notification config) are stored in `ase_config.json` via `config-write.php`. On every page load, `loadConfig()` runs *before* the PIN overlay is interactive:

1. Reads `ase_pin` cookie → applies PIN hash immediately (no network latency)
2. Fetches `config-write.php` (no-cache) → authoritative server override
3. Applies theme + notification config

**Three-tier PIN persistence:**
| Tier | Where | Scope |
|---|---|---|
| 1 | `ase_config.json` (server) | All browsers + devices |
| 2 | `ase_pin` cookie | Current browser |
| 3 | Hardcoded in `index.html` | Deployment default |

Writes are atomic: temp file + `rename()` + `LOCK_EX` flock to prevent corruption under concurrent requests.

---

### Auto-scan on login

`initDashboard()` always fires `checkAll()` automatically after unlock. The sequence:
1. `loadConfig()` → PIN hash, theme, uptime data, notification config
2. `loadDomainList()` → `domains.list` + seed SSL from `domains.json`
3. `renderTable()` → skeleton renders immediately (domain names visible)
4. `checkAll()` → DNS+SSL in batches; table fills progressively

The skeleton-first approach is intentional: users see their domains listed instantly, then watch them come alive batch by batch — far better than a blank screen during the ~4s scan.

---

## 📝 Changelog

> Full changelog: **[CHANGELOG.md](./CHANGELOG.md)**

### 🔖 v4.0.0 — 2026-03-23
- 🔔 **feat:** Manual Refresh triggers immediate notification (5-min cooldown vs 24h for auto-refresh)
- 💾 **feat:** Notification state persists across page reloads via `ase_config.json`
- 🏗️ **feat:** Dual cooldown system: `NOTIFY_COOLDOWN_MANUAL` (5min) vs `NOTIFY_COOLDOWN_AUTO` (24h)
- 🔐 **feat:** `_notifyLoadState()` / `_notifySaveState()` — server-backed cooldown persistence
- ⚙️ **feat:** `config-write.php` extended with `notify_last_sent` field

### 🔖 v3.3.1 — 2026-03-23
- 🐛 **fix:** PHP fatal error in notify.php — arrow functions, heredoc ternaries, escaped quotes causing HTTP 500

### 🔖 v3.3.0 — 2026-03-23
- 🔔 **feat:** Cron notifications — `update-stats.php` now sends email digest after every run
- 🔔 **feat:** Browser health scan — `sendHealthReport()` fires after every `checkAll()` cycle when SSL data arrives
- 🔔 **feat:** Digest email format — multi-domain report: all issues in one email, grouped by severity
- ⏱️ **feat:** Deduplication — per-domain per-type cooldowns (DOWN=1h, SSL/DMARC/SPF=24h) prevent alert storms
- 🧪 **feat:** Test email now shows a realistic 3-domain demo digest (DOWN + SSL expiry + DMARC missing)

### 🔖 v3.2.0 — 2026-03-23
- 🔔 **feat:** Enriched email alerts — SSL expiry countdown, DMARC/SPF health checks, NS + MX in every notification
- ⚠️ **feat:** Auto-detected health warnings in emails — SSL expiring ≤30d (warning) / ≤7d (critical), DMARC missing/unenforced, SPF missing
- 🧪 **feat:** Test email shows realistic demo snapshot with example alerts
- 📖 **feat:** Help modal updated with Notifications section
- 🐛 **fix:** `stopPropagation` on all dropdown modal buttons (click race condition)

### 🔖 v3.1.0 — 2026-03-23
- 🔔 **feat:** Email notifications — Resend API integration; downtime + recovery alerts; API key encrypted AES-256-GCM server-side
- 📊 **feat:** Cross-device uptime — `uptime.json` via `uptime-write.php`; every check from any browser/device contributes to shared history
- 🏗️ **feat:** `uptime-write.php` — server-side uptime accumulation endpoint with atomic writes + 500-domain cap
- 🏗️ **feat:** `notify.php` — email sender with rate limiting (10/hour), recovery detection, beautiful HTML emails
- ⚙️ **feat:** Notifications modal — Resend API key, from/to email, enable toggle, test button, encrypted key display

### 🔖 v3.0.0 — 2026-03-22
- 📱 **feat:** Mobile PIN — native numeric keyboard input on touch devices (no double-tap zoom, no numpad)
- 🏗️ **fix:** Modal architecture rebuilt — header + scrollable body + footer as flex column; close button always visible regardless of content height
- 🔧 **fix:** `touch-action: manipulation` on all buttons — eliminates 300ms tap delay and double-tap zoom sitewide
- 🎨 **feat:** New modal CSS system (`.modal-overlay`, `.modal-card`, `.modal-header`, `.modal-body`, `.modal-footer`) — clean, reusable, mobile-first

### 🔖 v2.3.1 — 2026-03-22
- 🚨 **fix:** CRITICAL — unclosed `<div>` in webhook modal broke entire DOM (set-PIN flow, dashboard unreachable)

### 🔖 v2.3.0 — 2026-03-22
- 📱 **feat:** Full mobile UI overhaul — table horizontal scroll with touch momentum, taller row tap targets, responsive header/controls
- 🐛 **fix:** Help/Webhook modals — sticky title bar always visible, `scrollTop=0` on open, 44×44px close button, full-width "Close" sticky footer button
- 🎨 **fix:** All modals restructured with sticky header + scrollable body + sticky footer pattern

### 🔖 v2.2.1 — 2026-03-22
- 🐛 **fix:** `.htaccess` added — `no-cache` headers for HTML/JS/CSS/PHP prevent stale browser cache after updates
- 🐛 **fix:** `domains.stats` rebuilt with top-50 world domains (no personal domains in repo)
- 🔒 **fix:** `.htaccess` blocks direct browser access to `ase_config.json`, `domains.stats`, `cron.log`

### 🔖 v2.2.0 — 2026-03-22
- 🌍 **feat:** Built-in fallback list expanded from top-30 to **top-50** world's most-visited domains (Zoom, Stripe, Shopify, Notion, Figma, Vercel, Slack, Airbnb, Uber, Adobe, Salesforce, Paypal, Dropbox, Tesla, Atlassian, HubSpot, eBay, WordPress, Twilio, Twitter)
- 📄 **fix:** `domains.list` updated to top-50 world sites — no longer contains personal domains
- 🐛 **fix:** All "top-30" references updated to "top-50" across all files

### 🔖 v2.1.1 — 2026-03-22
- 🐛 **fix:** All GitHub repo URLs in the UI now point to `paulfxyz/the-all-seeing-eye` (footer, help modal were using `your-org` placeholder)

### 🔖 v2.1.0 — 2026-03-22
- 🔐 **feat:** PIN now persists across all browsers + incognito via `ase_config.json` (config-write.php)
- 🍪 **feat:** `ase_pin` cookie as immediate browser-local fallback for PIN hash
- ⚙️ **feat:** `loadConfig()` applies server config before PIN overlay — correct PIN always in memory
- 🎨 **feat:** Theme preference now saved to server config and restored on next visit
- 🔄 **fix:** `initDashboard()` auto-fires full scan on login — no manual Refresh needed

### 🔖 v2.0.2 — 2026-03-22
- 🌟 **feat:** Light theme is now the default on first load

### 🔖 v2.0.1 — 2026-03-22
- 🐛 **fix:** SPF badge — both `~all` and `-all` now render green; only missing SPF is red
- 🐛 **fix:** More menu — items now fully clickable; root cause was header's CSS stacking context blocking click events
- 🐛 **fix:** More menu — backdrop div replaced with `document.addEventListener` outside-click handler; menu uses `position: fixed` + `getBoundingClientRect()`
- 🎨 **fix:** Theme toggle moved to right of logo (before action buttons), per preference

### 🔖 v2.0.0 — 2026-03-22
- 🚀 **feat:** Batch SSL — single `ssl-check.php?domains=...` request covers all domains (no more per-domain races)
- 📊 **feat:** Uptime persistence via cookie — hover STATUS to see uptime %, total checks, days monitored, last-down date
- 🎛 **feat:** Header dropdown — secondary actions (GitHub, CSV, Webhook, PIN, Help) in "More ⋮" menu; primary stays clean
- 🗑️ **fix:** Category dropdown removed from Add Domain modal
- 🎨 **fix:** Theme toggle height aligned with buttons; version badge corrected to 2.0.0

### 🔖 v1.9.0 — 2026-03-22
- 🐛 **fix:** Refresh button no longer stuck on "1s…" — `REFRESH_BTN_ORIGINAL` snapshot guarantees correct restoration after countdown
- 🎨 **fix:** Header button consistency — cog shows "PIN", ? shows "Help", both with SVG icons matching other buttons
- 🎨 **fix:** Theme toggle border-radius aligned with button style

### 🔖 v1.8.0 — 2026-03-22
- 🔐 **feat:** `ssl-check.php` — same-origin PHP endpoint for fast, reliable SSL cert checks (replaces crt.sh as primary source)
- ⚙️ **feat:** PIN change modal — cog icon in header: enter current PIN → new PIN → confirm
- 🔑 **docs:** README explains first-login PIN prompt and ⚙️ change flow

### 🔖 v1.7.0 — 2026-03-22
- 🐛 **fix:** Refresh countdown now **auto-fires** `checkAll()` when it expires — no second click needed
- 🗑️ **feat:** Category column removed from the table
- 🌐 **fix:** NS/MX labels now show the registrar/provider name instead of generic "Own"
- ✨ **feat:** Row shimmer animation during scan (faint accent pulse + opacity dim)
- ⚡ Rate-limit reduced from 10s → 5s

### 🔖 v1.6.0 — 2026-03-22
- 🐛 **fix:** Removed IIFE that forced set-PIN modal on every incognito visit — login now works normally
- 🗑️ Removed `index.standalone.html` — three-file structure (`index.html` + `app.css` + `app.js`) only

### 🔖 v1.5.0 — 2026-03-22
- 🔐 **feat:** First visit skips default PIN — set-PIN modal shown directly if no custom PIN is set
- 🔐 **feat:** `showPinSuccessModal()` replaces browser `alert()` after PIN change
- 📊 **feat:** `loadDomainList()` reads `domains.json` to seed SSL expiry before first DNS check
- 🐛 **fix:** `update-stats.php` `$results[]` now includes `ssl_expiry` and `ssl_issuer`

### 🔖 v1.4.0 — 2026-03-22
- 📊 **feat:** `_sslChecked` session cache — prevents redundant crt.sh queries on every refresh
- 🎨 **feat:** Refresh button shows spinning icon + "Checking…" during scan
- ⏱️ crt.sh timeout reduced 8s → 5s

### 🔖 v1.3.0 — 2026-03-22
- 📦 **feat:** CSS + JS split into `app.css` / `app.js` — `index.html` reduced 130KB → 29KB (−78%)
- ✨ **feat:** 500ms minimum row loading animation; animated sweep progress bar during full scan
- 📝 **fix:** INSTALL.md — `.htaccess` rule for `webhook.do` documented for cron-job.org / Option B

### 🔖 v1.2.0 — 2026-03-22
- 🔐 **feat:** Live SSL expiry via crt.sh; `LE` badge for Let's Encrypt; PHP TLS handshake in `update-stats.php`
- 🌐 **fix:** 7 BUILTIN NS entries corrected to `Domain` (facebook, apple, cloudflare…)

### 🔖 v1.1.0 — 2026-03-22
- 🔐 **feat:** Smart NS detection — SiteGround, AWS, Azure, Cloudflare… "Domain" for self-hosted
- 🐛 **fix:** DNS parsing hardened — TXT/DMARC quote stripping, MX priority prefix stripping
- 🔐 **feat:** Set-PIN prompt appears after first login with default PIN

### 🔖 v1.0.0 — 2026-03-22
- 🎉 Initial release — live DNS checks, PIN gate, dark/light mode, `domains.list`, PHP cron, webhook, CSV export

---
## ⬇️ Download

**No git required.** Download the latest release as a ZIP:

👉 **[Download the ZIP](https://github.com/paulfxyz/the-all-seeing-eye/archive/refs/heads/main.zip)**

Unzip and upload `index.html` + `app.css` + `app.js` + `domains.list` to your server. See [INSTALL.md](./INSTALL.md) for the full guide.

---
## 🤝 Contributing

Pull requests are very welcome! Ideas: SSL expiry live check, ping history graphs, Slack/email alerts, multi-user support, mobile layout improvements.

1. 🍴 Fork the repo
2. 🌿 Create your branch: `git checkout -b feature/my-improvement`
3. 💾 Commit: `git commit -m 'Add amazing feature'`
4. 🚀 Push: `git push origin feature/my-improvement`
5. 📬 Open a Pull Request

---

## 📜 License

MIT License — free to use, modify, and distribute. See [`LICENSE`](./LICENSE) for details.

---

## 👤 Author

Made with ❤️ by **Paul Fleury** — designed and built in collaboration with **[Perplexity Computer](https://www.perplexity.ai/computer)**.

- 🌐 Website: **[paulfleury.com](https://paulfleury.com)**
- 🔗 LinkedIn: **[linkedin.com/in/paulfxyz](https://www.linkedin.com/in/paulfxyz/)**
- 🐦 All platforms: **[@paulfxyz](https://github.com/paulfxyz)**
- 📧 Email: **[hello@paulfleury.com](mailto:hello@paulfleury.com)**

---

⭐ **If this saved you time, drop a star — it helps others find it!** ⭐
