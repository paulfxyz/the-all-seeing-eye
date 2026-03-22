# 👁️ The All Seeing Eye

<div align="center">

![HTML](https://img.shields.io/badge/HTML-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![PHP](https://img.shields.io/badge/PHP-777BB4?style=for-the-badge&logo=php&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.3.0-brightgreen?style=for-the-badge)
![Self-hosted](https://img.shields.io/badge/self--hosted-no_server_needed-blue?style=for-the-badge)

**Open-source uptime, DNS, SSL and latency monitor. One HTML file. Zero dependencies.**

Know what's up — and what isn't — across all your domains, at a glance. 🌐

<a href="https://paulfleury.com/github/the-all-seeing-eye.png">
  <img src="https://paulfleury.com/github/the-all-seeing-eye.png" alt="The All Seeing Eye — domain monitor dashboard" width="700" />
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

> 💡 If you manage multiple domains and want a beautiful, self-hosted status page — this is for you. Free, open-source, one HTML file.

---

## 🌟 What is this?

A **self-hosted infrastructure dashboard** that monitors uptime, DNS records, SSL certificates and mail security for any list of domains — entirely in the browser, with no backend required.

- 🔍 **Live DNS checks** via Cloudflare DoH (HTTPS, no CORS issues)
- 🔐 **PIN-protected** dashboard (SHA-256 hashed — no plaintext stored)
- 🌓 **Dark / Light mode** toggle
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
# Built-in top-30 list is used as fallback.
```
---

## 🔑 Default PIN

The default PIN is **`123456`**.

**Change it before deploying publicly** — see [INSTALL.md](./INSTALL.md#changing-the-pin).

The PIN is stored as a SHA-256 hash in `index.html` — no plaintext, ever.

---

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

### DNS-over-HTTPS (DoH)

Instead of raw DNS sockets (blocked in browsers), the app queries [Cloudflare's DoH API](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/) over HTTPS — no CORS issues, no browser permissions, works everywhere. Each domain gets 5 parallel queries: `A`, `NS`, `MX`, `TXT`, and `_dmarc.TXT`.

### The SHA-256 caching bug (and fix)

The original SHA-256 implementation cached its prime tables on `sha256.h` and `sha256.k` as properties of the function object. This works the first time but corrupts on subsequent calls — producing wrong hashes. The fix: a fully **stateless implementation** that recomputes primes fresh every call. No mutation, no side effects.

### Why `onclick` instead of `addEventListener`

The PIN numpad uses `onclick="pinDigit('1')"` directly in the HTML rather than `addEventListener`. The reason: when deployed in a sandboxed iframe (as in Perplexity Computer's preview), `DOMContentLoaded` fires before the script runs — meaning listeners attached in that callback silently never execute. Inline `onclick` attributes bypass this entirely — one click, one call, always.

### Progressive batch scanning

Instead of firing 30+ parallel DNS queries at once (which would look like a DoH flood and could trip firewalls), checks run in **batches of 5** with a 300ms pause between batches. After each batch, the table re-renders — you see rows come alive progressively. Total time for 30 domains: ~3–4 seconds.

### Rate limiting

Two guards prevent accidental spam:
- **Global:** `_checkRunning` flag blocks overlapping full scans; `CHECK_ALL_MIN_GAP` (10s) blocks re-runs too soon after the last one
- **Per-row:** `_domainLastCheck[domain]` tracks the last per-row refresh timestamp; `CHECK_ROW_MIN_GAP` (5s) prevents hammering a single domain

### The `domains.list` / fallback pattern

On startup, the app tries `fetch('./domains.list')`. If the file exists and is non-empty, it loads those domains. If not (static host, local file, 404), it silently falls back to the built-in top-30 list. Custom domains added via the UI get a `fullScan=true` flag, triggering NS/MX/TXT/DMARC lookups even on first check.

---

## 📝 Changelog

> Full changelog: **[CHANGELOG.md](./CHANGELOG.md)**

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
