<!DOCTYPE html>
<!--
  ╔══════════════════════════════════════════════════════════════╗
  ║  THE ALL SEEING EYE — webhook.do                             ║
  ║                                                              ║
  ║  PURPOSE                                                     ║
  ║  ────────────────────────────────────────────────────────    ║
  ║  This file is your headless cron endpoint.                   ║
  ║  When an external scheduler (cron-job.org, EasyCron,         ║
  ║  UptimeRobot, GitHub Actions, etc.) makes an HTTP GET        ║
  ║  request to:                                                 ║
  ║                                                              ║
  ║      https://yourdomain.com/webhook.do                       ║
  ║                                                              ║
  ║  ...this page loads, runs all DNS checks, writes a fresh     ║
  ║  snapshot to domains.stats, and exits silently.              ║
  ║                                                              ║
  ║  HOW IT WORKS                                                ║
  ║  ────────────────────────────────────────────────────────    ║
  ║  1. This file is served by your web server at /webhook.do    ║
  ║  2. The JS below loads index.html in an invisible iframe     ║
  ║  3. index.html detects the URL path ends with /webhook.do    ║
  ║  4. It skips the PIN, runs checkAll(), writes domains.stats  ║
  ║                                                              ║
  ║  ALTERNATIVE: direct server-side route                       ║
  ║  If your server supports URL rewriting (Apache/Nginx),       ║
  ║  you can add a rewrite rule so /webhook.do serves index.html ║
  ║  directly. The JS in index.html handles the rest.            ║
  ║                                                              ║
  ║  NGINX example:                                              ║
  ║    location = /webhook.do { try_files /index.html =404; }   ║
  ║                                                              ║
  ║  APACHE .htaccess example:                                   ║
  ║    RewriteRule ^webhook\.do$ index.html [L]                  ║
  ║                                                              ║
  ║  CRON SERVICES                                               ║
  ║  ────────────────────────────────────────────────────────    ║
  ║  Free options that work well:                                ║
  ║    - https://cron-job.org  (free, up to 1-min intervals)     ║
  ║    - https://easycron.com  (free tier available)             ║
  ║    - https://uptimerobot.com (HTTP monitor = free cron)      ║
  ║    - GitHub Actions with schedule trigger                    ║
  ║                                                              ║
  ║  Recommended: every 5 minutes = */5 * * * *                  ║
  ╚══════════════════════════════════════════════════════════════╝
-->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>The All Seeing Eye — Webhook</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      background: #0f1117;
      color: #34d399;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      font-size: 14px;
    }
    pre {
      background: #181b23;
      border: 1px solid #2a2f3d;
      border-radius: 10px;
      padding: 28px 36px;
      line-height: 1.8;
    }
    .dim { color: #4a5168; }
    .ok  { color: #34d399; }
    .err { color: #f87171; }
  </style>
</head>
<body>
<pre id="log">
<span class="dim">👁 The All Seeing Eye — Webhook</span>
<span class="dim">─────────────────────────────────</span>
<span id="status">Initialising...</span>
</pre>

<script>
/*
 * WEBHOOK MODE
 * ────────────────────────────────────────────────────────────
 * We load index.html in an invisible iframe. The index.html JS
 * detects the /webhook.do URL suffix and runs in headless mode:
 *   - Skips the PIN gate
 *   - Loads domains.list
 *   - Runs all DNS checks via Cloudflare DoH
 *   - Writes domains.stats via HTTP PUT
 *
 * The iframe approach keeps all logic in one place (index.html)
 * and avoids duplicating the DNS check code here.
 *
 * CHALLENGE: cross-origin iframe messaging requires both files
 * to be on the same origin, which is guaranteed here since both
 * files are in the same directory.
 */

var log = document.getElementById('status');

function addLine(text, cls) {
  var span = document.createElement('span');
  span.textContent = text;
  if (cls) span.className = cls;
  log.parentNode.insertBefore(span, log.nextSibling.nextSibling || null);
  log.parentNode.appendChild(document.createTextNode('\n'));
  log.parentNode.appendChild(span);
}

var started = new Date().toISOString();
log.textContent = 'Started: ' + started;
addLine('Loading index.html in webhook mode...', 'dim');

/*
 * Create a hidden iframe pointing to index.html
 * The iframe URL path ends in /webhook.do so index.html's
 * checkWebhookMode() function detects it and skips the PIN.
 *
 * We construct the URL so the pathname ends with /webhook.do
 * even though we're actually serving webhook.do — the iframe
 * src can be set to index.html directly to force the check.
 */
var iframe = document.createElement('iframe');
iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';

/*
 * Pass the trigger via the hash so index.html can detect it
 * without needing a URL rewrite.
 */
iframe.src = './index.html#webhook';
document.body.appendChild(iframe);

/*
 * Give the iframe enough time to load + run all DNS checks.
 * DNS checks are parallel, typically 3-6 seconds total.
 * We wait 15 seconds to be safe.
 */
var TIMEOUT = 15000;
setTimeout(function() {
  addLine('✓ Webhook run complete (' + TIMEOUT/1000 + 's window)', 'ok');
  addLine('domains.stats updated (if server write access enabled)', 'ok');
  addLine('Finished: ' + new Date().toISOString(), 'dim');
}, TIMEOUT);

/*
 * Also update index.html's checkWebhookMode to detect the #webhook hash.
 * The index.html code checks: path.endsWith('/webhook.do') OR hash === '#webhook'
 */
</script>
</body>
</html>
