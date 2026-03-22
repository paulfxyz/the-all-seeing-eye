# 📝 Changelog

All notable changes to **the-all-seeing-eye** are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 🗓️ For full setup instructions, see the **[INSTALL.md](./INSTALL.md)**.
> 👤 Made with ❤️ by [Paul Fleury](https://paulfleury.com) — [@paulfxyz](https://github.com/paulfxyz)

---

## 🔖 [2.0.0] — 2026-03-22

### 🚀 Major Release — Batch SSL · Uptime Persistence · New Header

---

#### Batch SSL Check (ssl-check.php v2.0.0)

- **Root cause of SSL "—" for most domains:** The previous approach fired one `ssl-check.php` request per domain as a non-blocking Promise inside `checkDomain()`. With 34 domains this meant 34 sequential HTTP requests triggered in parallel — some resolved before others, causing a race where later domains' SSL results would call `renderTable()` but `_sslChecked` had already been set, silently dropping results.
- **The fix:** `fetchAllSSLExpiry(domains[])` — a single batch HTTP request that sends all domains at once: `GET /ssl-check.php?domains=dom1,dom2,...`. PHP processes them sequentially (fast: ~50ms/domain) and returns a JSON array. Called once at the end of `checkAll()` after DNS checks.
- **ssl-check.php v2.0.0:** now accepts `?domains=` parameter (comma-separated, max 50 per request, chunked in JS). Rate limiting kept per-domain for single requests. Batch requests are unthrottled (trusted server-side flow).
- **Fallback:** If `ssl-check.php` returns 404 (static host), falls back to per-domain `crt.sh` calls in parallel.

#### Uptime Persistence (Cookie-Based)

- **The problem:** Uptime sparklines reset on every page reload (history was in-memory only).
- **The fix:** `_uptimeData` persists via a cookie (`ase_uptime`, 1-year expiry, JSON-encoded). On each `checkDomain()` result, `uptimeRecord(domain, isUp)` is called to increment checks/ups counters and record last-down timestamp.
- **Hover tooltip on STATUS column:** Shows uptime percentage (1 decimal), total check count, days monitored, and last-down date.
- **Cookie management:** Auto-trims to 40 most-checked domains if the cookie approaches 4KB.
- Why cookie vs localStorage: localStorage is blocked in sandboxed iframes; cookies work in all contexts.

#### Header Dropdown Menu

- Secondary actions (GitHub, Export CSV, Webhook, Change PIN, Help) moved into a "More ⋮" dropdown.
- Primary actions (Add Domain, Refresh) remain always visible.
- Theme toggle remains inline.
- Dropdown closes on outside click via a transparent backdrop div.
- Mobile-friendly: single row of 3 elements (Add Domain | Refresh | More ⋮ | 🌙).

#### Other UI Fixes

- **Add Domain modal:** Category dropdown removed — all domains added as generic entries.
- **Theme toggle height:** `height: 32px` + `!important` on track to match `.btn` height exactly.
- **Version badge:** README badge updated from 1.3.0 → 2.0.0.

### ✨ Added

- **`fetchAllSSLExpiry(domains[])`** — batch SSL fetch function
- **`_uptimeData` dict** — in-memory uptime records, persisted to cookie
- **`uptimeLoad()`** — reads uptime cookie on page load
- **`uptimeSave()`** — writes uptime cookie after each `checkAll()`
- **`uptimeRecord(domain, isUp)`** — called on every `checkDomain()` result
- **`uptimePercent(domain)`** — returns uptime % with 1 decimal
- **`uptimeDaysSince(domain)`** — returns days since first check
- **`uptimeTooltipHTML(domain)`** — builds hover tooltip for STATUS cell
- **`toggleHeaderMenu()` / `closeHeaderMenu()`** — dropdown open/close
- **CSS:** `.header-dropdown`, `.header-dropdown-menu`, `.dropdown-item`

### 🔄 Changed

- `checkAll()` — calls `fetchAllSSLExpiry()` after DNS batch, not per-domain
- `checkDomain()` — SSL enrichment block removed; calls `uptimeRecord()` instead
- `ssl-check.php` — batch mode via `?domains=` parameter
- HTML header — rebuilt with dropdown; 2 primary + 1 dropdown + toggle
- Add Domain modal — category `<select>` removed
- `queueDomain()` / `confirmAddDomains()` / `openAddModal()` — no cat references
- README version badge: `1.3.0` → `2.0.0`

---

## 🔖 [1.9.0] — 2026-03-22

### 🎨 Header Consistency + Refresh Button Fix

---

#### Refresh Button — "1s…" Stuck State Fixed

- **Root cause:** When the rate-limit countdown reached zero and auto-fired `checkAll()`, it called `setRefreshBtnLoading()` — which saved the current innerHTML (`"⏳ 1s…"`) as `data-original`. When `setRefreshBtnNormal()` ran after the check, it restored `"⏳ 1s…"` instead of the real button SVG.
- **Fix 1:** The countdown now captures `btn.innerHTML` into `realOrig` and saves it to `data-original` **before** overwriting with `"⏳ Ns…"` text.
- **Fix 2:** `setRefreshBtnLoading()` now skips saving `data-original` if it already contains a countdown or spinner state.
- **Fix 3:** `REFRESH_BTN_ORIGINAL` — a module-level constant that snapshots the real button HTML at page load (once, from the DOM). Used as the final fallback in `setRefreshBtnNormal()` to guarantee correct restoration even if `data-original` is stale.

#### Header Buttons — Consistent Style

- **Cog (PIN) button:** now shows `[⚙ SVG] PIN` text label — same format as GitHub, Webhook, Refresh, CSV. No more icon-only.
- **? (Help) button:** now shows `[ℹ SVG] Help` text label — consistent with the rest.
- **Theme toggle:** border-radius changed from `15px` to `var(--radius-md)` to match the rounded corner style of other buttons.

### 🔄 Changed

- `triggerRefresh()` — saves real original HTML before countdown starts
- `setRefreshBtnLoading()` — skips `data-original` overwrite if already set
- `setRefreshBtnNormal()` — falls back to `REFRESH_BTN_ORIGINAL` constant
- `REFRESH_BTN_ORIGINAL` — new module-level constant, DOM snapshot at page load
- HTML: `⚙️` button → `[cog SVG] PIN`, `?` button → `[info SVG] Help`
- CSS: `.theme-track` border-radius aligned with `var(--radius-md)`

---

## 🔖 [1.8.0] — 2026-03-22

### 🔐 Server-Side SSL Check + PIN Change Modal

---

#### ssl-check.php — Reliable Server-Side SSL Expiry

- **The problem:** `crt.sh` certificate transparency API was failing for all of Paul's 34 private domains (timeouts, gaps in CT log coverage). The browser JS cannot open raw TLS connections, making purely client-side SSL checking unreliable for non-popular domains.
- **The solution:** `ssl-check.php` — a lightweight PHP endpoint uploaded alongside `index.html`. The browser calls `./ssl-check.php?domain=example.com` instead of crt.sh. PHP uses `stream_socket_client()` to open a real TLS connection to port 443, reads the peer certificate with `openssl_x509_parse()`, and returns JSON with expiry date, issuer name, and days remaining. Same approach as `update-stats.php` but callable per-domain from the browser.
- **Strategy (priority order):**
  1. `ssl-check.php` (same-origin, fast, reliable for any domain, requires PHP host)
  2. `crt.sh` (fallback for static hosts; can timeout on obscure domains)
  3. `null` → SSL shows "—" (run `update-stats.php` cron to generate `domains.json`)
- **Security:** Input validated to hostname chars only; file-based rate limit (1 req/domain/sec); TLS verification disabled (we want cert data even for expired certs); CORS header set.
- **Caching:** `Cache-Control: max-age=3600` — browser caches the result for 1 hour.

#### ⚙️ PIN Change Modal

- **New cog icon** (⚙️) added to the dashboard header, next to the `?` help button.
- Clicking it opens a three-phase PIN change flow:
  1. **Enter current PIN** — verified against `PIN_HASH` via SHA-256
  2. **Enter new PIN** — stored in memory
  3. **Confirm new PIN** — must match; on success, `PIN_HASH` updated and `spPersistHash()` attempts to rewrite `index.html`
- Full **keyboard support** (digits + Backspace + Escape to close)
- On success: `showPinSuccessModal()` shown (same as first-login set-PIN)
- Error states: wrong current PIN flashes red, mismatched confirmation resets to step 2

### ✨ Added

- **`ssl-check.php`** — server-side SSL expiry endpoint
- **`openChangePinModal()` / `closeChangePinModal()`** — modal open/close
- **`cpDigit()` / `cpDelete()` / `cpCheck()`** — numpad handlers for change-PIN flow
- **`cpUpdateDots()` / `cpSetTitles()`** — UI state helpers
- **Keyboard handler** for change-PIN modal (digits, Backspace, Escape)
- **⚙️ button** in header HTML

### 🔄 Changed

- `fetchSSLExpiry()` — now tries `ssl-check.php` first (6s timeout), falls back to `crt.sh` (5s timeout)
- README: `## 🔑 Default PIN` section updated with first-login prompt explanation and ⚙️ change-flow note

---

## 🔖 [1.7.0] — 2026-03-22

### 🐛 Refresh Fix + Category Removed + Better NS/MX Labels

---

#### Refresh Rate-Limit: Countdown Auto-Fires

- **The problem:** Clicking Refresh within the rate-limit window showed "Wait 8s" and disabled the button. After 8 seconds, the button simply re-enabled — no refresh fired. User had to click a second time, which was confusing ("broken refresh").
- **The fix:** The countdown now auto-fires `checkAll()` when it expires. "⏳ 8s…" ticks down to 0, then automatically starts the refresh — no second click needed. Rate-limit reduced from 10s → 5s.
- **Running check:** If a check is already running, the button shows "Running…" and is disabled until the check completes (polled every 200ms), then restores normally.

#### Category Column Removed

- Category `<th>` removed from HTML table header.
- Category `<td>` cell removed from `renderTable()` in `app.js`.
- All domains from `domains.list` are treated uniformly — no category badge needed.

#### NS/MX Fallback: Domain Name Instead of "Own"

- **NS fallback:** Instead of `Own`, the function now extracts the second-level domain from the first NS hostname. e.g. `ns1.registrar-servers.com` → `"Registrar-servers"`. Gives the user actionable information.
- **MX fallback:** Same approach — extracts the domain name from the first MX record. e.g. `mail.example.com` → `"Example"`.
- Generic `"Own"` label eliminated from both `detectNSProvider()` and `detectMXProvider()`.

#### Loading Animation — Shimmer

- Added `@keyframes row-shimmer` — rows pulse between transparent and a faint accent-tinted background while checking, making the progressive scan visually obvious.
- Combined with the existing 500ms minimum opacity dim.

### 🔄 Changed

- `CHECK_ALL_MIN_GAP` reduced from 10s → 5s
- `triggerRefresh()` rewritten: countdown auto-fires, running-check poll added
- HTML: `<th>Category</th>` removed
- `renderTable()`: category `<td>` cell removed
- `detectNSProvider()`: fallback returns hostname SLD instead of `"Own"`
- `detectMXProvider()`: fallback returns MX hostname SLD instead of `"Own"`
- `app.css`: `row-shimmer` keyframe animation added to `is-checking` rows
- README: download instruction demoted from large block to bold text (no separate `<p>`)

---

## 🔖 [1.6.0] — 2026-03-22

### 🐛 PIN Flow Fix + Standalone Removed + Docs Cleaned

---

#### PIN Flow Fix — No More Forced Onboarding on Every Visit

- **The problem:** An IIFE added in v1.5.0 checked `PIN_HASH === DEFAULT_PIN_HASH` on page load and immediately replaced the login overlay with the set-PIN modal. This meant every incognito visit triggered the set-PIN onboarding — making the site appear broken on the live `up.paulfleury.com` because users were met with a setup flow instead of a login screen.
- **The fix:** The IIFE is removed. The login PIN overlay now shows normally for all visitors. After a successful login, `checkFirstUse()` runs and — only if the default PIN was used — prompts to set a new PIN. A visitor who just wants to use the dashboard with the default PIN types `123456` and is in.

#### Standalone Build Removed

- `index.standalone.html` removed from the repository. It was introduced to work around deployment issues but added confusion about which file to use.
- The three-file structure (`index.html` + `app.css` + `app.js`) is the only supported format. All three must be in the same directory.
- README and INSTALL.md cleaned of all standalone references.

### 🔄 Changed

- Removed IIFE that auto-redirected to set-PIN modal on page load
- Removed `index.standalone.html` from repo
- README `What's in the box` table — standalone removed, three-file structure explained
- README Quick Start — simplified to three-file upload
- INSTALL.md `What's in the ZIP` — standalone removed, three-file note added
- INSTALL.md Step 1 — clean minimum files list

---

## 🔖 [1.5.0] — 2026-03-22

### 🔐 PIN-Free First Visit + SSL via domains.json + README Download Link

---

#### PIN-Free First Visit

- **The problem:** New users had to type "123456" (the default PIN) before getting the set-PIN prompt. This was confusing and pointless — the default PIN is public.
- **The fix:** On page load, an IIFE checks `PIN_HASH === DEFAULT_PIN_HASH`. If true, the login overlay is hidden immediately and the set-PIN modal is shown directly — no default PIN entry required.
- **Keyboard support added for set-PIN modal** — previously only the login numpad had keyboard support. Now typing digits or Backspace works in the set-PIN modal too.
- **Browser alert replaced** — `spConfirm()` called `alert()` to show the new PIN hash. Replaced with a proper `showPinSuccessModal()` — a blurred overlay with a 🔐 icon, message, and "Open Dashboard →" button. Built with DOM API (no innerHTML quote issues).

#### SSL via domains.json

- **The problem:** `crt.sh` times out for many small/private domains (observed ~50% failure rate on Paul's 34-domain list). Domains loaded from `domains.list` never got SSL expiry dates.
- **The fix:** `loadDomainList()` now tries `fetch('./domains.json')` after loading domains. This file is written by `update-stats.php` (which uses real TLS handshakes). When available, SSL expiry + issuer from `domains.json` are applied to the DOMAINS array before the first DNS check — SSL column populates immediately.
- `_sslChecked[domain] = true` is set for domains enriched from `domains.json` so crt.sh isn't queried redundantly.
- **PHP fix:** `$results[]` array in `update-stats.php` was missing `ssl_expiry` and `ssl_issuer` — both now included.
- crt.sh remains as a secondary fallback for domains not covered by `domains.json`.

#### README improvements

- **Download link added** — GitHub archive ZIP URL in the README so users without git can download directly.
- **Changelog section updated** — now shows all versions v1.0.0–v1.4.0 accurately.
- **Which file to upload** guidance added.

### ✨ Added

- **`showPinSuccessModal(newHash)`** — in-UI success modal replacing `alert()`
- **Set-PIN keyboard handler** — `keydown` listener for the set-PIN modal (digits + Backspace)
- **`loadDomainList()` domains.json fetch** — seeds SSL expiry from PHP cron output
- **Download ZIP link** in README

### 🔄 Changed

- PIN login flow: IIFE auto-redirects to set-PIN modal when `PIN_HASH === DEFAULT_PIN_HASH`
- `spConfirm()` — calls `showPinSuccessModal()` instead of `alert()`
- `update-stats.php` `$results[]` — `ssl_expiry` and `ssl_issuer` now included
- `loadDomainList()` — reads `domains.json` after domain list load to seed SSL data
- README — changelog accurate, download section added

---

## 🔖 [1.4.0] — 2026-03-22

### 🐛 SSL Enrichment + Refresh Visual Feedback + Standalone Build

---

#### SSL Enrichment for domains.list domains

- **The problem:** Domains loaded from `domains.list` (custom user watchlists) get `sslExpiry: null` from `loadDomainList()` since they're not in the BUILTIN top-30. The `fetchSSLExpiry()` enrichment was gated on `!entry.sslExpiry`, which is correct — BUT `crt.sh` was timing out for many small/private domains. The user saw `—` in every SSL cell.
- **The fix:**
  - `_sslChecked` set added — tracks which domains have been queried this session so we don't re-fire crt.sh on every refresh cycle (was: every 3-minute auto-refresh re-queried every domain).
  - crt.sh timeout reduced from 8s → 5s.
  - `_sslChecked` is reset on `loadDomainList()` so a fresh page load always retries.
  - SSL enrichment now correctly fires for ALL domains with null expiry, including those loaded from a user's `domains.list`.

#### Refresh Button — Clear Visual Feedback

- **The problem:** Clicking Refresh showed no immediate UI change. Rows dimmed and undimmed but the button itself gave no feedback.
- **The fix:** `triggerRefresh()` now:
  - Sets the button to a spinning icon + "Checking…" text immediately on click.
  - Disables the button to prevent double-click.
  - Re-enables and restores the original button content when `checkAll()` completes.
  - Shows "⏳ Wait Ns" if clicked within the rate-limit window.
  - `setRefreshBtnLoading()` / `setRefreshBtnNormal()` are standalone helper functions.

#### Standalone Single-File Build (`index.standalone.html`)

- **The problem:** `up.paulfleury.com` was running the old monolithic `index.html` without `app.css`/`app.js`. Uploading just `index.html` after the v1.3.0 split would break the site.
- **The fix:** `index.standalone.html` — a self-contained single-file build that inlines `app.css` and `app.js` directly. Upload this one file and the site works with zero dependencies (besides Google Fonts CDN).
- **Both options available:**
  - `index.standalone.html` → single-file deploy, drop on any server
  - `index.html` + `app.css` + `app.js` → modular deploy, better caching

### ✨ Added

- **`index.standalone.html`** — self-contained single-file build (CSS + JS inlined)
- **`_sslChecked` dict** — session cache to prevent re-querying crt.sh on every refresh
- **`setRefreshBtnLoading()`** — sets Refresh button to spinning/disabled state
- **`setRefreshBtnNormal()`** — restores Refresh button to original state

### 🔄 Changed

- `checkDomain()` — SSL enrichment now uses `_sslChecked[domain]` guard; fires for all null-expiry domains
- `loadDomainList()` — resets `_sslChecked` on each call
- `fetchSSLExpiry()` — timeout reduced from 8000ms to 5000ms
- `triggerRefresh()` — now calls `setRefreshBtnLoading()` before scan and `.then(setRefreshBtnNormal)` after
- Live state block — `_sslChecked = {}` added as a top-level variable

---

## 🔖 [1.3.0] — 2026-03-22

### 📦 Modular Architecture + Loading Animation + .htaccess Guide

---

#### Modular Architecture — index.html split into three files

- **The problem:** `index.html` had grown to 130KB+ with 1,161 lines of CSS and 1,434 lines of JavaScript all inline. Difficult to read, maintain, or version-diff. Browsers also can't independently cache inline assets.
- **The fix:** CSS and JS extracted into dedicated modules:
  - `app.css` — all styles (41KB, 1,170 lines)
  - `app.js` — all JavaScript (73KB, 1,440 lines)
  - `index.html` — clean HTML shell only (29KB, ~530 lines)
- `index.html` links the modules via `<link rel="stylesheet" href="app.css">` and `<script src="app.js"></script>`.
- Browsers now cache `app.css` and `app.js` independently — subsequent page loads only re-fetch `index.html` if the CSS/JS haven't changed.
- **index.html reduced by 77.8%** — from 130KB to 29KB.

#### Row Loading Animation — 500ms minimum

- **The problem:** DNS queries for fast-resolving domains (< 100ms) caused rows to flash so briefly the user couldn't tell a scan was happening. The progressive scan effect was invisible.
- **The fix:** `setRowLoading()` now enforces a **500ms minimum dim duration**:
  - On `setRowLoading(domain, true)`: row gets class `is-checking` (opacity 0.32) and start timestamp is recorded in `_rowLoadingStart[domain]`.
  - On `setRowLoading(domain, false)`: elapsed time is calculated. If less than `MIN_ROW_LOADING_MS` (500ms), the un-dim is deferred by the remainder via `setTimeout`.
  - On un-dim: `is-checking` swaps to `is-checking-done`, which triggers a slow 600ms CSS fade-in so each row "lights up" satisfyingly as it completes.
- **Scan progress bar:** A horizontal animated sweep bar appears below the status bar during any full `checkAll()` run and hides with a fade on completion.
- **Per-row ↺ button** now uses a CSS class (`is-spinning`) for the rotation animation instead of inline `style.animation`, making it easier to override via CSS.

#### .htaccess Documentation (INSTALL.md Option B)

- **The problem:** Option B (cron-job.org) requires an `.htaccess` rewrite rule for `webhook.do` to be accessible. This was not documented — users setting up cron-job.org would see 404 errors without knowing why.
- **The fix:** A new `⚠️ Required: .htaccess rule for webhook.do` section added at the top of Option B, before the cron-job.org setup steps. Explains:
  - Why the rule is mandatory (server needs to map `.do` to the HTML file)
  - The exact `RewriteRule` for Apache/SiteGround
  - Step-by-step instructions for adding it in SiteGround File Manager
  - A troubleshooting table mapping HTTP status codes (200/404/403/500) to causes
- Option B now also includes instructions to **test the webhook URL manually** in a browser before setting up the cron job.

### ✨ Added

- **`app.css`** — extracted CSS module (41KB)
- **`app.js`** — extracted JS module (73KB)
- **`MIN_ROW_LOADING_MS = 500`** constant — minimum row dim duration
- **`_rowLoadingStart` dict** — tracks start timestamps per domain for minimum enforcement
- **`is-checking` CSS class** — applies `opacity: 0.32` with 150ms transition in
- **`is-checking-done` CSS class** — applies 600ms opacity fade to 1 on un-dim
- **`scan-progress-wrap` / `scan-progress-bar`** — animated sweep bar shown during `checkAll()`
- **`@keyframes scan-sweep`** — horizontal sweep animation for the progress bar
- **`is-spinning` CSS class** — spin animation for per-row ↺ button
- **INSTALL.md Option B** — `⚠️ Required: .htaccess rule` section with SiteGround instructions

### 🔄 Changed

- `index.html` — inline `<style>` and `<script>` replaced with `<link>` and `<script src>`
- `setRowLoading(domain, loading)` — complete rewrite with 500ms minimum and CSS class approach
- `refreshRow()` — uses `classList.add/remove('is-spinning')` instead of `style.animation`
- `checkAll()` — shows/hides `scan-progress-wrap` at start/end of scan
- INSTALL.md Option B — mandatory `.htaccess` step now appears before cron-job.org setup

---

## 🔖 [1.2.0] — 2026-03-22

### 🔐 Live SSL Expiry + NS Accuracy + DNS Parsing Fixes

---

#### Live SSL Expiry via crt.sh

- **The problem:** SSL expiry dates were static — seeded from a one-time scan on 2026-03-21. They displayed correctly (days are computed live from today via `daysUntil()`), but for custom domains added at runtime, `sslExpiry` was always `null` → shown as `—` in the table.
- **The fix:** A new `fetchSSLExpiry(domain)` function queries the [crt.sh](https://crt.sh) certificate transparency log API. It fetches all valid (non-expired) certs for the domain, picks the one expiring latest, extracts the `notAfter` date and detects whether it's a Let's Encrypt cert (CN matches `R3`, `R10`, `E5`, `E7`, etc.).
- **Non-blocking by design:** The call is fired as a background `Promise` inside `checkDomain()` — it does not delay the DNS check or the table render. When the result arrives, it updates the domain entry and calls `renderTable()` so the SSL cell updates live.
- **Only for custom domains:** Built-in top-30 entries have accurate seeded expiry dates from a real scan. The enrichment only fires for domains where `sslExpiry === null` (i.e. newly added custom domains).
- **LE badge:** When the SSL issuer is Let's Encrypt, a green `LE` badge appears next to the days count in the SSL column.

#### NS Provider Accuracy

- **The problem:** Seven well-known domains (Facebook, Instagram, WhatsApp, Apple, Yahoo, Pinterest, Cloudflare) self-host their nameservers but were labelled `Own` in the BUILTIN seed data, not `Domain`.
- **The fix:** All seven BUILTIN entries corrected to `ns: 'Domain'`.
- **Verification:** `facebook.com` uses `a/b/c/d.ns.facebook.com`, `apple.com` uses `a/b/c.ns.apple.com`, `cloudflare.com` uses `ns3/4/5.cloudflare.com` — all correctly detected by the v1.1.0 apex-comparison algorithm; seed data now matches.

#### PHP SSL Check (update-stats.php)

- **Added `get_ssl_expiry(string $domain)`** — makes a real TLS handshake to port 443 via `stream_socket_client()`, reads the peer certificate with `openssl_x509_parse()`, and extracts `validTo_time_t`. No curl required.
- SSL expiry and issuer (`LE` / provider name) now included in the `domains.stats` CSV and `domains.json` output.
- Log lines now show: `→ UP | 28ms | SSL=2026-06-06 (LE) | NS=SiteGround | MX=ProtonMail | DMARC=quarantine`

### ✨ Added

- **`fetchSSLExpiry(domain)`** — async, queries crt.sh CT log API, returns `{expiry: 'YYYY-MM-DD', issuer: string}` or `null` on failure
- **LE badge** in SSL column — green `LE` tag shown when issuer is Let's Encrypt
- **`get_ssl_expiry()`** PHP function in `update-stats.php` — real TLS cert check via `stream_socket_client()`
- **`ssl_expiry` and `ssl_issuer`** columns added to CSV output and `$results[]` array in PHP

### 🔄 Changed

- **7 BUILTIN NS entries** corrected from `'Own'` to `'Domain'`: `facebook.com`, `instagram.com`, `whatsapp.com`, `apple.com`, `yahoo.com`, `pinterest.com`, `cloudflare.com`
- `checkDomain()` — background SSL enrichment fires for domains with `sslExpiry === null`
- `renderTable()` — `leBadge` variable added; SSL cell now renders `<span class="le-badge">LE</span>` when applicable

---

## 🔖 [1.1.0] — 2026-03-22

### 🔐 First-PIN-Sets-PIN + Smart NS Detection + DNS Parsing Hardening

---

#### First-PIN-Sets-PIN

- **The problem:** The default PIN (`123456`) is public knowledge — anyone who finds the dashboard URL can enter it. There was no friction to nudge users toward changing it.
- **The fix:** After a successful unlock with the *default* PIN, a second modal appears before the dashboard loads, asking the user to set a personal 6-digit PIN. The new PIN is entered once and confirmed — if they match, the PIN_HASH in memory updates immediately. The script then attempts an HTTP PUT to rewrite `index.html` on the server so the change persists across reloads. On static hosts where PUT is blocked, a dialog shows the new hash for manual copy/paste into the file.
- **Skip option:** Users who want to keep `123456` (e.g. public demos) can click "Skip for now" and proceed immediately.
- **The PIN hint** in the login overlay no longer shows `123456` — it just says "Enter PIN", so the default isn't advertised to visitors.

#### Smart NS Provider Detection

- **The problem:** All self-hosted nameservers were labelled `Own` — a vague catch-all. In practice there are meaningful distinctions:
  - `ns1.siteground.net` → SiteGround (very common, very specific)
  - `ns3.cloudflare.com` for `cloudflare.com` → the domain hosts its own NS (self-referential)
  - `a.ns.apple.com` for `apple.com` → same self-referential pattern
  - `ns1.amazon.com` for a third-party domain → `Own` (correct)
- **The fix:** A two-step detection algorithm replaces the flat `Own` fallback:
  1. **Named providers first** — AWS, Azure, Google, NS1, Akamai, Wikimedia, ClouDNS, DNSimple, and now **SiteGround** all have explicit pattern matches.
  2. **Apex domain comparison** — extract the last two DNS labels from each NS hostname and compare to the monitored domain's own apex. If all NS hostnames share their apex with the domain (e.g. `cloudflare.com` → `ns3.cloudflare.com`), label it **`Domain`** — meaning the domain operates its own nameserver infrastructure.
  3. **NS-in-domain check** — if an NS hostname contains the monitored domain's apex as a substring, extract and capitalise the domain name as the label (e.g. `ns1.paulfleury.com` would label as `Paulfleury`).
  4. **`Own` fallback** — only for genuinely unknown third-party registrar NS that don't match any of the above.
- **`detectNSProvider(nsRecords, domain)`** — the function now takes a second `domain` argument for the self-NS comparison. All call sites updated.
- **Two new helper functions added:**
  - `apexDomain(hostname)` — extracts the last two DNS labels (e.g. `sub.example.com` → `example.com`)
  - `capitalise(s)` — capitalises the first letter of a string

#### DNS Parsing Hardening

- **The problem:** Cloudflare DoH wraps all TXT record values in double-quotes: `"v=spf1 …"` and `"v=DMARC1; p=quarantine"`. While `.includes()` searches happened to work through the quotes in most cases, the regex match for SPF qualifier (`~all`, `-all`) could fail if the regex anchored at a quote character.
- **The fix:** All three parsing functions now strip leading and trailing double-quotes before analysis:
  - `parseSPF(txtRecords)` — strips `"` wrappers, then matches `v=spf1` and `[~\-+?]all`
  - `parseDMARCPolicy(txtRecords)` — strips `"` wrappers, then matches `v=dmarc1` and `p=reject/quarantine/none`
  - `detectMXProvider(mxRecords)` — strips the priority prefix (`"10 "`, `"20 "`) and trailing dot from MX data before provider matching
- **Additional MX providers added:** Fastmail, Apple iCloud (`icloud.com`, `apple.com`)
- **Null/empty guards added** to `detectNSProvider`, `detectMXProvider` — return `—` or `None` gracefully instead of throwing on empty arrays

### ✨ Added

- **`checkFirstUse()`** — called by `pinCheck()` after correct PIN; routes to Set-PIN modal if default PIN, otherwise straight to `initDashboard()`
- **`spDigit(d)`** — digit handler for the Set-PIN numpad (phase 1: new PIN, phase 2: confirm)
- **`spDelete()`** — backspace handler for Set-PIN numpad
- **`spConfirm()`** — validates PIN match, updates `PIN_HASH` in memory, calls `spPersistHash()`
- **`spSkip()`** — skips Set-PIN flow, calls `initDashboard()` directly
- **`spUpdateDots(errorRow?)`** — updates both rows of PIN dots; dims confirm row until new PIN is complete
- **`spPersistHash(newHash)`** — async; fetches `index.html`, replaces `PIN_HASH` line via regex, PUTs the file back; returns `true` on success
- **Set-PIN modal HTML** — two dot rows (new + confirm), full numpad, error message, skip link
- **`apexDomain(hostname)`** — DNS apex extraction helper
- **`capitalise(s)`** — string helper
- **`DEFAULT_PIN_HASH`** constant — SHA-256 of `123456`, used to detect first-use condition
- **SiteGround** explicit NS detection pattern
- **Fastmail**, **Apple iCloud** MX provider patterns
- **`detectNSProvider` second argument** `domain` — required for self-NS comparison

### 🔄 Changed

- `detectNSProvider(nsRecords)` → `detectNSProvider(nsRecords, domain)` — **breaking if called without domain arg**, but only called from `checkDomain()` which was updated
- `parseSPF()` — now strips `"` wrappers from TXT data before matching
- `parseDMARCPolicy()` — now strips `"` wrappers from TXT data before matching
- `detectMXProvider()` — strips `"priority "` prefix from MX data before matching
- PIN hint text changed from `"Demo PIN: 1 2 3 4 5 6 · keyboard works too"` to `"Enter PIN · keyboard works too"` — no longer advertises the default PIN to visitors
- `pinCheck()` now calls `checkFirstUse()` instead of `initDashboard()` directly

---

## 🎉 [1.0.0] — 2026-03-22

### ✨ Added (Initial Release)

- **Core feature:** Live DNS monitoring for any list of domains, running entirely in the browser
- **5-record DNS scan per domain:** A (uptime + latency), NS, MX, TXT (SPF), `_dmarc TXT`
- **Progressive batch scanning** — 5 domains/batch, 300ms pause between batches; rows light up as results arrive
- **Loading opacity states** — all rows dim to 40% while a scan runs, restore on completion
- **Rate limiting** — 10s minimum gap between full refreshes, 5s per-domain for row refresh
- **Per-row ↺ refresh** — re-scans a single domain with `fullScan=true` (NS/MX/DMARC/SPF included)
- **PIN gate** with SHA-256 hash — `onclick` attributes on numpad (no `addEventListener` / DOMContentLoaded issues)
- **Stateless SHA-256** — recomputes primes each call; no `sha256.h` / `sha256.k` caching bug
- **Dark / Light mode** toggle switch (CSS checkbox, no storage needed)
- **`domains.list`** loader — plain-text file, one domain per line, `#` comments, fallback to BUILTIN top-30
- **BUILTIN top-30** list — seeded with real scan data (NS, MX, DMARC, SSL expiry)
- **Add Domain modal** — type domain, pick category, queue multiple, confirm → immediate DNS check
- **Delete row button** — removes custom domains from the live list
- **Export CSV** — timestamped download
- **`domains.stats`** auto-write — PUT to server after every full scan
- **`update-stats.php`** — server-side cron script for SiteGround/cPanel (no chmod tricks)
- **`webhook.do`** — headless endpoint for cron-job.org and similar external schedulers
- **Hover tooltips** on NS, MX, DMARC, SPF columns showing raw records
- **Webhook modal** — cron setup instructions with Nginx/Apache config examples
- **Help/Info modal** — full feature explanation + GitHub link
- **Auto-refresh countdown** — 3-minute timer with progress bar
- **Search, sort (5 options), and filter** (Alerts only / Online only)
- **Responsive layout** — works on mobile and tablet
- **MIT License**

---

<div align="center">

🗓️ Back to **[README.md](./README.md)** • 🐛 Report issues at **[GitHub Issues](https://github.com/paulfxyz/the-all-seeing-eye/issues)** • ⭐ Star if it helped!

</div>
