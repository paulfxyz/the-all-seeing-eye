# The All Seeing Eye — Installation Guide

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
| `config-write.php` | PHP config endpoint — reads/writes `ase_config.json` (PIN, theme, custom domains) |
| `ase_config.json` | Auto-created on first PIN change — persists settings across all browsers/devices |
| `webhook.do` | Headless endpoint for external cron services (cron-job.org etc.) |
| `INSTALL.md` | This file |

> **`index.html`, `app.css`, and `app.js` must all be in the same directory.**
> The HTML file loads the other two via relative paths (`./app.css`, `./app.js`).
> If your server can't serve them together, check that all three were uploaded
> and that directory listing / MIME types are configured correctly.
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
paulfleury.com
paulf.xyz
up.paulfleury.com

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
👁  The All Seeing Eye — update-stats.php v1.0
   Started: 2026-03-22T00:30:00Z
────────────────────────────────────────────────────────────
  [1/30] Checking paulfleury.com…
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
plain page that says "The All Seeing Eye — Webhook". If you get a 404,
check the .htaccess rule. If you get a blank page, the rule isn't active yet.

**3. Create a free account** at [cron-job.org](https://cron-job.org/en/)

**4. Add a new cron job:**

- Click **CREATE CRONJOB** in the dashboard
- **Title:** `The All Seeing Eye — paulfleury.com`
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

[Created with Perplexity Computer](https://www.perplexity.ai/computer)
