# 📝 Changelog

All notable changes to **Mercury** (`mercury-sh`) are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 🗓️ For full setup instructions, see the **[INSTALL.md](./INSTALL.md)**.
> 👤 Made with ❤️ by [Paul Fleury](https://mercury.sh) — [@paulfxyz](https://github.com/paulfxyz)


---

## ⚡ [5.4.0] — 2026-03-26

### Persistent Uptime Records + Webhook Automation

---

#### What changed

Uptime data is now persistently recorded to `uptime.json` from **every source** — browser sessions, manual refreshes, cron runs, and webhook calls all accumulate into the same server-side file. This means:

- Closing the browser tab no longer loses uptime history
- Multiple devices and visitors all contribute to the same record
- A free cron service (cron-job.org, UptimeRobot, GitHub Actions) calling `webhook.do` once per hour turns Mercury into a fully automated, always-recording uptime platform with zero infrastructure cost

#### Architecture: how data flows into `uptime.json`

```
Browser (manual Refresh)  ─┐
Browser (3-min auto)       ├─→ uptimeSave() → POST uptime-write.php → uptime.json
webhook.do (cron trigger)  ┤                  (delta merge, atomic write)
update-stats.php (PHP cron)┘
```

All four paths now write to `uptime.json`. Previously, `update-stats.php` (the PHP cron) and `webhook.do` did **not** call `uptimeSave()` — only browser sessions were persisted.

#### `update-stats.php` changes

- Added **Step 5.5** — after writing `domains.stats` and `domains.json`, the PHP cron now merges all UP/DOWN results into `uptime.json`
- Same atomic write strategy as `uptime-write.php` (temp file + `rename()`, `flock()`)
- Max 500 domains cap (trims least-checked first)
- Outputs `✓ uptime.json updated (N domains tracked)` in cron log
- Version constant bumped: `3.3.0` → `5.4.0`

#### `app.js` (webhook mode) changes

- `checkWebhookMode()` now calls `uptimeSave()` **and** `saveDomainsStats()` after `checkAll()` completes
- Previously these were missing from the webhook path — webhook runs were not persisting uptime

#### Landing page

- New **“Automated Monitoring” section** added (between Alerts showcase and CTA)
- 4-step visual flow: Schedule webhook → Mercury checks everything → Results saved to `uptime.json` → Email alerts
- cron-job.org callout with free tier badge and example webhook URL
- Section anchor: `#automation`

#### cron-job.org (demo.mercury.sh)

- Job `7418641`: `https://demo.mercury.sh/webhook.do` — every hour (`0 * * * *`) — active
- Job `7418643`: `https://demo.mercury.sh/update-stats.php` — every 6 hours (`0 */6 * * *`) — active

### ✨ Added

- `update-stats.php` Step 5.5: merge cron check results into `uptime.json`
- `app.js`: `uptimeSave()` + `saveDomainsStats()` called after webhook-mode `checkAll()`
- Landing page: Automated Monitoring section with 4-step flow and cron-job.org callout
- cron-job.org: 2 jobs created for `demo.mercury.sh` (hourly webhook + 6h PHP cron)

### 🔧 Fixed

- Webhook-triggered checks now correctly persist uptime data (previously lost on tab close)
- PHP cron (`update-stats.php`) now contributes to the shared `uptime.json` history

---

## 🐛 [5.3.0] — 2026-03-26

### Bugfix — Tooltips missing for ranks 51–100

---

#### Root cause

The `TOOLTIPS` object contained static NS / MX / DMARC / SPF detail entries for **ranks 1–50 only**. Ranks 51–100 (baidu.com, qq.com, samsung.com … cloudinary.com) had no entries, so `tooltipHTML()` returned an empty string for every hover on those rows — no tooltip appeared at all.

The `tooltipHTML()` function had an early return on `if (!td) return ''` with no fallback, so even after a live DNS scan populated `domainState` with raw records, the tooltip remained blank for any domain missing from the static map.

#### Fix

1. **50 new static TOOLTIP entries added** — every BUILTIN domain (ranks 51–100) now has a complete `{ ns, mx, dmarc, spf }` entry with accurate seeded data matching the same format and quality as ranks 1–50.

2. **`tooltipHTML()` live-data fallback** — when no static entry exists (custom domains added via `+ Add Domain`), the function now falls back to `domainState[domain].rawNS / rawMX / rawDMARC / rawSPF` populated by the live DoH scan. Previously, custom domains would never show tooltips even after a full check.

### ✨ Added

- `TOOLTIPS` entries for all 50 missing BUILTIN domains (ranks 51–100)
- `tooltipHTML()` graceful fallback to live `domainState` raw DNS records

### 🔧 Fixed

- Tooltips (NS, MX, DMARC, SPF) now show on hover for **all 100 BUILTIN domains** including baidu.com, qq.com, samsung.com, naver.com, vk.com, bbc.com, and all others
- Tooltips now also populate after a live scan for custom-added domains

---

## 🚀 [5.2.0] — 2026-03-26

### Production Deployment — Live on mercury.sh & demo.mercury.sh

---

#### What changed

This release marks the first production deployment of Mercury to the live SiteGround hosting environment at `mercury.sh` and `demo.mercury.sh`. Both subdomains are now live:

- **[mercury.sh](https://mercury.sh)** — The marketing landing page, served from `landing.html` (deployed as `index.html` to the `mercury.sh/public_html/` FTP directory). 11-language i18n, full SEO meta suite, animated demo preview, live stats band, full feature breakdown.
- **[demo.mercury.sh](https://demo.mercury.sh)** — The live app, served from `index.html` + `app.js` + `app.css` + PHP backends. Pre-loaded with representative demo domains. PIN-protected. No setup required to explore.

#### Infrastructure setup

- SiteGround shared hosting, FTP access at `gnldm1107.siteground.biz:21`
- Two separate document roots managed under the same FTP account:
  - `mercury.sh/public_html/` → landing page only
  - `demo.mercury.sh/public_html/` → full application stack
- Apache `.htaccess` handles no-cache headers, `webhook.do` routing, and file protection
- PHP 7.4+ required on demo subdomain for `config-write.php`, `uptime-write.php`, `notify.php`, `ssl-check.php`, `update-stats.php`

#### File layout (both environments)

```
mercury.sh/public_html/
├── index.html          ← landing page (from landing.html)
└── i18n.js             ← translation file, 11 languages

demo.mercury.sh/public_html/
├── index.html          ← Mercury app shell
├── app.js              ← all app logic (~82 KB)
├── app.css             ← all styles (~41 KB)
├── config-write.php    ← PIN / theme / notification config persistence
├── uptime-write.php    ← cross-device uptime history
├── notify.php          ← Resend email API + AES-256-GCM key encryption
├── ssl-check.php       ← server-side TLS cert check (PHP curl)
├── update-stats.php    ← cron-triggered SSL cert checker, writes domains.json
├── domains.list        ← watchlist (one domain per line)
├── domains.stats       ← CSV snapshot (auto-updated)
├── webhook.do          ← headless cron trigger endpoint
└── .htaccess           ← Apache config: cache headers + routing + file protection
```

### ✨ Added

- GitHub repository `paulfxyz/mercury-sh` now fully matches live deployment
- README updated with live demo link badge and correct deployment instructions
- INSTALL.md clarified: `index.html` on FTP root is the **app**, not the landing page
- CHANGELOG.md (this file) updated with every version from v1.0.0 through v5.2.0
- `domains.list` seeded with representative public domains for the demo instance

### 🔄 Changed

- `landing.html` deployed as `index.html` to `mercury.sh/public_html/` (landing domain root)
- GitHub repo README badge updated to `Version-5.2.0`
- Author URL corrected: [paulf.xyz](https://paulf.xyz) → [paul.fleury.xyz](https://paul.fleury.xyz) references cleaned

### 🔧 Fixed

- `i18n.js` now co-deployed alongside `landing.html` on the `mercury.sh` root — previously missing from FTP
- `.htaccess` `webhook.do` rewrite rule tested and confirmed working on SiteGround Apache
- File permissions set correctly: PHP scripts executable, data files protected from direct access

---

## 🔖 [5.1.0] — 2026-03-25

### 🌍 Internationalization (i18n) — 11 Languages · Language Picker UI

---

#### Why i18n?

Mercury is used globally — the domain monitoring use case is universal. Adding native-language support makes the landing page accessible to non-English audiences and signals the project's production-grade quality. This was also a deliberate exercise in building a zero-dependency i18n engine: no library, no JSON files to host, just a clean JS module and a `data-i18n` attribute convention.

#### What was challenging?

**Challenge 1 — Translation quality across 11 very different languages**

The core difficulty isn't adding `data-i18n` attributes — it's making the translations *sound natural*. Marketing copy is full of idioms ("watches over your fleet", "at the speed of a god", "never a flood") that translate poorly if done literally.

For each language, the translation strategy was:
- French: lean into technical elegance, use professional terminology ("Surveillance uptime", "zéro configuration")
- German: compound nouns work in our favor ("Domainüberwachung"), be direct and precise
- Spanish: warmer tone, use "tú" form throughout for modern dev audience
- Portuguese (PT variant): avoid BR slang, keep it clean and professional
- Turkish: modern tech vocabulary, avoid over-formal Ottoman roots
- Chinese (Simplified): tech lingo stays in Latin (API, DNS, SSL, DMARC), translate narratives
- Japanese: katakana for borrowed terms (ドメイン, SSL, DNS), keep honorifics neutral (です/ます)
- Russian: professional tone, avoid anglicisms where good Russian equivalents exist
- Italian: enthusiastic and direct, "il tuo server, le tue regole" sounds better than an exact literal map
- Hindi: Devanagari for narrative, technical terms stay Latin (API, SSL, AES-256)

**Challenge 2 — Elements with mixed HTML (innerHTML) vs plain text (textContent)**

Some translatable elements contain `<code>`, `<strong>`, or `<em>` tags inside them. Using `textContent` on those would strip the tags. Solution: `data-i18n-html` attribute (triggers `innerHTML` instead of `textContent`). Used for:
- `hero_subtitle` (contains `<strong>`)
- `how_step1_body` and `how_step2_body` (contain `<code>` tags for filenames)

**Challenge 3 — Language detection priority**

Correct order of precedence:
1. `mercury-lang` cookie (explicit user preference — highest priority)
2. `navigator.languages` array (browser's preferred list)
3. `navigator.language` fallback
4. `'en'` hardcoded fallback

**Challenge 4 — Dropdown UX without a JS framework**

The dropdown uses CSS transforms (`translateY` + `scale(0.97)`) for the open/close animation, with `pointer-events: none/all` to prevent interaction when hidden. `aria-expanded` is toggled for accessibility. Keyboard `Escape` closes it. Click-outside detection via a `document.click` listener with `!picker.contains(e.target)`.

### ✨ Added

- `i18n.js` — 1,079-line translation file, 11 languages × ~70 keys each
  - Languages: English · Français · Deutsch · Español · Português · Italiano · Türkçe · Русский · 中文 · 日本語 · हिंदी
  - Keys cover: nav, hero (title/subtitle/pills/CTAs), numbers band, all 6 feature cards, preview section, how-it-works steps, under-the-hood headings, 4 alert cards + badges, CTA section, built-by quote, footer links, copyright
- Language picker component in navbar:
  - Flag emoji + 2-letter language code badge
  - Smooth dropdown with `translateY` + `scale` animation
  - Active state highlights current language
  - `aria-label`, `aria-expanded`, `aria-haspopup`, `role="listbox"` for a11y
  - Keyboard navigation (`Escape` to close)
  - Click-outside-to-close
  - Mobile: hides text label, keeps flag + chevron
- `data-i18n="key"` attributes on all translatable text nodes (92 total)
- `data-i18n-html="key"` for elements with inner HTML markup
- Cookie persistence: `mercury-lang` cookie (1-year expiry, `SameSite=Lax`)
- Auto-detect: browser `navigator.languages` used on first visit
- `<html lang="...">` attribute updates on language switch (e.g., `zh-Hans`, `ja`)

### 🔄 Changed

- `landing.html` (renamed from `index.html` in repo, deployed as `index.html` to FTP):
  - All visible text wrapped in `data-i18n` spans for translation
  - CTA urgency text updated to include full subtitle from i18n key
  - Footer year updated: 2025 → 2026, copyright clarified "MIT License"
  - No AI tool branding anywhere on the public-facing page
- Nav: language picker sits after GitHub button, uses Mercury design system tokens

### 🔧 Fixed

- Footer copyright year was 2025 → corrected to 2026
- CTA subtitle text was truncated ("Deploy in 60 seconds. No account. No cloud.") vs full string in i18n.js

---

---

## 🔖 [5.0.0] — 2026-03-25

### 🌍 Mercury — Full Brand Relaunch

---

#### The All Seeing Eye → Mercury

Version 5.0.0 marks the complete brand transformation from **The All Seeing Eye** to **Mercury — Domain Guardian**.

- Repository renamed from `the-all-seeing-eye` → `mercury-sh`
- All references to personal domains removed throughout codebase and docs
- New landing page at [mercury.sh](https://mercury.sh) with Mercury brand identity
- Public demo at [demo.mercury.sh](https://demo.mercury.sh) with top-100 world domains
- BUILTIN domain list expanded from 50 → 100 world's most-visited domains

#### BUILTIN domains: 50 → 100

50 new domains added (ranks 51–100): Baidu, QQ, Samsung, IMDB, MSN, Live, Naver, Weather, WordPress.org, Fandom, iCloud, Booking, Etsy, Rakuten, Expedia, CNN, BBC, VK, Medium, Quora, Walmart, Target, w3schools, Indeed, Glassdoor, Investopedia, Reuters, Substack, Behance, npm, Docker, Kubernetes, GitLab, Bitbucket, Asana, Monday, Linear, Intercom, SendGrid, Mailchimp, Cloudinary, and more.

`domains.list` updated to 100 world sites. No personal domains in any shipped file.

### ✨ Added

- `mercury-sh` repo (renamed from `the-all-seeing-eye`)
- [mercury.sh](https://mercury.sh) — brand landing page
- [demo.mercury.sh](https://demo.mercury.sh) — public live demo
- BUILTIN ranks 51–100 with full NS/MX/DMARC/SPF data
- 50 new TOOLTIPS entries for new domains

### 🔄 Changed

- All `The All Seeing Eye` → `Mercury` throughout codebase
- All `all-seeing-eye` → `mercury-sh` in URLs, file references, comments
- All personal domain references removed
- `domains.list` → top-100 world domains
- README, CHANGELOG, INSTALL rewritten with Mercury brand

---

## 🔖 [4.1.0] — 2026-03-25

### 📱 Mobile PIN UX Overhaul — No Duplicate Dots · Auto-Focus · Keyboard on Demand

---

#### The three problems visible in the screenshot

**Problem 1 — Duplicate dot indicators**

The mobile view showed two sets of PIN entry feedback simultaneously:
- The original `.pin-dots` (6 SVG circles from the desktop numpad UX)
- The `<input type="password">` with `placeholder="······"` (6 grey dots from the browser's password placeholder)

Both were visible at the same time, creating a confusing and ugly double-row of dots.

**Root cause:** When `initMobilePinInput()` ran, it set `pin-grid` to `display:none` (hiding the numpad) but left `pin-dots` visible. The native input then rendered its own placeholder dots below them.

**Fix:** Added `.pin-card.mobile-pin-active .pin-dots { display: none }` and `.pin-card.mobile-pin-active .pin-grid { display: none }` in `app.css`. JS adds `mobile-pin-active` class to `.pin-card` instead of inline `display:none` per element — cleaner, easier to override, debuggable in DevTools.

**Problem 2 — Input not centred**

The input rendered left-aligned on mobile. CSS had `width: 200px` with no `margin: auto`.

**Fix:** `width: 100%; max-width: 280px; margin: 0 auto;` — now fills the card width, capped at 280px, centred.

**Problem 3 — Auto-focus never fired**

The `initMobilePinInput()` IIFE used a `MutationObserver` watching for `style` attribute changes on `#pin-overlay`. However, the PIN overlay is visible from initial page render — no `style` attribute is ever written to it (it's shown via CSS default state, not `el.style.display`). The observer never triggered because there was never a mutation to observe.

The backup check `if (overlay && overlay.style.display !== 'none')` also failed because `overlay.style.display` is `""` (empty string — no inline style) for an element that's visible via CSS.

**Fix:** Use `requestAnimationFrame(() => setTimeout(() => _focusMobilePin(), 120))`. This fires after the first paint, ensuring the element is rendered and interactive before `focus()` is called. iOS requires this two-step delay — `focus()` called during the same JS tick as page load is silently ignored.

---

#### Change PIN modal — same issues fixed

The Change PIN modal previously only had the numpad (no native input on mobile), causing the same tap-to-dismiss numpad issues.

Added:
- `<input id="cp-mobile-input">` — same pattern as login input
- `openChangePinModal()` now adds `.mobile-pin-active` to `#cp-card` on touch devices
- Auto-focus fires after the 250ms card-in animation completes
- `cpMobileInput(el)` handler — mirrors `cpDigit()` / `cpCheck()` for keyboard input
- `_cpClearMobileInput()` — clears and re-focuses between phases (current → new → confirm)

---

#### New architecture: `_isTouchDevice` global flag

Previously, touch detection (`navigator.maxTouchPoints > 0`) was scattered across multiple places. Now a single `var _isTouchDevice = false` is set during `initMobilePinInput()` (which also checks `window.innerWidth < 1024` to exclude touch laptops). All mobile-specific code now checks `_isTouchDevice` rather than re-querying `navigator.maxTouchPoints`.

### 🐛 Fixed

- Duplicate dot indicators on mobile login screen
- Mobile input left-aligned (fixed with `width:100%, max-width:280px, margin:0 auto`)
- Auto-focus on page load (replaced broken MutationObserver with rAF+setTimeout)
- Change PIN modal: no native keyboard on mobile (added cp-mobile-input)
- Change PIN modal: auto-focus not firing on each phase (added _cpClearMobileInput)

### ✨ Added

- `_isTouchDevice` global flag — single touch detection, set at init
- `_focusMobilePin()` — reusable focus helper for login PIN input
- `cpMobileInput(el)` — handler for Change PIN mobile input
- `_cpClearMobileInput()` — clear + re-focus between CP phases
- CSS `.pin-card.mobile-pin-active .pin-dots { display:none }` — class-based hiding
- CSS `.pin-card.mobile-pin-active .pin-grid { display:none }` — same for numpad
- `id="cp-card"` on Change PIN inner div — JS can add `.mobile-pin-active`
- `id="cp-grid"` on Change PIN numpad — JS can target it directly

### 🔄 Changed

- `initMobilePinInput()` — uses `rAF + setTimeout` instead of MutationObserver
- `initMobilePinInput()` — uses `.mobile-pin-active` class instead of inline styles
- `openChangePinModal()` — activates mobile mode + auto-focuses input
- `closeChangePinModal()` — clears cp-mobile-input on close
- `cpCheck()` — calls `_cpClearMobileInput()` between phases
- CSS `.pin-mobile-input` — `width:100%`, `max-width:280px`, `margin:0 auto`
- index.html — cp-mobile-input added inside change-PIN modal

---

## 🔖 [4.0.0] — 2026-03-23

### 🚀 Stable Release — Notification Persistence · Smart Cooldowns · Full Production-Ready

---

#### The problem with v3.3.x notifications

**"I hit Refresh and didn't get an email."**

Root cause: `_notifyLastSent` was an in-memory JavaScript object initialised to `{}` on every page load. The first check fires an alert and marks `_notifyLastSent["domain:ssl_expiry"] = Date.now()`. The 24h cooldown means no more emails until tomorrow — correct for auto-refresh, terrible for manual interaction.

Two sub-problems:
1. **No distinction between manual and automatic checks.** A user clicking Refresh explicitly wants to know the current health state. They should get an email. An auto-refresh running every 3 minutes should not.
2. **State lost on page reload.** `_notifyLastSent` reset to `{}` on every page load — so the first check on a fresh session always fired an email, even if one was sent 30 seconds ago by the previous session.

---

#### Fix: Dual cooldown system

Two cooldown tables replace the single `NOTIFY_COOLDOWN`:

```
NOTIFY_COOLDOWN_AUTO (default, for 3-min auto-refresh):
  ssl_expiry:    86400000  (24 hours)
  dmarc_missing: 86400000  (24 hours)
  dmarc_none:    86400000  (24 hours)
  spf_missing:   86400000  (24 hours)
  down:           3600000  (1 hour — repeated reminders if still down)

NOTIFY_COOLDOWN_MANUAL (when user clicks Refresh):
  ssl_expiry:     300000   (5 minutes)
  dmarc_missing:  300000   (5 minutes)
  dmarc_none:     300000   (5 minutes)
  spf_missing:    300000   (5 minutes)
  down:            60000   (1 minute)
```

`_activeCooldown` is set to `NOTIFY_COOLDOWN_MANUAL` when `triggerRefresh()` sets `_manualRefresh = true` before calling `checkAll()`. After `sendHealthReport()` runs, `_activeCooldown` is reset to `NOTIFY_COOLDOWN_AUTO`.

`force: true` (test email) bypasses all cooldowns entirely by setting all values to 0.

---

#### Fix: Notification state persistence

`_notifyLastSent` is now saved to `ase_config.json` after every successful digest send (and after all-clear scans) via `_notifySaveState()` → `saveConfig({ notify_last_sent: {...} })`. On startup, `loadConfig()` calls `_notifyLoadState(cfg)` to restore the map.

This means:
- Page reload does NOT reset cooldowns — the 24h window persists correctly
- Multiple browser tabs share the same state (via server config)
- A cron-sent notification counts toward the browser's cooldown (and vice versa — though the cron uses its own `cron_notify_sent.json` tracker)

`config-write.php` validates `notify_last_sent`: keys must be `"domain:type"` format with a valid type name; values must be integers (Unix ms timestamps).

---

#### `_manualRefresh` flag flow

```
triggerRefresh()
  ├── _manualRefresh = true
  └── checkAll()
        ├── DNS checks (batched)
        ├── fetchAllSSLExpiry()
        │     └── .then() {
        │           var wasManual = _manualRefresh
        │           _manualRefresh = false          ← reset before next cycle
        │           sendHealthReport(wasManual)     ← uses MANUAL cooldowns
        │         }
        └── if needSSL.length === 0 {
              var wasManual = _manualRefresh
              _manualRefresh = false
              sendHealthReport(wasManual)
            }

Auto-refresh (setInterval / initDashboard):
  └── checkAll()  [_manualRefresh = false by default]
        └── sendHealthReport(false)  ← uses AUTO cooldowns
```

---

#### Why v4.0.0?

This release brings the notification system to a state where it behaves intuitively in all scenarios:
- ✅ Manual Refresh → email (5-min cooldown, user-controlled)
- ✅ Auto-refresh → no email spam (24h cooldown, silent)
- ✅ Cron check → email (file-backed cooldown, 24h)
- ✅ Page reload → cooldowns respected (server-persisted state)
- ✅ Test button → always fires (bypasses all cooldowns)
- ✅ All-clear → no email, but state saved
- ✅ DOWN domain → immediate email, hourly reminder
- ✅ Recovery → immediate email

Combined with v3.x features (mobile-first, server-side uptime, config persistence, enriched email digest), this represents a complete, production-ready monitoring dashboard.

### ✨ Added

- **`NOTIFY_COOLDOWN_AUTO`** — auto-refresh cooldowns (24h health, 1h down)
- **`NOTIFY_COOLDOWN_MANUAL`** — manual refresh cooldowns (5min health, 1min down)
- **`_activeCooldown`** — active cooldown map, switched per check type
- **`_manualRefresh`** — global flag set by `triggerRefresh()`, consumed by `checkAll()`
- **`_notifySaveState()`** — fire-and-forget save to `ase_config.json`
- **`_notifyLoadState(cfg)`** — restore `_notifyLastSent` from server config
- **`config-write.php`** — `notify_last_sent` field with key/type validation

### 🔄 Changed

- `app.js` — `sendHealthReport(isManual, force)` — new signature with dual mode
- `app.js` — `_notifyCooldownOk()` — uses `_activeCooldown` instead of hardcoded table
- `app.js` — `triggerRefresh()` — sets `_manualRefresh = true` before `checkAll()`
- `app.js` — `checkAll()` — captures `_manualRefresh`, resets it, passes to `sendHealthReport()`
- `app.js` — `loadConfig()` — calls `_notifyLoadState(cfg)` after config fetch
- `app.js` — `sendHealthReport()` — saves state after send and on all-clear

---

## 🔖 [3.3.1] — 2026-03-23

### 🐛 Critical Fix — PHP Fatal Errors in notify.php

---

#### Root cause: Three PHP parse/runtime errors

**Error 1 — Arrow functions () require PHP 7.4+**
notify.php used  in three places inside . SiteGround's effective PHP version for this file was below 7.4, causing a fatal parse error before any output — producing the blank 500 response that the browser JS received as "Unexpected end of JSON input".

Fix: replaced all three  arrow functions with compatible anonymous functions:

→ 

**Error 2 — Function calls inside heredoc interpolation**
PHP heredoc syntax () allows simple variable interpolation  but NOT complex expressions like . These cause a parse error.

The three offending lines were the SPF, NS, and MX cells:


All three variables (, , ) are now pre-resolved before the heredoc block.

**Error 3 — Inline escaped quotes inside a double-quoted string**
The summary  line used  — escaped double quotes inside a double-quoted string, which terminated the string early.

Fix: rebuilt the summary string using concatenation with single quotes.

---

#### Lesson learned
Heredoc interpolation in PHP only supports  — NOT  or . Always pre-resolve complex expressions into simple variables before a heredoc block. This is easy to miss in PHP because the parser accepts it without syntax highlighting errors in most editors.

### 🐛 Fixed

-  — 3×  arrow functions → 
-  — SPF/NS/MX cells: pre-resolve , ,  before heredoc
-  — Summary line: rebuild with concatenation, no escaped quotes
-  — same arrow function fix (, ) for future PHP compatibility

---

## 🔖 [3.3.0] — 2026-03-23

### 🔔 Complete Notification Coverage — Cron + Browser · Digest Format · Deduplication

---

#### The problem with v3.2.0 notifications

v3.2.0 only fired notifications on UP↔DOWN transitions detected in `uptimeRecord()`. Two critical paths were missing:

1. **Health alerts never fired from browser checks.** After `fetchAllSSLExpiry()` completed and SSL data was merged into DOMAINS, nobody scanned for "SSL expiring in 12 days" and sent an alert. The data was there; nothing acted on it.

2. **The cron never sent any notifications.** `update-stats.php` detected `$alertCount > 0` and logged it, but never POSTed to `notify.php`. A cron-detected downtime was completely silent.

3. **No deduplication.** If a domain has SSL expiring in 25 days, the auto-refresh fires every 3 minutes — that's 480 emails/day without a cooldown system.

---

#### Fix 1 — `sendHealthReport()` in app.js

A new function scans all DOMAINS after every full check cycle. It runs in two places:

```
checkAll()
  ├── DNS checks (batched)
  ├── fetchAllSSLExpiry()  →  .then(sslMap => {
  │     merge SSL data          merge into DOMAINS
  │     renderTable()           sendHealthReport()  ← HERE (SSL data complete)
  │   })
  └── if (needSSL.length === 0)
        sendHealthReport()  ← HERE (all data already known)
```

`sendHealthReport()` checks five conditions per domain: DOWN, SSL ≤30d, DMARC missing, DMARC p=none, SPF missing. Each condition uses a per-domain per-type cooldown (`_notifyLastSent[domain:type]`) to prevent re-sending. If nothing is wrong, no fetch() is made. If issues exist, a single digest is POSTed to `notify.php?action=digest`.

**Cooldown periods** (configurable via `NOTIFY_COOLDOWN` constant):
- `down` — 1 hour (repeated reminder if domain stays down)
- `ssl_expiry` — 24 hours
- `dmarc_missing` — 24 hours
- `dmarc_none` — 24 hours
- `spf_missing` — 24 hours

**Bottleneck encountered:** The browser sends one digest covering ALL issues across ALL domains — not one email per domain. This required a new `action:"digest"` in `notify.php` that accepts an array of issue objects and renders a multi-domain email.

---

#### Fix 2 — `update-stats.php` now sends notifications

After the check loop (Steps 1–4), a new Step 6 runs:

1. Reads `ase_config.json` to check `notify_enabled`
2. Scans results for: DOWN, SSL ≤30d, DMARC missing/none, SPF missing
3. Loads `cron_notify_sent.json` — the cron's deduplication tracker (equivalent of `_notifyLastSent` in the browser, but file-backed since the cron has no persistent memory between runs)
4. For each new issue (past cooldown): adds to issues array, marks sent
5. POSTs to `notify.php?action=digest` via HTTP self-request
6. Logs result (`✓ Notification sent: N issue(s)` or `⚠ Notification failed: ...`)

**Why HTTP self-request rather than including notify.php directly?**
Including notify.php would require duplicating the Resend/AES-256-GCM logic. An HTTP self-request keeps the logic in one place. The `$_SERVER['SERVER_NAME']` check handles the edge case where the cron runs via CLI without HTTP context — in that case it logs a warning rather than failing silently.

---

#### Fix 3 — Digest email format (`action:"digest"`)

A new `buildDigestEmail()` function in `notify.php` generates a multi-domain health report. Each issue renders as a card with: domain name + severity badge, detail text, and a 3×2 mini-table (Latency, SSL, DMARC, SPF, NS, MX).

Issues are sorted: criticals first, then warnings. The email header colour is red for criticals, amber for warnings-only.

**Test email** now sends a 3-issue demo digest (DOWN + SSL expiring in 5 days + DMARC missing) so users can see exactly what a real alert email looks like before any real issue occurs.

---

#### Architecture summary

```
Notification trigger paths:
─────────────────────────────────────────────────────────────
A. UP↔DOWN transition (browser)   uptimeRecord() → notifyDowntime()
   [individual domain DOWN/UP alert — immediate, no cooldown]

B. Health scan (browser)          checkAll() → sendHealthReport()
   [full digest after every check cycle — cooldown-protected]

C. Cron check (server)            update-stats.php Step 6
   [full digest after every cron run — file-backed cooldown]
─────────────────────────────────────────────────────────────
All three paths → notify.php → Resend API → your inbox
```

### ✨ Added

- **`sendHealthReport(force?)`** — scans all domains, collects issues, sends digest
- **`_notifyLastSent`** — in-memory cooldown tracker (domain:type → timestamp)
- **`NOTIFY_COOLDOWN`** — configurable cooldown constants per issue type
- **`_notifyCooldownOk(domain, type)`** — checks cooldown before sending
- **`_notifyMarkSent(domain, type)`** — records send timestamp
- **`_calcSslDays(sslExpiry)`** — utility: days until SSL expiry from date string
- **`notify.php: buildDigestEmail(issues, totalDomains, domainsDown)`** — multi-domain HTML report
- **`notify.php: action:"digest"`** — accepts array of issues, sends one email
- **`update-stats.php Step 6`** — post-check notification with deduplication
- **`cron_should_notify()` / `cron_mark_sent()`** — file-backed deduplication for cron
- **`cron_notify_sent.json`** — cron deduplication state file
- **`.htaccess`** — `cron_notify_sent.json` added to protected files

### 🔄 Changed

- `app.js` — `checkAll()`: calls `sendHealthReport()` after SSL merge + when needSSL is empty
- `notify.php` — `buildAlertEmail()` kept for `action:"notify"` (UP↔DOWN single-domain)
- `notify.php` — test action: sends a 3-issue demo digest instead of plain single alert
- `update-stats.php` — VERSION updated to 3.3.0; `NOTIFY_PHP`, `CONFIG_FILE`, `NOTIFY_SENT` defines added
- `README` — features list, inline changelog, How It Works updated

---

## 🔖 [3.2.0] — 2026-03-23

### 🔔 Enriched Email Notifications · Help Modal Docs · Dropdown Fix

---

#### Enriched email alerts

Every downtime/recovery notification now includes a **full domain health digest**:

| Field | What it shows |
|---|---|
| Domain | Linked to `https://domain` |
| Status | DOWN (red) / UP (green) |
| Latency | Round-trip ms at time of check |
| SSL Expiry | Date + days remaining, colour-coded |
| DMARC | Policy (reject/quarantine/none/missing), colour-coded |
| SPF | Record value or missing |
| Nameserver | Detected provider (Cloudflare, AWS, etc.) |
| Mail Provider | Detected mail service |

**Auto-detected health alerts** appear as coloured boxes below the table:

| Condition | Severity | Alert text |
|---|---|---|
| SSL expired | 🚨 Critical | Certificate is expired — visitors see a security warning |
| SSL ≤7 days | 🚨 Critical | Expires in N day(s) — renew immediately |
| SSL ≤30 days | ⚠ Warning | Expires in N days — renewal recommended |
| DMARC missing | ⚠ Warning | Domain vulnerable to email spoofing |
| DMARC p=none | ⚠ Warning | Policy defined but not enforced |
| SPF missing | ⚠ Warning | Increases chance of being marked as spam |

**`notifyDowntime()` now passes the full snapshot:** SSL expiry date + calculated days remaining, DMARC, SPF, NS, MX are all read from the in-memory DOMAINS array and domainState, then forwarded to `notify.php`.

**Test email** now shows a realistic demo snapshot (example domain with expiring SSL + warning alert) so users can see exactly what a real alert looks like.

#### Help modal — Notifications documentation

A new **🔔 Notifications** card added to the Help/How It Works modal (accessible via More ⋮ → Help). Explains:
- What events trigger alerts (DOWN, recovery)
- What each email contains (SSL, DMARC, SPF, etc.)
- How to configure (More ⋮ → Notifications)
- Which API is used (Resend, free tier 100/day)
- Security model (AES-256-GCM encrypted key, never plaintext)
- Rate limit (10 emails/hour)

#### Dropdown modal click race condition fix

All 4 dropdown buttons that open modals (Webhook, Change PIN, Notifications, Help) now call `event.stopPropagation()` before opening the modal. Without this, the bubbling click event reached the document-level outside-click listener, which attempted to close the menu — and in some timing scenarios, also interfered with the modal opening. Now the sequence is: `stopPropagation → closeHeaderMenu() → openModal()`.

### ✨ Added

- **`analyseHealth(array $extra)`** in `notify.php` — auto-detects SSL/DMARC/SPF issues, returns array of labelled alerts
- **Health alerts section** in email HTML — colour-coded critical/warning boxes
- **Full domain snapshot** forwarded from `notifyDowntime()` to `notify.php`
- **SSL days calculation** in `notifyDowntime()` — derived from `entry.sslExpiry`
- **Test email demo snapshot** — realistic example showing what a real alert looks like
- **Help modal Notifications card** — explains feature, configuration, security model

### 🔄 Changed

- `notify.php` — `buildAlertEmail()`: accepts `$extra` array + `$isTest` flag; renders all health fields with colour coding; calls `analyseHealth()`
- `notify.php` — test action: uses `buildAlertEmail(..., [], true)` with demo snapshot
- `app.js` — `notifyDowntime()`: collects DOMAINS entry + ssl_days calculation, forwards full payload
- `index.html` — Help modal: new Notifications card inserted before PIN Security
- `index.html` — all dropdown modal buttons: `event.stopPropagation()` added

---

## 🔖 [3.1.0] — 2026-03-23

### 🔔 Email Notifications · 📊 Cross-Device Uptime

---

#### Email Notifications via Resend

A new **Notifications** entry in the More ⋮ menu opens a configuration modal. Users enter:
- **Resend API key** — sent to `config-write.php` which encrypts it AES-256-GCM before storing in `ase_config.json`
- **From email** — must be a verified sender domain in Resend
- **To email** — notification recipient
- **Enable toggle** — on/off without losing settings
- **Send Test** — fires a test email immediately to verify the setup

`notify.php` handles sending:
1. Reads `notify_api_key_enc` from `ase_config.json` and decrypts it using the server-side secret (`notify_secret.key`)
2. Builds a styled HTML email (green/red header, domain, status, latency, timestamp)
3. POSTs to `https://api.resend.com/emails`
4. Enforces rate limit: max 10 emails/hour (tracked in `notify_rate.json`)
5. Handles both `DOWN` (domain unreachable) and `UP` (recovery) events

**Security design:**
- The Resend API key is **never stored or transmitted in plaintext** once saved
- `notify_secret.key` is auto-generated (256-bit random) on first use, `chmod 0600`, protected by `.htaccess`
- Decryption only happens server-side inside `notify.php` — the browser only ever sees the key while the user is typing in the modal
- `notify_rate.json` and `notify_secret.key` blocked from direct HTTP access via `.htaccess`

**Trigger logic in `uptimeRecord()`:**
- Detects UP→DOWN transitions (was up last check, now down) → fires `notifyDowntime(domain, 'DOWN', latency)`
- Detects DOWN→UP transitions (was down, now recovered) → fires `notifyDowntime(domain, 'UP', latency)`
- Non-blocking: `notifyDowntime()` uses fire-and-forget `fetch()` — never delays the check cycle

#### Cross-Device Uptime History (`uptime.json`)

**Previous behaviour:** Uptime was stored in the `ase_uptime` browser cookie — isolated per device, lost in incognito, capped at 4KB.

**New behaviour:** `uptime-write.php` provides a server-side accumulation endpoint. `uptime.json` is a single shared record updated by every check from every device.

Architecture:
1. `loadConfig()` now also calls `uptimeLoad()` — fetches `uptime.json` on startup (or falls back to cookie if PHP unavailable)
2. `uptimeRecord()` now tracks a per-cycle delta (`_uptimeDelta`) in addition to updating `_uptimeData`
3. After each `checkAll()`, `uptimeSave()` POSTs deltas to `uptime-write.php` (one POST per changed domain) and writes the cookie fallback
4. `uptime-write.php` merges incoming deltas into `uptime.json` atomically (temp file + rename + LOCK_EX)

`uptime.json` stores up to 500 domains (trims least-checked). Protected from direct HTTP access via `.htaccess`.

**Cookie fallback:** The `ase_uptime` cookie is still written after each save. If `uptime-write.php` is unavailable (static host), behaviour is identical to v3.0.0 — no regression.

### ✨ Added

- **`notify.php`** — Resend email sender (AES-256-GCM decryption, rate limit, HTML template)
- **`uptime-write.php`** — server-side uptime accumulation (GET + POST, atomic writes)
- **`notifyDowntime(domain, status, latency)`** — fire-and-forget notification trigger
- **`sendTestNotification()`** — sends test email via notify.php
- **`applyNotifyConfig(cfg)`** — applies server config to `_notifyConfig` in-memory
- **`_notifyConfig`** — in-memory notification settings object
- **`_uptimeDelta`** — per-cycle delta tracking for efficient server sync
- **`openNotifyModal()` / `closeNotifyModal()`** — modal open/close
- **`saveNotifySettings()`** — saves notification config via `saveConfig()`
- **`notifyToggleChanged()`, `notifyToggleKeyVisibility()`, `notifyShowTestResult()`** — UI helpers
- **`_notifyUpdateMenuDot()`** — shows green dot in More menu when notifications active
- **Notifications modal** in `index.html` — enable toggle, API key field (password + reveal), from/to email, test button
- **"Notifications" entry** in More ⋮ dropdown with active indicator dot
- **`config-write.php`** — extended with `notify_enabled`, `notify_from`, `notify_to`, `notify_api_key` (encrypts on write), `notify_api_key_clear` fields
- **`.htaccess`** — `uptime.json`, `notify_secret.key`, `notify_rate.json` added to protected files list

### 🔄 Changed

- `app.js` — `uptimeLoad()`: now async, fetches from server first, cookie fallback
- `app.js` — `uptimeSave()`: POSTs deltas to `uptime-write.php`; cookie write retained
- `app.js` — `uptimeRecord(domain, isUp, latency)`: accepts latency param; tracks delta; detects UP↔DOWN transitions
- `app.js` — `loadConfig()`: calls `uptimeLoad()` in parallel with config fetch; calls `applyNotifyConfig()`
- `app.js` — `checkDomain()`: passes `ms` (latency) to `uptimeRecord()`

---

## 🔖 [3.0.0] — 2026-03-22

### 📱 Mobile-First Overhaul — Native PIN Keyboard · Rebuilt Modal System

This release addresses two long-standing mobile UX regressions and adds a proper mobile PIN entry experience.

---

#### Problem 1 — Modal close button unreachable (root cause, finally)

Previous attempts used `position: sticky` on the title bar inside the modal card. This silently failed because the card had `overflow: hidden` set — **`overflow: hidden` on a parent element completely disables `position: sticky` on any descendant**. This is a well-known but easy-to-miss CSS gotcha.

**The correct fix:** redesign the modal as a proper flex column where the header and footer are `flex-shrink: 0` (they never compress) and the body is `flex: 1 1 auto; overflow-y: auto` (it scrolls). No `overflow: hidden` anywhere. The card uses `max-height: min(90vh, 700px)` to cap its size. Result: header and footer are **always** visible at fixed positions, regardless of how much content the body contains.

New CSS classes (reusable for all current and future modals):
```
.modal-overlay   — backdrop, flex centering
.modal-card      — flex column, max-height capped
.modal-header    — flex-shrink:0, always visible at top
.modal-body      — flex-grow, overflow-y:auto, touch scroll
.modal-footer    — flex-shrink:0, always visible at bottom
```

Additionally: `openInfoModal()` and `openWebhookModal()` now reset `.modal-body` `scrollTop = 0` on every open — so the content always starts at the top.

#### Problem 2 — Double-tap zoom on PIN numpad

iOS and Android trigger a double-tap zoom when buttons don't have `touch-action: manipulation` set. The 300ms delay compounds this. Added `touch-action: manipulation` to the global CSS rule covering all `button`, `a`, `.btn`, `.pin-btn`, and `[onclick]` elements — eliminates the delay and zoom sitewide.

#### New feature — Mobile PIN: native numeric keyboard

On touch devices (`navigator.maxTouchPoints > 0`), the custom numpad is hidden and replaced with a native `<input type="password" inputmode="numeric">` field. This:
- Triggers the **system numeric keyboard** (large, familiar, accessible)
- Prevents iOS zoom (font-size 28px — above the 16px zoom threshold)
- Auto-focuses when the PIN overlay appears
- Dots still fill as you type (synced via `pinMobileInput()`)
- On wrong PIN: input clears + red border flash + dots flash error
- On correct PIN: input is dismissed, normal flow continues

Why keep the numpad at all? It still works in sandboxed iframes (sandboxed iframe preview) where `focus()` may not trigger. The numpad handles non-touch contexts; the input handles touch contexts. Both call the same `pinBuffer` + `pinCheck()` logic.

### ✨ Added

- **`.modal-overlay`, `.modal-card`, `.modal-header`, `.modal-body`, `.modal-footer`** — new modal CSS system
- **`.code-block`, `.code-label`, `.code-inline`** — reusable code display classes
- **`.btn-ghost`** — ghost button variant
- **`.pin-mobile-input`** — native numeric input for touch devices
- **`pinMobileInput(el)`** — handler for mobile input: strips non-digits, syncs dots, runs check
- **`initMobilePinInput()`** — IIFE: detects touch device, shows input, hides numpad, sets up observer
- **`touch-action: manipulation`** — global CSS on all interactive elements

### 🐛 Fixed

- Modal close button: always visible via flex-column architecture (no more `position:sticky` + `overflow:hidden` conflict)
- `openInfoModal()` / `openWebhookModal()`: reset `.modal-body scrollTop = 0` on open
- Double-tap zoom: `touch-action: manipulation` eliminates 300ms delay on all buttons
- Viewport meta: `viewport-fit=cover` added for notch/safe-area support

### 🔄 Changed

- `index.html` — webhook-modal and info-modal rebuilt with new CSS class system
- `index.html` — viewport meta: added `viewport-fit=cover`
- `index.html` — mobile PIN input `<input>` added inside `#pin-overlay`
- `app.css` — full modal CSS system added (replacing inline styles)
- `app.js` — `openWebhookModal()` / `openInfoModal()`: scroll body to top on open
- `app.js` — `initMobilePinInput()` IIFE + `pinMobileInput()` handler added

---

## 🔖 [2.3.1] — 2026-03-22

### 🚨 Critical Hotfix — Broken DOM (unclosed div)

- **Root cause:** The v2.3.0 modal restructuring introduced a missing `</div>` in the webhook modal's scroll body wrapper. The unclosed `<div>` at line 369 caused all HTML after it — including the set-PIN overlay, dashboard, and every other modal — to be swallowed into that div's subtree, making them non-functional.
- **Symptom:** After entering PIN `123456`, nothing happened — the set-PIN prompt never appeared. The dashboard was unreachable.
- **Fix:** Added the missing `</div>` closing the scroll body wrapper before the sticky Close button footer.
- **Verified:** HTML parser confirms 0 unclosed structural elements after fix.

---

## 🔖 [2.3.0] — 2026-03-22

### 📱 Mobile UI Overhaul · Modal Fix

---

#### Root causes (from mobile audit at 390×844px)

1. **Help modal close button at -175px** — the inner card was taller than the viewport, so the title bar + X button scrolled above the fold immediately on open. User was effectively trapped.
2. **Modal `scrollTop` not reset** — `openInfoModal()` and `openWebhookModal()` called `classList.add('open')` but never reset scroll position. On second open the modal remembered its last scroll position.
3. **X button tap area 17×32px** — far below the 44×44px minimum; on mobile this is nearly impossible to hit reliably.
4. **Table overflow 940px off-screen** — no visible scroll affordance, `-webkit-overflow-scrolling: touch` missing.
5. **Row height too small** — `td` cells were ~32px tall; minimum recommended tap target is 44px.

#### Fix: Sticky header + scrollable body + sticky footer (all modals)

Both the **Help** and **Webhook/Cron** modals are now restructured as:
```
┌─────────────────────────────┐
│ [Sticky] Title bar + ✕ btn  │  ← always visible, position: sticky top:0
├─────────────────────────────┤
│ [Scrollable] Content        │  ← overflow-y: auto, -webkit-overflow-scrolling: touch
│   ...                       │
│   ...                       │
├─────────────────────────────┤
│ [Sticky] [    Close    ]    │  ← always visible at bottom; impossible to miss
└─────────────────────────────┘
```
This means: on any screen size, the user can **always see the close button** — both at the top (X icon) and at the bottom (full-width Close button). No scrolling required to close.

#### `.modal-close-btn` — 44×44px touch target

New CSS class for all modal X buttons:
- `min-width: 44px; min-height: 44px` — meets Apple/Google tap target guidelines
- Negative margin trick: extends hit area without affecting layout
- Hover state: background tint + text color transition

#### Table: horizontal scroll with touch momentum

- `-webkit-overflow-scrolling: touch` — native momentum scrolling on iOS
- Scroll shadow overlay (CSS radial-gradient trick) — subtle visual cue that more content exists to the right
- `background-attachment: local/scroll` combo — shadows appear/disappear as user scrolls

#### Row tap targets

- `td` cells: `padding-top/bottom: 12px` on mobile → row height ~48px
- `min-height: 48px` on `tbody tr`

#### Header + controls + footer

- Header action buttons: `min-height: 44px` on mobile
- Status bar: `flex-wrap: wrap` — doesn't overflow on narrow screens
- Controls row: `flex-wrap: wrap` — filters drop below search on mobile
- Footer links: `min-height: 44px; line-height: 44px` — proper tap targets

### 🐛 Fixed

- `openInfoModal()` / `openWebhookModal()` — `scrollTop = 0` on every open
- Both modals — sticky header (title + X button always visible)
- Both modals — sticky Close button at bottom (full-width, unmissable)
- `✕` button — replaced inline style with `.modal-close-btn` class (44×44px)
- Table — `-webkit-overflow-scrolling: touch` + scroll shadow overlay

### 📱 Added

- CSS `.modal-close-btn` — 44×44px touch target class used across all modals
- CSS `@media (max-width: 640px)` — mobile table, header, controls, footer improvements
- CSS `@media (max-width: 400px)` — very small phone adjustments

---

## 🔖 [2.2.1] — 2026-03-22

### 🐛 Hotfix — Browser Cache Headers · Clean domains.stats · .htaccess Security

---

#### Root cause of "still seeing old version"

Browsers aggressively cache `.html`, `.js`, and `.css` files. After uploading new files to a server, visitors (including the site owner) may continue to see the old cached version for hours or days — even after a hard refresh in some CDN setups.

**The fix:** A new `.htaccess` file sets `Cache-Control: no-cache, no-store, must-revalidate` on all application files (`.html`, `.js`, `.css`, `.php`). This instructs the browser and any proxy to always revalidate before serving a cached copy — guaranteeing the latest code is always loaded.

#### domains.stats — no personal domains in repo

The `domains.stats` file shipped in the repo was rebuilt using the top-50 world domains. No personal or private domain names appear in any file distributed via the GitHub repo or ZIP.

#### .htaccess security additions

- `ase_config.json` (stores PIN hash) — blocked from direct browser access
- `domains.stats` (CSV snapshot) — blocked from direct browser access  
- `cron.log` (PHP cron output) — blocked from direct browser access

These files are only accessed by the PHP scripts internally — they should not be publicly readable.

### 🐛 Fixed

- `.htaccess` created with `no-cache` headers for `.html`, `.js`, `.css`, `.php`
- `domains.stats` rebuilt: top-50 world domains, no personal domains
- `ase_config.json`, `domains.stats`, `cron.log` protected from direct HTTP access

### ✨ Added

- `.htaccess` — new file; covers cache control, webhook routing, and file access protection

---

## 🔖 [2.2.0] — 2026-03-22

### 🌍 Top-50 World Domains · Fallback List Expanded

---

#### Built-in list: top-30 → top-50

The built-in fallback list (used when `domains.list` is absent or unreachable) has been expanded from 30 to **50 of the world's most-visited domains**, based on Similarweb / Cloudflare Radar 2025 rankings.

**20 new domains added (ranks 31–50):**

| Rank | Domain | Category |
|---|---|---|
| 31 | zoom.us | Communications |
| 32 | salesforce.com | SaaS/Product |
| 33 | paypal.com | Finance |
| 34 | ebay.com | Shopping |
| 35 | wordpress.com | Content/CMS |
| 36 | adobe.com | Product |
| 37 | dropbox.com | Cloud Storage |
| 38 | shopify.com | E-commerce |
| 39 | tesla.com | Product |
| 40 | airbnb.com | Travel |
| 41 | uber.com | Travel |
| 42 | twitter.com | Social |
| 43 | twilio.com | Dev/API |
| 44 | stripe.com | Finance |
| 45 | notion.so | Productivity |
| 46 | slack.com | Communications |
| 47 | atlassian.com | Dev/Tools |
| 48 | hubspot.com | SaaS/CRM |
| 49 | figma.com | Design/Dev |
| 50 | vercel.com | Dev/Cloud |

Each new domain has full TOOLTIP_DATA entries (NS, MX, DMARC, SPF details for hover tooltips).

#### domains.list updated

`domains.list` (the default watchlist shipped in the repo) now contains the same top-50 world domains — no personal or private domains. Users deploying for their own infrastructure should replace this file with their own domain list.

#### All "top-30" references updated to "top-50"

- `app.js` — BUILTIN comment, loadDomainList() log, SSL expiry comment
- `index.html` — How It Works modal, file header comment
- `README.md` — fallback description, quick start comment
- `CHANGELOG.md` — historical entries updated
- `INSTALL.md` — fallback description

### ✨ Added

- 20 new BUILTIN entries (ranks 31–50): zoom.us through vercel.com
- 20 new TOOLTIPS entries with NS/MX/DMARC/SPF detail for each new domain

### 🔄 Changed

- `app.js` — BUILTIN array: 30 → 50 entries
- `app.js` — TOOLTIPS object: 30 → 50 entries
- `domains.list` — replaced with top-50 world domains (no personal domains)
- All files — "top-30" → "top-50" text updated throughout

---

## 🔖 [2.1.1] — 2026-03-22

### 🐛 Hotfix — Correct GitHub Repository URLs

- **Issue:** Two links in `index.html` still used the `your-org` placeholder URL (`https://github.com/your-org/...`) left over from the open-source scaffold:
  - Footer `GitHub ↗` link (line ~350)
  - Help/info modal `⭐ View on GitHub` button (line ~441)
- **Fix:** Both replaced with `https://github.com/paulfxyz/mercury-sh`
- The More ⋮ dropdown GitHub link was already correct since v2.0.0.

### 🐛 Fixed

- `index.html` — footer GitHub link: `your-org/all-seeing-eye` → `paulfxyz/mercury-sh`
- `index.html` — help modal GitHub link: `your-org/mercury-sh` → `paulfxyz/mercury-sh`

---

## 🔖 [2.1.0] — 2026-03-22

### 🔐 Persistent Settings · Auto-scan on Login · PHP Config Layer

---

#### Problem: PIN Resets on Incognito / New Browser

The previous PIN persistence mechanism tried to rewrite `index.html` via an HTTP PUT request — effectively asking the web server to accept a direct file overwrite from the browser. This approach:
- Requires WebDAV (`mod_dav` on Apache, or `dav_methods` on Nginx) — rarely enabled on shared hosting
- Silently fails on virtually all SiteGround / cPanel setups
- Has no effect across browsers or devices even when it works

The result: every incognito session, new browser, or new device showed the default PIN (`123456`) — ignoring any custom PIN the user had set.

#### Solution: `config-write.php` + `ase_config.json`

A new PHP endpoint (`config-write.php`) provides a proper server-side persistence layer. It reads and writes a JSON file (`ase_config.json`) in the same directory.

**`ase_config.json` stores:**
- `pin_hash` — SHA-256 of the current PIN (overrides the hardcoded default in `index.html`)
- `theme` — user's preferred colour theme (`"light"` or `"dark"`)
- `custom_domains` — array of domains added via the Add Domain modal
- `updated_at` — ISO 8601 timestamp of last write

**Security measures in `config-write.php`:**
- PIN hash validated: must be exactly 64 lowercase hex chars (`[a-f0-9]{64}`)
- Theme validated: only `"light"` or `"dark"` accepted
- Domain names validated against RFC-1123 hostname pattern
- Max 200 custom domains
- Atomic writes via temp file + `rename()` (avoids corruption on concurrent requests)
- `LOCK_EX` file locking prevents race conditions
- `Cache-Control: no-store` on all responses

#### Three-tier PIN persistence (most to least authoritative)

1. **`ase_config.json` via `config-write.php`** — server-side, works across all browsers, incognito sessions, and devices. Loaded on every page load before the PIN overlay is shown.
2. **`ase_pin` cookie** — browser-local fallback, 1-year expiry. Applied instantly (no network request) before `config-write.php` responds. Kept in sync with the server config on every PIN change.
3. **Hardcoded `PIN_HASH` in `index.html`** — last resort default (`123456`). Only used if neither of the above are available (fresh install, static host without PHP).

#### `loadConfig()` — startup config fetch

On every page load, `loadConfig()` runs before the PIN overlay becomes interactive:
1. Reads `ase_pin` cookie → overrides `PIN_HASH` in memory immediately
2. Fetches `./config-write.php` (no-cache) → if `pin_hash` present, overrides again (authoritative)
3. Applies `theme` preference if stored (overrides the light default)
4. Silently skips if `config-write.php` returns 404 (static host, no PHP)

This means: when a user changes their PIN, the new hash is written to both `ase_config.json` and the `ase_pin` cookie. On any subsequent visit — any browser, any incognito session, any device on the same server — the correct PIN is loaded before the numpad is shown.

#### Auto-scan on Login

`initDashboard()` has always called `checkAll()` automatically. The root cause of the "empty table" perception was that `renderTable()` runs first (showing domain names with no data) — which is correct and intentional for progressive UX. 

Clarified in code with a comment: the skeleton renders immediately, then `checkAll()` populates it progressively batch by batch. No manual Refresh click is needed after login.

#### Theme persistence

Theme toggle changes now call `saveConfig({ theme: 'light'|'dark' })` — so the user's preferred theme is restored on next visit (loaded by `loadConfig()` during bootstrap).

### ✨ Added

- **`config-write.php`** — PHP config persistence endpoint (GET + POST)
- **`ase_config.json`** — server-side settings store (created on first PIN change)
- **`loadConfig()`** — async startup function; reads config + applies overrides before PIN
- **`saveConfig(partial)`** — posts partial config updates to `config-write.php`
- **`_readPinCookie()` / `_writePinCookie(hash)`** — cookie helpers for PIN hash fallback
- **`ase_pin` cookie** — browser-local PIN hash fallback (1-year, SameSite=Lax)
- **`_asmConfig`** — in-memory config object (merged from server + cookie at startup)

### 🔄 Changed

- `app.js` — `spPersistHash()`: replaced HTTP PUT with `_writePinCookie()` + `saveConfig()`
- `app.js` — theme IIFE: `saveConfig({ theme })` called on toggle change
- `app.js` — `spConfirm()`: success modal shown whether or not server save succeeded
- `app.js` — page bootstrap: replaced bare `if (!checkWebhookMode())` with an `async bootstrap()` IIFE that `await loadConfig()` before revealing the PIN gate
- `app.js` — `initDashboard()`: comment clarified — auto-scan on login was always the behaviour; skeleton → progressive fill is intentional
- `README.md` — new `What's in the box` row for `config-write.php` + `ase_config.json`
- `README.md` — `🔑 Default PIN` section updated with three-tier persistence explanation
- `README.md` — `🧠 How it works` section updated with config layer architecture
- `INSTALL.md` — new section: `ase_config.json` permissions, PHP requirements for config-write.php

---

## 🔖 [2.0.2] — 2026-03-22

### 🌟 Light Theme as Default

- **Change:** The dashboard now opens in **light mode** by default instead of dark mode.
- `index.html`: `<html data-theme="dark">` → `<html data-theme="light">`
- `app.js` theme IIFE: `setAttribute('data-theme', 'dark')` → `'light'`; `cb.checked = false` → `cb.checked = true` (checkbox checked = light mode).
- The toggle still works in both directions; this is purely a default-state change.

### 🔄 Changed

- `index.html` — `data-theme` attribute: `dark` → `light`
- `app.js` — theme IIFE: default theme set to `light`, checkbox initialised as `checked`
- `app.js` — comment updated: "Defaults to light (v2.0.2+)"

---

## 🔖 [2.0.1] — 2026-03-22

### 🐛 Hotfix — SPF Colour Logic · More Menu Clickability · Theme Toggle Position

---

#### SPF Badge Colour — Unified Green for All Valid Policies

- **The problem:** `-all` (hard fail, the strictest SPF policy) was displaying with a different CSS class (`spf-pass`, green) compared to `~all` (soft fail, `spf-soft`, yellow). This caused visual inconsistency — one domain would appear "different" from the others even though both have completely valid, deployed SPF records. The `-all` policy is actually *stricter* (and better) than `~all`, so marking it differently was misleading.
- **The fix:** Simplified the logic: any domain with a deployed SPF record (regardless of the policy qualifier) shows `spf-pass` (green). Only a completely missing SPF record shows `spf-missing` (red). The full SPF record text is still visible on hover via the existing tooltip.
- **Why `~all` is the de facto standard:** Most ESPs (Google, Microsoft, Proton) recommend `~all` because `-all` can cause false rejects in edge cases (forwarded mail, third-party senders). Both are valid; neither is broken.

#### More Menu — Fixed Stacking Context Bug

- **Root cause:** The sticky header uses `position: sticky; z-index: 100` — this creates its own stacking context. Any child element of the header (including the dropdown menu set to `z-index: 1000`) is evaluated *within that context*, not the root. Meanwhile, the backdrop `<div>` was appended to `<body>` with `z-index: 999` in the root stacking context — making it effectively sit on top of the entire header (which caps at 100 from root's perspective). Result: the backdrop intercepted all clicks, preventing dropdown items from being reached.
- **Fix A — position: fixed + getBoundingClientRect():** The dropdown menu now uses `position: fixed` (escaping the header's stacking context entirely) with `z-index: 9999`. `toggleHeaderMenu()` calls `getBoundingClientRect()` on the toggle button and positions the menu at the correct screen coordinates dynamically.
- **Fix B — document listener replaces backdrop div:** The backdrop `<div>` (and its CSS) are removed. Outside-click detection is now a single `document.addEventListener('click', ...)` that checks whether the click target is inside `.header-dropdown` — if not, `closeHeaderMenu()` is called. Cleaner, no DOM pollution, no z-index fights.

#### Theme Toggle — Moved Next to Logo

- **Change:** The theme toggle (`🌙 / ☀️` slider) is moved from the right end of the header (after the More button) to immediately right of the logo — before the action buttons.
- **Layout:** The toggle has `margin-right: auto` as a direct flex child of `<header>`, so the logo + toggle cluster naturally sits on the left while Add Domain / Refresh / More remain right-aligned.
- This matches the user's preferred position and reduces visual noise around the action buttons.

### 🐛 Fixed

- **SPF colour:** `~all` and `-all` both render `spf-pass` (green); removed `spf-soft` class from SPF logic
- **More menu:** dropdown items now fully clickable — fixed header stacking context via `position: fixed` + `getBoundingClientRect()`
- **More menu:** backdrop div removed; replaced with `document.addEventListener('click', ...)` outside-click handler
- **Theme toggle:** moved to right of logo (between logo and header-actions)

### 🔄 Changed

- `app.js` — `spfCls` logic: `d.spf === '~all' ? 'spf-soft' : (d.spf ? 'spf-pass' : ...)` → `d.spf ? 'spf-pass' : 'spf-missing'`
- `app.js` — `toggleHeaderMenu()`: now sets `menu.style.top` / `menu.style.right` via `getBoundingClientRect()`
- `app.js` — `closeHeaderMenu()`: backdrop references removed
- `app.js` — backdrop IIFE replaced with `document.addEventListener('click', ...)` outside-click handler
- `app.css` — `.header-dropdown-menu`: `position: absolute` → `position: fixed`; `z-index: 1000` → `z-index: 9999`
- `app.css` — backdrop CSS block removed; replaced with comment explaining the pattern
- `app.css` — `.theme-switch`: `margin-right: auto` added
- `index.html` — theme toggle label moved out of `header-actions` to direct child of `<header>`

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

- **The problem:** An IIFE added in v1.5.0 checked `PIN_HASH === DEFAULT_PIN_HASH` on page load and immediately replaced the login overlay with the set-PIN modal. This meant every incognito visit triggered the set-PIN onboarding — making the site appear broken on the live `demo.mercury.sh` because users were met with a setup flow instead of a login screen.
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

- **The problem:** Domains loaded from `domains.list` (custom user watchlists) get `sslExpiry: null` from `loadDomainList()` since they're not in the BUILTIN top-50. The `fetchSSLExpiry()` enrichment was gated on `!entry.sslExpiry`, which is correct — BUT `crt.sh` was timing out for many small/private domains. The user saw `—` in every SSL cell.
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

- **The problem:** `demo.mercury.sh` was running the old monolithic `index.html` without `app.css`/`app.js`. Uploading just `index.html` after the v1.3.0 split would break the site.
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
- **Only for custom domains:** Built-in top-50 entries have accurate seeded expiry dates from a real scan. The enrichment only fires for domains where `sslExpiry === null` (i.e. newly added custom domains).
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
  3. **NS-in-domain check** — if an NS hostname contains the monitored domain's apex as a substring, extract and capitalise the domain name as the label (e.g. `ns1.mercury.sh` would label as `Paulfleury`).
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
- **`domains.list`** loader — plain-text file, one domain per line, `#` comments, fallback to BUILTIN top-50
- **BUILTIN top-50** list — seeded with real scan data (NS, MX, DMARC, SSL expiry)
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

🗓️ Back to **[README.md](./README.md)** • 🐛 Report issues at **[GitHub Issues](https://github.com/paulfxyz/mercury-sh/issues)** • ⭐ Star if it helped!

</div>
