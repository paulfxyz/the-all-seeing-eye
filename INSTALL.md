# Mercury — Installation Guide

*Mercury, the Winged Messenger God — watching over your domains.*

A self-hosted, open-source uptime, DNS, SSL and latency monitor.
Runs entirely in the browser — no framework, no build step, no database.

---

## What's in the ZIP

| File | Purpose |
|---|---|
| `index.html` | The application — HTML shell that loads `app.css` and `app.js` |
| `app.css` | All styles (41 KB) — must be in the same directory as `index.html` |
| `app.js` | All JavaScript (82 KB) — must be in the same directory as `index.html` |
| `domains.list` | Your domain watchlist — one domain per line, `#` for comments |
| `domains.stats` | CSV snapshot updated after every check (auto-created if writable) |
| `domains.json` | Written by `update-stats.php` — feeds SSL expiry data to the browser |
| `update-stats.php` | Server-side cron script — real TLS cert checks, writes `domains.json` |
| `config-write.php` | PHP config endpoint — reads/writes `ase_config.json` (PIN, theme, notifications) |
| `uptime-write.php` | PHP uptime endpoint — reads/writes `uptime.json` (cross-device history) |
| `notify.php` | PHP email sender — Resend API with AES-256-GCM encrypted key storage |
| `ase_config.json` | Auto-created on first PIN change — persists settings across all browsers/devices |
| `.htaccess` | Apache config: no-cache headers + webhook routing + file protection |
| `webhook.do` | Headless endpoint for external cron services (cron-job.org etc.) |
| `INSTALL.md` | This file |

> **`index.html`, `app.css`, and `app.js` must all be in the same directory.**
> The HTML file loads the other two via relative paths (`./app.css`, `./app.js`).
> If your server can't serve them together, check that all three were uploaded
> and that directory listing / MIME types are configured correctly.
---

## Two-Domain Deployment (mercury.sh Official Setup)

This is the production setup for [mercury.sh](https://mercury.sh) and [demo.mercury.sh](https://demo.mercury.sh). Two separate FTP document roots under one SiteGround account.

### Domain layout

| Domain | Purpose | Files |
|---|---|---|
| `mercury.sh` | Marketing landing page | `index.html` (from `landing.html`) + `i18n.js` |
| `demo.mercury.sh` | Live app demo | Full stack: HTML + JS + CSS + PHP files |

### FTP structure

```
/ (FTP root)
├── mercury.sh/
│   └── public_html/
│       ├── index.html      ← landing page (landing.html renamed)
│       └── i18n.js         ← 11-language translation module
│
└── demo.mercury.sh/
    └── public_html/
        ├── index.html
        ├── app.js
        ├── app.css
        ├── config-write.php
        ├── uptime-write.php
        ├── notify.php
        ├── ssl-check.php
        ├── update-stats.php
        ├── domains.list
        ├── domains.stats
        ├── webhook.do
        └── .htaccess
```

### Notes

- The `landing.html` file in this repo is deployed **as** `index.html` on the `mercury.sh` root — it is the marketing homepage, not the app.
- The `index.html` in this repo (the app shell) goes to `demo.mercury.sh/public_html/` unchanged.
- `i18n.js` must be co-located with the landing page — it is loaded via a relative `<script src="./i18n.js">` in `landing.html`.
- `.htaccess` only applies to the demo subdomain — the landing page doesn't need it.
- No `chmod` needed on SiteGround — PHP scripts run as your user and can write files with default 644 permissions.

---

## Step 1 — Upload the files

Upload these files to a directory on your hosting. All three must be in the **same folder**:

```
index.html          ← the app
app.css             ← all styles
app.js              ← all JavaScript
domains.list        ← your domain watchlist
```

Optional but recommended for full SSL + stats + persistence functionality:

```
update-stats.php    ← PHP cron script (SSL expiry, DNS stats)
ssl-check.php       ← per-domain SSL check endpoint (live cert queries)
config-write.php    ← config persistence (PIN hash, theme, custom domains)
webhook.do          ← external cron endpoint
```

> **`config-write.php` requires write permission** on the directory to create
> `ase_config.json`. Standard cPanel/SiteGround setups allow this by default
> (files created by PHP run as your user). No `chmod 777` needed.

Example on SiteGround:

```
/public_html/uptime/index.html
/public_html/uptime/app.css
/public_html/uptime/app.js
/public_html/uptime/domains.list
```

Dashboard will be live at `https://yourdomain.com/uptime/`

Default file permissions (644) are fine for everything. No `chmod 666` needed.
---

## Step 2 — Configure your domain list

Edit `domains.list` — one bare domain per line, no `https://`:

```
# My sites
mercury.sh
paulf.xyz
demo.mercury.sh

# Benchmarks
github.com
notion.com
```

Lines starting with `#` are ignored. Add or remove domains anytime —
changes take effect on the next page load or cron run.

You can also add domains live via the **+ Add Domain** button in the dashboard.

---

## Step 3 — Set up automated checks (choose one option)

The dashboard auto-refreshes every 3 minutes when the tab is open.
For 24/7 monitoring when no browser is open, set up a cron job using
one of the two options below.

---

## Option A — SiteGround / cPanel cron (PHP script)

**Best for:** SiteGround, Bluehost, DreamHost, and any cPanel-based host.
Runs server-side — no external service needed. `update-stats.php` writes
`domains.stats` as your user, so no special file permissions are required.

### Setup

1. Log in to **cPanel** → scroll to **Advanced** → click **Cron Jobs**

2. Set the schedule to **Every 10 Minutes** (`*/10 * * * *`)

3. In the **Command** field, enter:

```bash
php /home/YOURUSER/public_html/uptime/update-stats.php >> /home/YOURUSER/public_html/uptime/cron.log 2>&1
```

> Replace `YOURUSER` with your actual cPanel username (shown top-right in cPanel).
> Adjust the path if you uploaded to a different folder.

4. Click **Add New Cron Job**. Done.

### Verify it's working

After 10 minutes, open **File Manager** and check `cron.log`:

```
👁  Mercury — update-stats.php v1.0
   Started: 2026-03-22T00:30:00Z
────────────────────────────────────────────────────────────
  [1/30] Checking mercury.sh…
         → UP | 28ms | NS=SiteGround | MX=ProtonMail | DMARC=quarantine | SPF=~all
  ...
✓  Checked 30 domains: 30 UP, 0 DOWN, 0 alerts
✓  domains.stats written (30 rows, 4521 bytes)
✓  Done in 3.42s
```

If `cron.log` is empty after 10 minutes, double-check the path in the command.
Run it manually to test: cPanel → Terminal → paste the command without `>> …`.

### What the PHP script does

For every domain it queries: A (uptime + latency), NS (nameserver provider),
MX (mail provider), TXT (SPF), and `_dmarc TXT` (DMARC policy) — all using
PHP's built-in `dns_get_record()`. No curl, no Composer, no external libraries.

### Recommended .htaccess additions

```apache
RewriteEngine On

# Route /webhook.do to index.html
RewriteRule ^webhook\.do$ index.html [L]

# Block direct browser access to the PHP script and log file
<Files "update-stats.php">
    Require all denied
</Files>
<Files "cron.log">
    Require all denied
</Files>
```

---

## Option B — cron-job.org (free external cron, no server config)

**Best for:** Any setup where you want to avoid cPanel Cron Jobs — including
SiteGround users who prefer an external service, static hosts (Netlify,
GitHub Pages, Vercel), or as a backup to Option A.

**How it works:**
1. cron-job.org sends an HTTP GET to `https://up.yourdomain.com/webhook.do`
2. Your server receives the request and serves `webhook.do`
3. That page loads `index.html` in a hidden iframe, tagged with `#webhook`
4. `index.html` detects the `#webhook` hash, skips the PIN, runs all DNS checks

> **Note on `domains.stats`:** On SiteGround the file won't auto-update
> via this method (HTTP PUT is blocked). Use the **Export CSV** button to
> download snapshots manually. Everything else works fully.

---

### ⚠️ Required: .htaccess rule for webhook.do

**This step is mandatory.** Without it, your server will try to execute
`webhook.do` as a file and either return a 404 (if the file isn't found
at that path) or serve it with the wrong MIME type.

You need a rewrite rule so your server maps the `.do` URL to the HTML file.

Add this to your `.htaccess` file in the same directory as `index.html`:

```apache
RewriteEngine On

# ─── REQUIRED for cron-job.org / Option B ───────────────────
# Route requests for /webhook.do to the webhook.do HTML file.
# Without this, the server returns 404 and cron-job.org
# will report all pings as failed.
RewriteRule ^webhook\.do$ webhook.do [L,T=text/html]

# ─── Block direct browser access to server-side files ────────
<Files "update-stats.php">
    Require all denied
</Files>
<Files "cron.log">
    Require all denied
</Files>
```

> **How to add this on SiteGround:**
> 1. Open **File Manager** in cPanel
> 2. Navigate to your uptime directory
> 3. If `.htaccess` already exists, click **Edit** — if not, click **New File**
>    and name it `.htaccess`
> 4. Paste the rules above (or append them after any existing rules)
> 5. Save — no server restart needed, Apache picks it up instantly
>
> **Tip:** The `.htaccess` file starts with a dot and may be hidden in File
> Manager. Enable "Show Hidden Files" in the settings if you can't see it.

---

### Setup

**1. Add the .htaccess rule above** (required — do this first).

**2. Test that `webhook.do` is accessible** — open
`https://up.yourdomain.com/webhook.do` in your browser. You should see a
plain page that says "Mercury — Webhook". If you get a 404,
check the .htaccess rule. If you get a blank page, the rule isn't active yet.

**3. Create a free account** at [cron-job.org](https://cron-job.org/en/)

**4. Add a new cron job:**

- Click **CREATE CRONJOB** in the dashboard
- **Title:** `Mercury — mercury.sh`
- **URL:** `https://up.yourdomain.com/webhook.do`
  *(replace with your actual URL)*
- **Schedule:** Every 10 minutes → `*/10 * * * *`
- **Request method:** GET
- **Expected HTTP status:** 200
- Click **CREATE**

**5. Verify it's working** — after 10 minutes, click the job → **History** tab.
You should see entries with HTTP status `200`.

| Status | Meaning |
|---|---|
| `200` | ✓ Working correctly |
| `404` | webhook.do not found — check .htaccess |
| `403` | Server blocking the request — check file permissions |
| `500` | Server error — check the .htaccess syntax |

### Enable failure notifications

In the cron job → **Notifications** tab, enable email alerts if the
request fails. You'll get an email if your site goes down or the webhook
stops responding — giving you monitoring on top of your monitor.

---

## Step 4 — Open the dashboard

Visit `https://yourdomain.com/uptime/` in your browser.

Enter the PIN — default is **`123456`**. Change it before going live (see below).

---

## Changing the PIN

The default PIN is `123456`. **Change it before deploying publicly.**

### Recommended: change via the dashboard (v2.1.0+)

1. Log in with the current PIN
2. Click **More ⋮** → **Change PIN**
3. Enter your current PIN, then your new PIN twice

The new hash is saved to `ase_config.json` via `config-write.php` **and** written to the `ase_pin` browser cookie. This means:
- Any browser, any incognito session, any device on the same server will use the new PIN
- No file editing, no re-upload needed

> ⚠️ `config-write.php` must be uploaded and the directory must be writable for server-side persistence. If `config-write.php` is not available (static host), the new PIN is saved in the browser cookie only — it will work on the current browser but reset on new devices/browsers.

### Manual method (static hosts / pre-deployment)

If you want to set the PIN before first deployment:

**1. Compute the SHA-256 hash** — paste into your browser console (F12):

```javascript
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourNewPIN'));
console.log([...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join(''));
```

Or use [this online tool](https://emn178.github.io/online-tools/sha256.html).

**2. Open `index.html`** in a text editor. Find this line:

```javascript
var PIN_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';
```

**3. Replace the hash** with your new one. Save. Re-upload `index.html`.

### How PIN persistence works (three-tier)

| Tier | Where | Scope | Survives incognito? |
|---|---|---|---|
| 1 | `ase_config.json` (server) | All browsers + devices | ✅ Yes |
| 2 | `ase_pin` cookie (browser) | Current browser only | ❌ No |
| 3 | `PIN_HASH` in `index.html` | Deployment default | ✅ Yes (but manual) |

On every page load, `loadConfig()` fetches `ase_config.json` before showing the PIN prompt — so the correct PIN is always in memory.

### ase_config.json — file permissions

`ase_config.json` is written by `config-write.php` (PHP running as your cPanel user).
Default SiteGround/cPanel directory permissions (755) allow this.

If you see `"Failed to write config file"` in the browser console:
```bash
chmod 755 /home/YOURUSER/public_html/uptime/
# Or if the directory is 644:
chmod 755 /home/YOURUSER/public_html/uptime/
```

The file itself (`ase_config.json`) will be created with 644 permissions automatically.

---


## 🔔 Setting Up Email Notifications

Email alerts are sent via [Resend](https://resend.com) — a developer-friendly email API with a **free tier** (100 emails/day, no credit card required). Each alert is a full health digest, not just "domain is down".

### What each alert email contains

Every notification includes:
- **Status** — DOWN (red) or RECOVERED (green) with timestamp
- **Latency** — round-trip DNS response time at the moment of detection
- **SSL Expiry** — certificate expiry date + days remaining, colour-coded
- **DMARC** — email authentication policy (`reject` / `quarantine` / `none` / `missing`)
- **SPF** — SPF record presence and policy
- **Nameserver** — DNS provider (Cloudflare, AWS, SiteGround…)
- **Mail Provider** — detected mail service (Google, ProtonMail, Microsoft…)

**Auto-detected health warnings** appear as coloured alert boxes in the email:

| Condition | Severity |
|---|---|
| SSL expired | 🚨 Critical |
| SSL expiring within 7 days | 🚨 Critical |
| SSL expiring within 30 days | ⚠️ Warning |
| DMARC record missing | ⚠️ Warning |
| DMARC `p=none` (not enforced) | ⚠️ Warning |
| SPF record missing | ⚠️ Warning |

---

### Step 1 — Get a Resend account

1. Sign up free at [resend.com](https://resend.com) — no credit card required
2. Add and verify your sending domain under **Domains** (e.g. `alerts.yourdomain.com`)
   - Alternatively, use Resend's shared sandbox `onboarding@resend.dev` for testing only
3. Go to **API Keys** → **Create API Key** → copy the key (starts with `re_`)

> **Why Resend?** It has a generous free tier (100 emails/day, 3,000/month), excellent deliverability, and a clean API. The free tier is more than enough for personal infrastructure monitoring.

---

### Step 2 — Configure in the dashboard

1. Open your dashboard → click **More ⋮** → **Notifications**
2. Enable the **Email alerts** toggle
3. Paste your **Resend API key** in the field (it will be encrypted before saving)
4. Enter your **From email** — must match your verified Resend domain
5. Enter the **To email** — where alerts will be delivered
6. Click **Save**
7. Click **Send Test** — check your inbox to verify everything works

---

### How API key security works

> **Design principle:** The API key should never be readable by anyone who gains access to `ase_config.json` — even if they have server file access.

The key is encrypted server-side before being stored:

```
Browser          config-write.php          File system
───────          ────────────────          ───────────
key (plaintext)  ───HTTPS POST───▶  encrypt(key, secret)
                                    ──write──▶  ase_config.json (ciphertext only)
                                    ──write──▶  notify_secret.key (secret, chmod 0600)
```

When sending an alert:
```
notify.php  ──read──▶  notify_secret.key
notify.php  ──read──▶  ase_config.json (ciphertext)
notify.php  ──decrypt(ciphertext, secret)──▶  plaintext key (in memory only)
notify.php  ──POST──▶  api.resend.com
```

The encryption is **AES-256-GCM** (authenticated encryption — tamper-proof, not just encrypted). A new random 12-byte IV is generated for every encryption. The authentication tag prevents bit-flipping attacks.

| File | Contents | Protected? |
|---|---|---|
| `ase_config.json` | Encrypted API key + all settings | ❌→✅ Blocked by `.htaccess` |
| `notify_secret.key` | AES decryption secret (256-bit) | ❌→✅ Blocked + `chmod 0600` |
| `notify_rate.json` | Rate limit timestamps | ❌→✅ Blocked by `.htaccess` |

> **Important:** `notify_secret.key` is auto-generated on first use and never leaves your server. If you delete it, the encrypted API key becomes unreadable — you'll need to re-enter the key in the dashboard.

---

### Rate limiting

`notify.php` enforces **10 emails per hour** using a sliding window tracked in `notify_rate.json`. This prevents alert storms if multiple domains flap simultaneously.

```
Hour 1:  domain-a DOWN  → ✅ email sent (1/10)
Hour 1:  domain-b DOWN  → ✅ email sent (2/10)
...
Hour 1:  domain-j DOWN  → ✅ email sent (10/10)
Hour 1:  domain-k DOWN  → ❌ rate limit reached — silently dropped
Hour 2:  domain-a DOWN  → ✅ email sent (1/10) — window reset
```

---

### When alerts fire

| Event | Alert sent? | Note |
|---|---|---|
| Domain goes DOWN (A record fails) | ✅ Yes | Only on first DOWN, not repeated failures |
| Domain recovers (UP again) | ✅ Yes | Recovery email clearly marked green |
| Manual refresh detects new downtime | ✅ Yes | Any `checkAll()` cycle triggers detection |
| Cron (`update-stats.php`) detects downtime | ✅ Yes (v3.3.0+) | Cron runs Step 6 after every check; deduplication prevents repeated alerts |
| Cron detects SSL expiring ≤30 days | ✅ Yes (v3.3.0+) | 24h cooldown — one alert per day max |
| Cron detects DMARC missing | ✅ Yes (v3.3.0+) | 24h cooldown |
| Browser `checkAll()` finds SSL/DMARC/SPF issue | ✅ Yes (v3.3.0+) | `sendHealthReport()` fires after every scan |
| Same domain still DOWN on next check | ❌ No | Only state transitions trigger alerts |
| Test button clicked | ✅ Always | Ignores rate limit; sends demo email |

---

### Troubleshooting notifications

| Symptom | Likely cause | Fix |
|---|---|---|
| Test email never arrives | Wrong API key or unverified From domain | Check Resend dashboard for errors |
| "Failed to decrypt API key" | `notify_secret.key` deleted or corrupted | Re-enter API key in Notifications modal |
| "Notifications disabled" | Toggle off | Enable toggle and Save |
| Alerts stop after a while | Rate limit hit | Normal — resets after 1 hour |
| Emails go to spam | From domain not verified in Resend | Verify domain DNS in Resend dashboard |

---

## 📊 Cross-Device Uptime History

Uptime data is stored in `uptime.json` on the server via `uptime-write.php`. This means:
- Every device, browser, and scheduled cron contributes to the same history
- Data survives clearing browser cookies or switching devices
- The STATUS column hover tooltip shows cumulative history across all sources

**Fallback:** If `uptime-write.php` is unavailable (static host), the browser cookie fallback is used automatically — same behaviour as v3.0.0 and earlier.

---

## How DNS Checks Work

Every domain check fires 5 parallel DNS-over-HTTPS queries to
[Cloudflare DoH](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/):

| Query | What it tells us |
|---|---|
| `A` | Is the domain resolving? Latency? |
| `NS` | Nameserver provider (Cloudflare, AWS, SiteGround…) |
| `MX` | Mail provider (Google, ProtonMail, Microsoft…) |
| `TXT` | SPF policy |
| `_dmarc TXT` | DMARC policy (reject / quarantine / none / missing) |

**Rate limiting:** 10-second minimum gap between full refreshes.
5-second minimum per domain for the per-row ↺ refresh.
Checks run in batches of 5 with 300ms pauses — well within Cloudflare's limits.

---

## Feature Overview

| Feature | How to use |
|---|---|
| **Live DNS check** | Runs on page load and every 3 minutes automatically |
| **Manual refresh** | Click **Refresh** button in the header |
| **Per-row refresh** | Click the **↺** icon at the end of any row |
| **Add domain** | Click **+ Add Domain** — domain is checked immediately |
| **Search** | Type in the search box to filter by domain or category |
| **Sort** | Use the sort dropdown: rank, SSL expiry, latency, status, A→Z |
| **Filter** | "Alerts only" (SSL expiring) or "Online only" |
| **Export CSV** | Downloads a timestamped CSV of all current data |
| **Light/dark mode** | Toggle switch in the header |
| **Webhook info** | Click **Webhook** button for cron setup instructions |
| **Help** | Click **?** button for a full feature explanation |

---

## File Permissions Cheat Sheet

```bash
# Works on SiteGround without any chmod changes needed
644  index.html           readable
644  domains.list         readable (edit to add/remove domains)
644  domains.stats        PHP cron writes this as your user — 644 is enough
644  domains.json         PHP cron writes this as your user — 644 is enough
644  update-stats.php     PHP executes this as your user
644  webhook.do           readable
```

---

## Option Comparison

| | Option A (cPanel cron) | Option B (cron-job.org) |
|---|---|---|
| **Works on SiteGround** | ✓ | ✓ |
| **External service needed** | No | Yes (free) |
| **Server config required** | cPanel Cron Jobs UI | None |
| **Writes domains.stats** | ✓ Always | ✗ Not on SiteGround |
| **Full DNS data** | ✓ (PHP dns_get_record) | ✓ (browser DoH) |
| **Works on static hosts** | ✗ Needs PHP | ✓ |
| **Setup difficulty** | 5 min | 3 min |

**Recommendation:** On SiteGround → use **Option A**. On static hosts (Netlify, GitHub Pages) → use **Option B**.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| PIN doesn't work | Default is `123456`. Use keyboard or click the numpad. |
| Cron log is empty | Verify the full path to `update-stats.php` in cPanel Cron Jobs. |
| cron-job.org shows 404 | Check that `webhook.do` was uploaded and is at the correct URL. |
| `domains.stats` not updating | On SiteGround with Option B, use Export CSV instead. With Option A, check `cron.log`. |
| DMARC/NS shows `—` | Click ↺ on that row — it triggers a full DNS scan for that domain. |
| Refresh button shows "Wait…" | 10-second rate limit. Wait a moment and try again. |
| All domains DOWN | Possible DNS resolver issue. Try the per-row ↺ for one domain. |
| Script times out (Option A) | Normal for 30+ domains on slow servers. Increase PHP `max_execution_time`. |

---

## Security Checklist

- [ ] Change the default PIN (`123456`)
- [ ] Add `.htaccess` rules to block direct access to `update-stats.php` and `cron.log`
- [ ] Consider HTTP Basic Auth on the whole directory for real privacy
- [ ] Review `domains.list` before making the URL public

---

## Licence

MIT — free to use, modify, and share.

Made with ❤️ + AI
