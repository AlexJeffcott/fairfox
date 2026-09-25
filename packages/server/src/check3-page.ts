// The bare page of step 0c, check 3. One HTML file with its script inline: no
// build, no framework, no sign-in. Two devices open it, type the same room,
// and press Join. The second to join starts the call. The page shows the path
// the call took (a straight path or the relay) and the sound level heard, so
// the owner can write the result down. See check3.ts.
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
</fieldset>
<p><label>Room <input id="room" value="a" maxlength="32" size="8"></label>
<button id="join">Join</button> <button id="leave" disabled>Leave</button></p>
<p id="path">Not connected</p>
<p>Sound from the other device:</p>
<div id="level"></div>
<audio id="remote" autoplay playsinline></audio>
<pre id="log"></pre>
<script type="module">
const $ = (id) => document.getElementById(id);
const log = (text) => { $('log').textContent += new Date().toISOString().slice(11, 19) + ' ' + text + '\\n'; };
let pc, ws, stream, timer, polite = false;

function send(message) { ws.send(JSON.stringify(message)); }

async function start() {
  $('join').disabled = true;
  const policy = document.querySelector('input[name=policy]:checked').value;
  const room = $('room').value.trim();
  log('device: ' + navigator.userAgent);
  log('policy: ' + policy + ', room: ' + room);
  // The audio element plays only after a tap on iOS; Join is that tap.
  $('remote').play().catch(() => {});
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  log('microphone: ' + stream.getAudioTracks().map((t) => t.label).join(', '));
  const { iceServers } = await (await fetch('/check/3/ice')).json();
  pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.onicecandidate = (e) => { if (e.candidate) { send({ type: 'candidate', candidate: e.candidate }); log('local candidate: ' + e.candidate.type + ' ' + (e.candidate.protocol || '')); } };
  pc.ontrack = (e) => { $('remote').srcObject = e.streams[0]; $('remote').play().catch((err) => log('play: ' + err)); };
  pc.onconnectionstatechange = () => log('connection: ' + pc.connectionState);
  pc.oniceconnectionstatechange = () => log('ice: ' + pc.iceConnectionState);
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/check/3/ws?room=' + encodeURIComponent(room));
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'full') { log('room is full: two devices are in it'); return; }
    if (m.type === 'joined') { log('joined; other devices in the room: ' + m.others); polite = m.others > 0; if (polite) send({ type: 'hello' }); return; }
    if (m.type === 'hello') { log('the other device joined; calling'); await pc.setLocalDescription(await pc.createOffer()); send({ type: 'offer', sdp: pc.localDescription.sdp }); return; }
    if (m.type === 'offer') { await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp }); await pc.setLocalDescription(await pc.createAnswer()); send({ type: 'answer', sdp: pc.localDescription.sdp }); return; }
    if (m.type === 'answer') { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); return; }
    if (m.type === 'candidate') { await pc.addIceCandidate(m.candidate).catch((err) => log('candidate: ' + err)); return; }
    if (m.type === 'left') { log('the other device left'); }
  };
  ws.onclose = () => log('signalling closed');
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
  }
  if (audio) {
    const level = audio.audioLevel ?? 0;
    $('level').style.width = Math.min(100, Math.round(level * 300)) + '%';
    $('path').title = 'packets ' + audio.packetsReceived + ', lost ' + audio.packetsLost + ', jitter ' + audio.jitter;
  }
}

function stop() {
  clearInterval(timer);
  $('path').textContent && log('result: ' + $('path').textContent);
  pc && pc.close(); ws && ws.close(); stream && stream.getTracks().forEach((t) => t.stop());
  pc = ws = stream = undefined;
  $('join').disabled = false; $('leave').disabled = true;
}

$('join').onclick = () => start().catch((err) => { log('error: ' + err); $('join').disabled = false; });
$('leave').onclick = stop;
</script>
</body>
</html>
`;
