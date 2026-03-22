# The All Seeing Eye — Installation Guide

A self-hosted, open-source uptime, DNS, SSL and latency monitor.
Runs entirely in the browser — no framework, no build step, no database.

---

## What's in the ZIP

| File | Purpose |
|---|---|
| `index.html` | The full application — one self-contained HTML file |
| `domains.list` | Your domain watchlist — one domain per line |
| `domains.stats` | CSV snapshot of the last check (updated by cron or browser export) |
| `domains.json` | JSON snapshot written by `update-stats.php` (optional) |
| `update-stats.php` | Server-side cron script — checks DNS + writes stats (no chmod needed) |
| `webhook.do` | Browser-based headless endpoint — used by cron-job.org and similar |
| `INSTALL.md` | This file |

---

## Step 1 — Upload the files

Upload all files to a directory on your hosting. For example:

```
/public_html/uptime/
```

So your dashboard is at `https://yourdomain.com/uptime/`

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

**Best for:** Any static host (Netlify, GitHub Pages, Vercel), or if you
prefer not to use cPanel cron. [cron-job.org](https://cron-job.org) is a
free service that makes HTTP GET requests on a schedule — it acts as the
"timer" that pings your `webhook.do` file.

**How it works:**
1. cron-job.org sends an HTTP GET to `https://up.yourdomain.com/webhook.do`
2. Your server responds with the `webhook.do` HTML page
3. That page loads `index.html` in a hidden iframe, tagged with `#webhook`
4. `index.html` detects the tag, skips the PIN, runs all DNS checks
5. Results are displayed — and if your server supports HTTP PUT, `domains.stats` is written

> **Note on `domains.stats`:** On SiteGround with this option, the file
> won't auto-update (HTTP PUT is blocked). Use the **Export CSV** button in
> the dashboard to download snapshots manually. Everything else works fully.

### Setup

**1. Create a free account** at [cron-job.org](https://cron-job.org/en/)

**2. Add a new cron job:**

- Click **CREATE CRONJOB** in the dashboard
- **Title:** `The All Seeing Eye — uptime check`
- **URL:** `https://up.yourdomain.com/webhook.do`
  *(replace with your actual URL)*
- **Schedule:** Every 10 minutes
  - Select **Every N minutes** → set to **10**
  - Or use custom cron expression: `*/10 * * * *`
- **Request method:** GET
- Leave everything else as default
- Click **CREATE**

**3. That's it.** cron-job.org will start pinging your URL every 10 minutes.

### Verify it's working

In the cron-job.org dashboard, click on your job → **History** tab.
You should see entries with HTTP status `200` and a response time.

If you see a `404`, check that `webhook.do` was uploaded correctly.
If you see a `403`, check that your server isn't blocking external requests.

### cron-job.org tip — Notifications

In the cron job settings → **Notifications** tab, you can enable email
alerts if the request fails. This gives you an extra layer of monitoring
on top of the dashboard itself.

---

## Step 4 — Open the dashboard

Visit `https://yourdomain.com/uptime/` in your browser.

Enter the PIN — default is **`123456`**. Change it before going live (see below).

---

## Changing the PIN

The default PIN is `123456`. **Change it before deploying publicly.**

**1. Compute the SHA-256 hash of your new PIN** — paste into your browser console (F12):

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
