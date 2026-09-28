// The bare page of step 0c, check 7, its service worker and its manifest.
// The owner adds the page to the iPhone's home screen, opens it from there,
// and allows notifications; the page subscribes to push and gives the
// subscription to the server. Then the app is closed and
// scripts/check-7-push.ts sends a push. The service worker shows it and sends
// a line to the check 3 log, with how many windows of the app were open.
// iOS delivers Web Push only to a home-screen app, 16.4 and later (lessons,
// "iOS and PWA"). See check7.ts.

/** The page. The public key of the push sender is written into it: the browser needs it to subscribe. */
export function check7Page(pushKey: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Check 7">
<link rel="manifest" href="/check/7/manifest.webmanifest">
<title>Check 7</title>
<style>
  :root { color-scheme: light dark; font: 16px/1.4 system-ui, sans-serif; }
  html, body { overscroll-behavior: none; }
  body { margin: 0 auto; padding: 16px; max-width: 40rem; }
  button, input { font: inherit; padding: 8px 12px; }
  td { padding: 2px 12px 2px 0; }
  pre { white-space: pre-wrap; font-size: 0.8rem; background: #8881; padding: 8px; max-height: 40vh; overflow: auto; }
</style>
</head>
<body>
<h1>Check 7</h1>
<p>In Safari: Share, then Add to Home Screen. Open Check 7 from the home screen, press Allow notifications, then close the app.</p>
<table>
  <tr><td>Opened from the home screen</td><td id="standalone"></td></tr>
  <tr><td>Push in this browser</td><td id="push"></td></tr>
  <tr><td>Notifications</td><td id="permission"></td></tr>
  <tr><td>Subscribed</td><td id="subscribed"></td></tr>
</table>
<p><label>Name <input id="device" maxlength="32" size="10" value="iPhone"></label>
<button id="allow">Allow notifications</button></p>
<pre id="log"></pre>
<p><a href="/check/3/log" target="_blank">The log of every device</a></p>
<script type="module">
const KEY = '${pushKey}';
const $ = (id) => document.getElementById(id);
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const stamp = () => {
  const parts = Object.fromEntries(clock.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return parts.hour + ':' + parts.minute + ':' + parts.second + ' ' + parts.timeZoneName;
};
const session = Math.random().toString(36).slice(2, 8);
const log = (text) => {
  const line = stamp() + ' ' + text;
  $('log').textContent += line + '\\n';
  fetch('/check/3/log', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, device: $('device').value.trim() + ' check 7', network: 'page', lines: [line] }) }).catch(() => {});
};
const bytes = (base64url) => {
  const text = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
};

const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const hasPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
$('standalone').textContent = standalone ? 'yes' : 'no';
$('push').textContent = hasPush ? 'yes' : 'no';
$('permission').textContent = 'Notification' in window ? Notification.permission : 'none';
log('page loaded; home screen: ' + standalone + ', push: ' + hasPush + ', notifications: ' + $('permission').textContent);

let registration;
if ('serviceWorker' in navigator) {
  registration = await navigator.serviceWorker.register('/check/7/sw.js', { scope: '/check/7/' });
  await navigator.serviceWorker.ready;
  const existing = hasPush ? await registration.pushManager.getSubscription() : null;
  $('subscribed').textContent = existing ? 'yes' : 'no';
}

$('allow').onclick = async () => {
  try {
    const permission = await Notification.requestPermission();
    $('permission').textContent = permission;
    log('notifications: ' + permission);
    if (permission !== 'granted') return;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(KEY) });
    const answer = await fetch('/check/7/subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: $('device').value.trim(), subscription: subscription.toJSON() }) });
    $('subscribed').textContent = answer.ok ? 'yes' : 'no (' + answer.status + ')';
    log('subscribed; the server answered ' + answer.status + '; push service ' + new URL(subscription.endpoint).host);
  } catch (error) {
    log('error: ' + error);
  }
};
</script>
</body>
</html>
`;
}

/**
 * The service worker. iOS requires each push to show a notification. The line
 * it sends says whether a window of the app was open when the push came: the
 * check asks what the phone does when the app is closed.
 */
export const CHECK7_WORKER = `const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const stamp = () => {
  const parts = Object.fromEntries(clock.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return parts.hour + ':' + parts.minute + ':' + parts.second + ' ' + parts.timeZoneName;
};
const log = (text) => fetch('/check/3/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: 'worker', device: 'check 7 worker', network: 'worker', lines: [stamp() + ' ' + text] }) }).catch(() => {});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const seen = windows.filter((w) => w.visibilityState === 'visible').length;
    await self.registration.showNotification(data.title || 'Check 7', { body: (data.body || '') + ' Sent ' + (data.sent || '?') + '.', tag: 'check7-' + (data.sent || '') });
    await log('push received: sent ' + (data.sent || '?') + '; windows of the app: ' + windows.length + ', visible: ' + seen);
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(Promise.all([log('notification tapped: ' + event.notification.body), self.clients.openWindow('/check/7/app')]));
});
`;

/** The manifest: a home-screen app of its own, scoped to /check/7/. */
export const CHECK7_MANIFEST = {
  name: 'Fairfox check 7',
  short_name: 'Check 7',
  start_url: '/check/7/app',
  scope: '/check/7/',
  display: 'standalone',
  background_color: '#000000',
  theme_color: '#000000',
};
