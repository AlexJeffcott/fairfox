// The bare page of step 0c, check 3. One HTML file with its script inline: no
// build, no framework, no sign-in. Two devices open it, type the same room,
// and press Join. The second to join starts the call. The page shows the path
// the call took (a straight path or the relay) and the sound level heard. Each
// log line also goes to the server, which shows every device's lines at
// /check/3/log. The device name and the network are typed in by hand: Safari
// tells neither. See check3.ts.
export const CHECK3_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Check 3</title>
<style>
  :root { color-scheme: light dark; font: 16px/1.4 system-ui, sans-serif; }
  /* A swipe down at the top reloads a page in Safari on the iPhone, and ends the call. */
  html, body { overscroll-behavior: none; }
  body { margin: 0 auto; padding: 16px; max-width: 40rem; }
  fieldset { border: 1px solid #8888; margin: 0 0 12px; }
  button, input { font: inherit; padding: 8px 12px; }
  #path { font-size: 1.4rem; font-weight: 600; }
  #level { height: 12px; background: #2a7; width: 0; transition: width 0.2s; }
  pre { overscroll-behavior: contain; white-space: pre-wrap; font-size: 0.8rem; background: #8881; padding: 8px; max-height: 40vh; overflow: auto; }
</style>
</head>
<body>
<h1>Check 3</h1>
<p>Open this page on two devices. Type the same room on both. Press Join on both. Talk.</p>
<fieldset>
  <legend>Path</legend>
  <label><input type="radio" name="policy" value="all" checked> Any path</label>
  <label><input type="radio" name="policy" value="relay"> Relay only</label>
  <p>For the relay run, choose Relay only on one device or on both.</p>
  <label><input type="checkbox" id="server"> Call the server (check 5): it sends back what it hears</label>
</fieldset>
<fieldset>
  <legend>This device</legend>
  <label>Name <input id="device" maxlength="32" size="10" placeholder="iPad"></label>
  <p>Network:
  <label><input type="radio" name="network" value="wifi"> Wi-Fi</label>
  <label><input type="radio" name="network" value="mobile"> Mobile data</label>
  <label><input type="radio" name="network" value="unknown" checked> Not given</label></p>
</fieldset>
<p><label>Room <input id="room" value="a" maxlength="32" size="8"></label>
<button id="join">Join</button> <button id="leave" disabled>Leave</button></p>
<p id="path">Not connected</p>
<p>Sound from the other device:</p>
<div id="level"></div>
<audio id="remote" autoplay playsinline></audio>
<pre id="log"></pre>
<p><a href="/check/3/log" target="_blank">The log of every device</a></p>
<script type="module">
const $ = (id) => document.getElementById(id);
let pc, ws, stream, timer, heart, iceServers, policy, room, lastPath = '', held = [], queue = Promise.resolve();
let gone = false, leaving = false, lastPong = 0, quiet = false;

// Each line goes on the page and, once a second, to the server. The session
// tells apart two runs of one device.
let session = Math.random().toString(36).slice(2, 8), unsent = [], sending = false;
// The owner's time, Berlin and Rome, whatever zone the device is set to:
// 11:35:50 CEST in summer, CET in winter.
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
function stamp() {
  const parts = Object.fromEntries(clock.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return parts.hour + ':' + parts.minute + ':' + parts.second + ' ' + parts.timeZoneName;
}

// An urgent line is sent at once, not with the next second's lines: the page
// may not live another second.
const log = (text, urgent) => {
  const line = stamp() + ' ' + text;
  $('log').textContent += line + '\\n';
  unsent.push(line);
  if (urgent) flush();
};
const network = () => document.querySelector('input[name=network]:checked').value;
async function flush() {
  if (sending || unsent.length === 0) return;
  sending = true;
  const lines = unsent.splice(0, 100);
  try {
    const answer = await fetch('/check/3/log', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, device: $('device').value.trim(), network: network(), lines }) });
    if (!answer.ok) throw new Error('status ' + answer.status);
  } catch (err) {
    unsent.unshift(...lines);
  }
  sending = false;
}
setInterval(flush, 1000);

// The name and the network are kept for the next load of the page.
try {
  $('device').value = localStorage.getItem('check3-device') ?? '';
  const kept = document.querySelector('input[name=network][value="' + localStorage.getItem('check3-network') + '"]');
  if (kept) kept.checked = true;
} catch {}
$('device').oninput = () => { try { localStorage.setItem('check3-device', $('device').value.trim()); } catch {} };
for (const input of document.querySelectorAll('input[name=network]')) input.onchange = () => { try { localStorage.setItem('check3-network', network()); } catch {} };

// Why a call ends with no Leave. Join puts a mark in sessionStorage and Leave
// takes it away. The mark lives as long as the tab, so a mark found when the
// page loads means the page was reloaded, or its tab crashed and Safari
// loaded it again, in the middle of a call. A closed tab leaves no mark.
const MARK = 'check3-call';
const navigation = (performance.getEntriesByType('navigation')[0] || {}).type || 'unknown';
let mark = null;
try { mark = sessionStorage.getItem(MARK); sessionStorage.removeItem(MARK); } catch {}
log('page loaded (' + navigation + ')' + (mark ? '; the call of session ' + mark + ' ended with no Leave: this page was reloaded or its tab crashed' : ''), true);
document.addEventListener('visibilitychange', () => log('page ' + document.visibilityState, true));
addEventListener('pagehide', (e) => log('page closed or left' + (e.persisted ? ', kept in memory' : ''), true));
addEventListener('pageshow', (e) => { if (e.persisted) log('page shown again from memory', true); });


function send(message) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }

const kind = (candidate) => (/ typ (\\w+)/.exec(candidate.candidate ?? '') ?? [])[1] + ' ' + ((/ (udp|tcp) /i.exec(candidate.candidate ?? '') ?? [])[1] ?? '').toLowerCase();

// A new peer connection for each call. The old one is closed when the other
// device says hello again, presses Leave, or its call fails, so a second call
// in the same room starts clean.
function newPeer() {
  if (pc) pc.close();
  held = [];
  lastPath = '';
  gone = false;
  pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  const own = pc;
  pc.onicecandidate = (e) => { if (e.candidate && own === pc) { send({ type: 'candidate', candidate: e.candidate }); log('local candidate: ' + kind(e.candidate)); } };
  pc.ontrack = (e) => { $('remote').srcObject = e.streams[0]; $('remote').play().catch((err) => log('play: ' + err)); };
  pc.onconnectionstatechange = () => { if (own === pc) log('connection: ' + pc.connectionState, true); };
  pc.oniceconnectionstatechange = () => {
    if (own !== pc) return;
    log('ice: ' + pc.iceConnectionState, true);
    if (pc.iceConnectionState === 'failed') {
      pairs();
      // The other device's signalling went, and now its sound has too: the call is over.
      if (gone) queue = queue.then(async () => { await result(); newPeer(); });
    }
  };
}

// A call counts as live while ICE holds, whatever the signalling does.
const live = () => pc && ['connected', 'completed', 'checking'].includes(pc.iceConnectionState);

// Messages are handled one at a time, in the order they came: a candidate
// never meets a description that is still being set.
async function handle(m) {
  if (m.type === 'pong') { lastPong = Date.now(); quiet = false; return; }
  if (m.type === 'full') { log('room is full: two devices are in it'); return; }
  if (m.type === 'joined') {
    if (live()) { log('signalling back; the call goes on. Other devices in the room: ' + m.others, true); return; }
    log('joined; other devices in the room: ' + m.others); if (m.others > 0) send({ type: 'hello' }); return;
  }
  if (m.type === 'hello') { log('the other device joined; calling'); if (pc.connectionState !== 'new') await result(); newPeer(); await pc.setLocalDescription(await pc.createOffer()); send({ type: 'offer', sdp: pc.localDescription.sdp }); return; }
  if (m.type === 'offer') { if (pc.signalingState !== 'stable' || pc.remoteDescription) newPeer(); await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp }); await release(); await pc.setLocalDescription(await pc.createAnswer()); send({ type: 'answer', sdp: pc.localDescription.sdp }); return; }
  if (m.type === 'answer') { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); await release(); return; }
  if (m.type === 'candidate') { log('remote candidate: ' + kind(m.candidate)); if (pc.remoteDescription) await pc.addIceCandidate(m.candidate).catch((err) => log('candidate: ' + err)); else held.push(m.candidate); return; }
  if (m.type === 'bye') { log('the other device left: it pressed Leave', true); await result(); newPeer(); return; }
  if (m.type === 'left') {
    // The server says this when the other device's socket closes. Its call may still be live.
    if (live()) { gone = true; log('the other device left the signalling; the call goes on while ICE holds', true); return; }
    // No call to end: the other device's socket closed after its bye, or before any call.
    if (pc.connectionState === 'new') { log('the socket of the other device closed'); return; }
    log('the other device left', true); await result(); newPeer();
  }
}

async function release() {
  for (const candidate of held.splice(0)) await pc.addIceCandidate(candidate).catch((err) => log('candidate: ' + err));
}

// When ICE fails: what each candidate pair did, so the log shows why.
async function pairs() {
  const report = await pc.getStats();
  const counts = {};
  report.forEach((s) => {
    if (s.type !== 'candidate-pair') return;
    const local = report.get(s.localCandidateId), remote = report.get(s.remoteCandidateId);
    const key = (local ? local.candidateType : '?') + '-' + (remote ? remote.candidateType : '?') + ' ' + s.state;
    counts[key] = (counts[key] ?? 0) + 1;
  });
  log('candidate pairs: ' + (Object.entries(counts).map(([k, n]) => k + ' x' + n).join(', ') || 'none'));
}

// The signalling socket. When it closes and Leave was not pressed, it opens
// again after 2 seconds; the call, if live, goes on through it.
function connect() {
  const path = $('server').checked ? '/check/5/ws' : '/check/3/ws?room=' + encodeURIComponent(room) + '&session=' + session;
  const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path);
  ws = socket;
  lastPong = Date.now();
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    queue = queue.then(() => handle(m)).catch((err) => log('error: ' + err));
  };
  socket.onclose = (e) => {
    log('signalling closed (' + e.code + ')', true);
    if (ws === socket && !leaving) { log('signalling: opening again in 2 s', true); setTimeout(() => { if (!leaving && ws === socket) connect(); }, 2000); }
  };
}

// Every 5 seconds: a ping to the server, and a line that says the page is
// alive, with what the call is doing. The last such line before a page dies
// says what it was doing then.
async function beat() {
  if (!$('server').checked) {
    send({ type: 'ping' });
    const silent = Math.round((Date.now() - lastPong) / 1000);
    if (silent > 15 && !quiet) { quiet = true; log('no pong from the server for ' + silent + ' s', true); }
  }
  if (!pc) return;
  const report = await pc.getStats();
  let inbound, outbound;
  report.forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'audio') inbound = s;
    if (s.type === 'outbound-rtp' && s.kind === 'audio') outbound = s;
  });
  log('alive: connection ' + pc.connectionState + ', ice ' + pc.iceConnectionState + ', signalling ' + (ws ? ['connecting', 'open', 'closing', 'closed'][ws.readyState] : 'none') +
    ', received ' + (inbound ? inbound.packetsReceived + ' packets, lost ' + inbound.packetsLost + ', audioLevel ' + inbound.audioLevel : 'nothing') +
    ', sent ' + (outbound ? outbound.packetsSent + ' packets' : 'nothing'));
}

async function start() {
  $('join').disabled = true;
  leaving = false;
  policy = document.querySelector('input[name=policy]:checked').value;
  room = $('room').value.trim();
  session = Math.random().toString(36).slice(2, 8);
  try { sessionStorage.setItem(MARK, session); } catch {}
  log('device: ' + ($('device').value.trim() || 'no name') + ', network: ' + network() + ', ' + navigator.userAgent);
  log('policy: ' + policy + ', room: ' + room);
  // The audio element plays only after a tap on iOS; Join is that tap.
  $('remote').play().catch(() => {});
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  log('microphone: ' + stream.getAudioTracks().map((t) => t.label).join(', '));
  ({ iceServers } = await (await fetch('/check/3/ice')).json());
  newPeer();
  log($('server').checked ? 'calling the server' : 'room: ' + room);
  connect();
  timer = setInterval(stats, 2000);
  heart = setInterval(beat, 5000);
  $('leave').disabled = false;
}

// The bar shows the level of the sound from the other device, in decibels
// from -60 to 0. audioLevel runs from 0 to 1, and speech is mostly below 0.3.
function bar(level) {
  const db = level > 0 ? 20 * Math.log10(level) : -60;
  $('level').style.width = Math.max(0, Math.min(100, Math.round((db + 60) / 60 * 100))) + '%';
}

async function stats() {
  if (!pc) return;
  const report = await pc.getStats();
  let pair, audio;
  report.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId);
    if (s.type === 'inbound-rtp' && s.kind === 'audio') audio = s;
  });
  if (!pair) report.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
  if (pair) {
    const local = report.get(pair.localCandidateId), remote = report.get(pair.remoteCandidateId);
    const relayed = local.candidateType === 'relay' || remote.candidateType === 'relay';
    $('path').textContent = (relayed ? 'Through the relay' : 'Straight path') + ': this device ' + local.candidateType + ', other device ' + remote.candidateType + ' (' + (local.protocol || '') + ')';
    if ($('path').textContent !== lastPath) { lastPath = $('path').textContent; log('path: ' + lastPath); }
  }
  if (audio) {
    bar(audio.audioLevel ?? 0);
    $('path').title = 'packets ' + audio.packetsReceived + ', lost ' + audio.packetsLost + ', jitter ' + audio.jitter;
  }
}

// The result of a call: the path and the sound packets this device received.
async function result() {
  if (!pc) return;
  await stats();
  log('result: ' + $('path').textContent + '; ' + ($('path').title || 'no sound packets'));
  $('path').textContent = 'Not connected';
  $('path').title = '';
  bar(0);
}

async function stop() {
  leaving = true;
  clearInterval(timer); clearInterval(heart);
  try { sessionStorage.removeItem(MARK); } catch {}
  await result();
  send({ type: 'bye' });
  pc && pc.close(); ws && ws.close(); stream && stream.getTracks().forEach((t) => t.stop());
  pc = ws = stream = undefined;
  $('join').disabled = false; $('leave').disabled = true;
}

// For scripts/check-3-log.ts: close the signalling socket as a network would, with no Leave.
window.dropSignalling = () => ws && ws.close(4000);

$('join').onclick = () => start().catch((err) => { log('error: ' + err); $('join').disabled = false; });
$('leave').onclick = () => stop().finally(flush);
</script>
</body>
</html>
`;
