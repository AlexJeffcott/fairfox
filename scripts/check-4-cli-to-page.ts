// Step 0c, check 4: the CLI calls the bare page on the iPhone. werift on the
// laptop and Safari on the phone meet in a room of the check 3 routes. The
// CLI sends a WAV file as PCMU, which the phone plays; it saves what the
// phone's microphone sends for a set time. The call is both ways at once, as
// a phone call is. werift to Safari is the unknown this closes: it puts the
// CLI's checks and the browser on one path (P3).
//
//   1. On the iPhone, open https://fairfox.fly.dev/check/3, room c4, Join.
//   2. bun scripts/check-4-cli-to-page.ts --origin https://fairfox.fly.dev \
//        --room c4 --send in.wav --save phone.wav --seconds 15
//   3. Listen on the phone; speak into it. Then: afplay phone.wav
//
// The page and the CLI may join in either order. --relay forces the CLI's end
// through the relay. --self-test opens the page in headless Chromium, with a
// fake microphone, in place of the phone.
//
// Exit 0: connected, and sound packets came from the page. Whether the phone
// played the file and whether its microphone was heard, the owner says.
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, usePCMU } from 'werift';
import { PACKET_MS, SAMPLES_PER_PACKET, decodeMulaw, packetize, readWav, writeWav } from './audio.ts';
import { type Candidate, Room, relayServers } from './signal.ts';
import { gathered, within } from './webrtc.ts';

const { values } = parseArgs({
  options: {
    origin: { type: 'string' },
    room: { type: 'string' },
    send: { type: 'string' },
    save: { type: 'string' },
    seconds: { type: 'string' },
    relay: { type: 'boolean', default: false },
    'self-test': { type: 'string' },
  },
});
const required = (name: 'origin' | 'room' | 'send' | 'save' | 'seconds'): string => {
  const value = values[name];
  if (value === undefined || value === '') {
    throw new Error(`--${name} is required. It has no default.`);
  }
  return value;
};
const origin = required('origin');
const roomName = required('room');
const savePath = required('save');
const seconds = Number(required('seconds'));
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
  throw new Error('--seconds is a whole number from 1 to 300.');
}
const selfTest = values['self-test'];
if (selfTest !== undefined && selfTest !== 'page-first' && selfTest !== 'cli-first') {
  throw new Error('--self-test is page-first or cli-first.');
}
const payloads = packetize(readWav(await Bun.file(required('send')).bytes()));

// --self-test: headless Chromium opens the page in place of the phone.
const browser = selfTest === undefined ? undefined : await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await (async () => {
  if (browser === undefined) {
    return undefined;
  }
  const context = await browser.newContext({ permissions: ['microphone'] });
  const opened = await context.newPage();
  await opened.goto(`${origin}/check/3`);
  await opened.fill('#room', roomName);
  return opened;
})();
if (page !== undefined && selfTest === 'page-first') {
  await page.click('#join');
  await page.locator('#log').filter({ hasText: 'joined;' }).waitFor({ timeout: 10_000 });
}

const pc = new RTCPeerConnection({
  codecs: { audio: [usePCMU()] },
  iceServers: await relayServers(origin),
  iceTransportPolicy: values.relay ? 'relay' : 'all',
});
const track = new MediaStreamTrack({ kind: 'audio' });

// The page trickles its candidates. Those that come before its description are held.
const held: Candidate[] = [];
let described = false;
const room = await Room.join(origin, roomName);
room.onCandidate = (candidate) => {
  if (described) {
    pc.addIceCandidate(candidate).catch((error: unknown) => console.log(`candidate: ${String(error)}`));
  } else {
    held.push(candidate);
  }
};
async function remote(description: { type: 'offer' | 'answer'; sdp: string }): Promise<void> {
  await pc.setRemoteDescription(description);
  described = true;
  for (const candidate of held.splice(0)) {
    await pc.addIceCandidate(candidate).catch((error: unknown) => console.log(`candidate: ${String(error)}`));
  }
}

const received = new Map<number, Uint8Array>();
const payloadTypes = new Set<number>();
let first: number | undefined;
pc.onTrack.subscribe((incoming) => {
  incoming.onReceiveRtp.subscribe((rtp) => {
    payloadTypes.add(rtp.header.payloadType);
    first ??= rtp.header.sequenceNumber;
    received.set((rtp.header.sequenceNumber - first + 0x10000) % 0x10000, new Uint8Array(rtp.payload));
  });
});

const joined = await room.expect(['joined'], 10_000);
console.log(`cli: joined room ${roomName}; ${joined.others} other end(s) in it`);
if (page !== undefined && selfTest === 'cli-first') {
  await page.click('#join');
}
if (joined.others > 0) {
  // The page was first: it makes the offer when it hears hello.
  room.send({ type: 'hello' });
  const offer = await room.expect(['offer'], 60_000);
  await remote(offer);
  const transceiver = pc.getTransceivers()[0];
  if (transceiver === undefined) {
    throw new Error('The offer has no audio section.');
  }
  transceiver.setDirection('sendrecv');
  await transceiver.sender.replaceTrack(track);
  await pc.setLocalDescription(await pc.createAnswer());
  room.send({ type: 'answer', sdp: (await gathered(pc, 'cli')).sdp });
  console.log('cli: answered the page');
} else {
  console.log('cli: waiting up to 10 minutes for the page. Open it and press Join.');
  await room.expect(['hello'], 600_000);
  pc.addTransceiver(track, { direction: 'sendrecv' });
  await pc.setLocalDescription(await pc.createOffer());
  room.send({ type: 'offer', sdp: (await gathered(pc, 'cli')).sdp });
  await remote(await room.expect(['answer'], 30_000));
  console.log('cli: the page answered');
}

await within(30_000, 'connecting', pc.connectionState === 'connected' ? Promise.resolve() : pc.connectionStateChange.watch((s) => s === 'connected').then(() => undefined));
const pair = pc.iceTransports[0]?.connection.nominated;
console.log(`cli: connected. Path: ${pair === undefined ? 'unknown' : `${pair.json.localCandidate} <-> ${pair.json.remoteCandidate}`}`);

const ssrc = Math.floor(Math.random() * 0xffffffff);
const startSequence = Math.floor(Math.random() * 0x10000);
let next = 0;
// Real-time pacing, one packet each 20 ms, once through the file.
const pacing = setInterval(() => {
  const payload = payloads[next];
  if (payload === undefined) {
    clearInterval(pacing);
    console.log(`cli: sent the file, ${payloads.length} packets`);
    return;
  }
  const header = new RtpHeader({
    payloadType: 0,
    sequenceNumber: (startSequence + next) % 0x10000,
    timestamp: (next * SAMPLES_PER_PACKET) % 0x100000000,
    ssrc,
    marker: next === 0,
  });
  track.writeRtp(new RtpPacket(header, Buffer.from(payload)));
  next++;
}, PACKET_MS);

// The recording lasts --seconds from the connection; the end of it ends the run.
setTimeout(() => {
  finish().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}, seconds * 1000);

async function finish(): Promise<void> {
  clearInterval(pacing);
  const count = received.size === 0 ? 0 : Math.max(...received.keys()) + 1;
  const samples = new Int16Array(count * SAMPLES_PER_PACKET);
  let square = 0;
  for (const [index, payload] of received) {
    payload.forEach((byte, i) => {
      const sample = decodeMulaw(byte);
      samples[index * SAMPLES_PER_PACKET + i] = sample;
      square += sample * sample;
    });
  }
  await Bun.write(savePath, writeWav(samples));
  const rms = Math.sqrt(square / Math.max(1, received.size * SAMPLES_PER_PACKET));
  const level = rms === 0 ? '-inf' : (20 * Math.log10(rms / 32768)).toFixed(1);
  console.log(
    `cli: received ${received.size} packets of ${count} (${count - received.size} missing), payload type(s) ${[...payloadTypes].join(', ') || 'none'}, level ${level} dBFS. Saved: ${savePath}`,
  );
  let ok = received.size > 0;
  if (page !== undefined) {
    const path = await page.textContent('#path');
    const title = (await page.getAttribute('#path', 'title')) ?? '';
    const pagePackets = Number(/packets (\d+)/.exec(title)?.[1] ?? 0);
    console.log(`page: ${path}; received ${pagePackets} packets`);
    ok = ok && pagePackets >= 50;
    await browser?.close();
  }
  room.close();
  void pc.close();
  if (!ok) {
    console.error('check 4: red');
    process.exit(1);
  }
  console.log(`check 4: green on this end. Listen: afplay ${savePath}`);
  process.exit(0);
}
