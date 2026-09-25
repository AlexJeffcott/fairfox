// Step 0c, check 1: a call forced through the relay `fairfox-turn` carries
// sound. Two werift peers run in this process. Both may use relay candidates
// only (iceTransportPolicy "relay"), so every packet leaves this machine for
// the relay on Fly and comes back. One peer sends a WAV file as PCMU; the
// other saves what it receives and compares it, packet by packet, with what
// was sent. Listen to the saved file to hear the sound.
//
//   bun scripts/check-1-relay.ts --secret-file ~/.config/fairfox/turn-secret \
//     --relay 213.188.221.129:3478 --in in.wav --out out.wav
//
// Exit 0: connected through the relay only, every packet arrived, each the
// same as sent. Anything else exits 1 and says what differed.
import { parseArgs } from 'node:util';
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, usePCMU } from 'werift';
import {
  PACKET_MS,
  SAMPLES_PER_PACKET,
  decodeMulaw,
  packetize,
  readWav,
  turnCredentials,
  writeWav,
} from './audio.ts';

const { values } = parseArgs({
  options: {
    'secret-file': { type: 'string' },
    relay: { type: 'string' },
    in: { type: 'string' },
    out: { type: 'string' },
  },
});
const required = (name: 'secret-file' | 'relay' | 'in' | 'out'): string => {
  const value = values[name];
  if (value === undefined || value === '') {
    throw new Error(`--${name} is required. It has no default.`);
  }
  return value;
};
const secretFile = required('secret-file');
const relay = required('relay');
const inPath = required('in');
const outPath = required('out');

const secret = (await Bun.file(secretFile).text()).trim();
if (secret === '') {
  throw new Error(`${secretFile} is empty.`);
}
const payloads = packetize(readWav(await Bun.file(inPath).bytes()));

/** Rejects when `promise` has not settled after `ms`: a limit, not a wait. */
function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
  return new Promise<T>((fulfil, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: nothing after ${ms} ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        fulfil(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function peer(label: string): RTCPeerConnection {
  const { username, credential } = turnCredentials(secret, `check1-${label}`, new Date(), 600);
  return new RTCPeerConnection({
    codecs: { audio: [usePCMU()] },
    iceServers: [{ urls: `turn:${relay}?transport=udp`, username, credential }],
    iceTransportPolicy: 'relay',
  });
}

/** The session description once every candidate is gathered: no trickle. */
async function gathered(pc: RTCPeerConnection, label: string): Promise<{ type: 'offer' | 'answer'; sdp: string }> {
  if (pc.iceGatheringState !== 'complete') {
    await within(15_000, `${label}: gathering candidates`, pc.iceGatheringStateChange.watch((state) => state === 'complete'));
  }
  const description = pc.localDescription;
  if (description === null || (description.type !== 'offer' && description.type !== 'answer')) {
    throw new Error(`${label}: no local offer or answer after gathering.`);
  }
  return { type: description.type, sdp: description.sdp };
}

/** The candidate lines of an SDP, and whether each is a relay candidate. */
function candidates(sdp: string): { line: string; relay: boolean }[] {
  return sdp
    .split(/\r?\n/)
    .filter((line) => line.startsWith('a=candidate:'))
    .map((line) => ({ line, relay: / typ relay( |$)/.test(line) }));
}

const sender = peer('send');
const receiver = peer('receive');
const track = new MediaStreamTrack({ kind: 'audio' });
sender.addTransceiver(track, { direction: 'sendonly' });
receiver.addTransceiver('audio', { direction: 'recvonly' });

const received = new Map<number, Uint8Array>();
let firstSequence: number | undefined;
const { promise: allArrived, resolve: everyPacket } = Promise.withResolvers<void>();
receiver.onTrack.subscribe((incoming) => {
  incoming.onReceiveRtp.subscribe((rtp) => {
    firstSequence ??= rtp.header.sequenceNumber;
    const index = (rtp.header.sequenceNumber - firstSequence + 0x10000) % 0x10000;
    received.set(index, new Uint8Array(rtp.payload));
    if (received.size === payloads.length) {
      everyPacket();
    }
  });
});

await sender.setLocalDescription(await sender.createOffer());
const offer = await gathered(sender, 'sender');
await receiver.setRemoteDescription(offer);
await receiver.setLocalDescription(await receiver.createAnswer());
const answer = await gathered(receiver, 'receiver');
await sender.setRemoteDescription(answer);

const offered = candidates(offer.sdp);
const answered = candidates(answer.sdp);
const sides: { label: string; list: { line: string; relay: boolean }[] }[] = [
  { label: 'sender', list: offered },
  { label: 'receiver', list: answered },
];
for (const { label, list } of sides) {
  if (list.length === 0) {
    throw new Error(`${label}: no candidate at all. The relay gave no allocation: check the secret and the address.`);
  }
  const other = list.filter((c) => !c.relay);
  if (other.length > 0) {
    throw new Error(`${label}: a candidate that is not a relay candidate:\n${other.map((c) => c.line).join('\n')}`);
  }
  console.log(`${label}: ${list.length} relay candidate(s): ${list.map((c) => c.line.split(' ').slice(4, 6).join(':')).join(', ')}`);
}

const connected = (pc: RTCPeerConnection) =>
  pc.connectionState === 'connected' ? Promise.resolve() : pc.connectionStateChange.watch((state) => state === 'connected').then(() => undefined);
await within(20_000, 'connecting through the relay', Promise.all([connected(sender), connected(receiver)]));
console.log('connected through the relay');

const ssrc = Math.floor(Math.random() * 0xffffffff);
const startSequence = Math.floor(Math.random() * 0x10000);
let next = 0;
const pacing = setInterval(() => {
  const payload = payloads[next];
  if (payload === undefined) {
    clearInterval(pacing);
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

const sendingMs = payloads.length * PACKET_MS;
await within(sendingMs + 5_000, `receiving ${payloads.length} packets`, allArrived).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
});
clearInterval(pacing);

const samples = new Int16Array(payloads.length * SAMPLES_PER_PACKET);
let differing = 0;
payloads.forEach((sent, index) => {
  const got = received.get(index);
  if (got === undefined) {
    return;
  }
  if (got.length !== sent.length || got.some((byte, i) => byte !== sent[i])) {
    differing++;
  }
  got.forEach((byte, i) => {
    samples[index * SAMPLES_PER_PACKET + i] = decodeMulaw(byte);
  });
});
await Bun.write(outPath, writeWav(samples));

await sender.close();
await receiver.close();

const missing = payloads.length - received.size;
console.log(`sent ${payloads.length} packets; received ${received.size}; missing ${missing}; different ${differing}. Saved: ${outPath}`);
if (missing > 0 || differing > 0) {
  console.error('check 1: red');
  process.exit(1);
}
console.log('check 1: green. Listen: afplay ' + outPath);
