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
  body { margin: 0 auto; padding: 16px; max-width: 40rem; }
  fieldset { border: 1px solid #8888; margin: 0 0 12px; }
  button, input { font: inherit; padding: 8px 12px; }
  #path { font-size: 1.4rem; font-weight: 600; }
  #level { height: 12px; background: #2a7; width: 0; transition: width 0.2s; }
  pre { white-space: pre-wrap; font-size: 0.8rem; background: #8881; padding: 8px; max-height: 40vh; overflow: auto; }
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
let pc, ws, stream, timer, iceServers, policy, polite = false, lastPath = '', held = [], queue = Promise.resolve();

// Each line goes on the page and, once a second, to the server. The session
// tells apart two runs of one device.
let session = Math.random().toString(36).slice(2, 8), unsent = [], sending = false;
// An urgent line is sent at once, not with the next second's lines: the page
// may not live another second.
const log = (text, urgent) => {
  const line = new Date().toISOString().slice(11, 19) + ' ' + text;
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


function send(message) { ws.send(JSON.stringify(message)); }

const kind = (candidate) => (/ typ (\\w+)/.exec(candidate.candidate ?? '') ?? [])[1] + ' ' + ((/ (udp|tcp) /i.exec(candidate.candidate ?? '') ?? [])[1] ?? '').toLowerCase();

// A new peer connection for each call. The old one is closed when the other
// device leaves or says hello again, so a second call in the same room starts
// clean.
function newPeer() {
  if (pc) pc.close();
  held = [];
  lastPath = '';
  pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  const own = pc;
  pc.onicecandidate = (e) => { if (e.candidate && own === pc) { send({ type: 'candidate', candidate: e.candidate }); log('local candidate: ' + kind(e.candidate)); } };
  pc.ontrack = (e) => { $('remote').srcObject = e.streams[0]; $('remote').play().catch((err) => log('play: ' + err)); };
  pc.onconnectionstatechange = () => { if (own === pc) log('connection: ' + pc.connectionState, true); };
  pc.oniceconnectionstatechange = () => { if (own !== pc) return; log('ice: ' + pc.iceConnectionState); if (pc.iceConnectionState === 'failed') pairs(); };
}

// Messages are handled one at a time, in the order they came: a candidate
// never meets a description that is still being set.
async function handle(m) {
  if (m.type === 'full') { log('room is full: two devices are in it'); return; }
  if (m.type === 'joined') { log('joined; other devices in the room: ' + m.others); polite = m.others > 0; if (polite) send({ type: 'hello' }); return; }
  if (m.type === 'hello') { log('the other device joined; calling'); newPeer(); await pc.setLocalDescription(await pc.createOffer()); send({ type: 'offer', sdp: pc.localDescription.sdp }); return; }
  if (m.type === 'offer') { if (pc.signalingState !== 'stable' || pc.remoteDescription) newPeer(); await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp }); await release(); await pc.setLocalDescription(await pc.createAnswer()); send({ type: 'answer', sdp: pc.localDescription.sdp }); return; }
  if (m.type === 'answer') { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); await release(); return; }
  if (m.type === 'candidate') { log('remote candidate: ' + kind(m.candidate)); if (pc.remoteDescription) await pc.addIceCandidate(m.candidate).catch((err) => log('candidate: ' + err)); else held.push(m.candidate); return; }
  if (m.type === 'left') { log('the other device left', true); await result(); newPeer(); }
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

async function start() {
  $('join').disabled = true;
  policy = document.querySelector('input[name=policy]:checked').value;
  const room = $('room').value.trim();
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
  const path = $('server').checked ? '/check/5/ws' : '/check/3/ws?room=' + encodeURIComponent(room);
  log(path.startsWith('/check/5') ? 'calling the server' : 'room: ' + room);
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    queue = queue.then(() => handle(m)).catch((err) => log('error: ' + err));
  };
  ws.onclose = (e) => log('signalling closed (' + e.code + ')', true);
  timer = setInterval(stats, 2000);
  $('leave').disabled = false;
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
    const level = audio.audioLevel ?? 0;
    $('level').style.width = Math.min(100, Math.round(level * 300)) + '%';
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
}

async function stop() {
  clearInterval(timer);
  try { sessionStorage.removeItem(MARK); } catch {}
  await result();
  pc && pc.close(); ws && ws.close(); stream && stream.getTracks().forEach((t) => t.stop());
  pc = ws = stream = undefined;
  $('join').disabled = false; $('leave').disabled = true;
}

$('join').onclick = () => start().catch((err) => { log('error: ' + err); $('join').disabled = false; });
$('leave').onclick = () => stop().finally(flush);
</script>
</body>
</html>
`;
