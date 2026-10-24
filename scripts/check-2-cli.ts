// Step 0c, check 2: werift between two real networks. One process on the
// owner's laptop, one on a second machine on a mobile network. They meet in a
// room of the check 3 routes on the deployed server, which pass their offer
// and answer and give them relay credentials; the call itself goes straight
// between the machines, or through the relay where no straight path exists.
// The sender sends a WAV file as PCMU; the receiver saves what arrives and
// compares it with the packet count and SHA-256 the sender reports at the end.
//
//   on the second machine:  bun scripts/check-2-cli.ts --origin https://fairfox.fly.dev --room r1 --receive out.wav
//   on the laptop:          bun scripts/check-2-cli.ts --origin https://fairfox.fly.dev --room r1 --send in.wav
//
// Either may start first. --relay forces this end through the relay.
// Exit 0 on the receiver: every packet arrived and the hash matches.
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, usePCMU } from 'werift';
import { PACKET_MS, SAMPLES_PER_PACKET, decodeMulaw, packetize, readWav, writeWav } from './audio.ts';
import { Room, relayServers } from './signal.ts';
import { candidates, gathered, within } from './webrtc.ts';

const { values } = parseArgs({
  options: {
    origin: { type: 'string' },
    room: { type: 'string' },
    send: { type: 'string' },
    receive: { type: 'string' },
    relay: { type: 'boolean', default: false },
  },
});
const origin = values.origin;
const roomName = values.room;
if (origin === undefined || roomName === undefined) {
  throw new Error('--origin and --room are required. They have no default.');
}
if ((values.send === undefined) === (values.receive === undefined)) {
  throw new Error('Give --send <in.wav> on one machine and --receive <out.wav> on the other.');
}
const role = values.send === undefined ? 'receiver' : 'sender';
const policy = values.relay ? 'relay' : 'all';

const pc = new RTCPeerConnection({
  codecs: { audio: [usePCMU()] },
  iceServers: await relayServers(origin),
  iceTransportPolicy: policy,
});

const room = await Room.join(origin, roomName);
const joined = await room.expect(['joined'], 10_000);
console.log(`${role}: joined room ${roomName}; ${joined.others} other machine(s) in it; policy ${policy}`);
if (joined.others > 0) {
  room.send({ type: 'hello' });
} else {
  console.log(`${role}: waiting up to 10 minutes for the other machine`);
  await room.expect(['hello'], 600_000);
  room.send({ type: 'hello' });
}

function report(label: string, sdp: string): void {
  console.log(`${label}: ${candidates(sdp).map((c) => c.line.split(' ').slice(4, 8).join(' ')).join(', ')}`);
}
function chosenPath(): string {
  const pair = pc.iceTransports[0]?.connection.nominated;
  return pair === undefined ? 'no nominated pair' : `${pair.json.localCandidate} <-> ${pair.json.remoteCandidate}`;
}
const connected = () =>
  pc.connectionState === 'connected' ? Promise.resolve() : pc.connectionStateChange.watch((s) => s === 'connected').then(() => undefined);

if (role === 'receiver') {
  const outPath = values.receive ?? '';
  const received = new Map<number, Uint8Array>();
  let first: number | undefined;
  let expected = Number.POSITIVE_INFINITY;
  const { promise: allArrived, resolve: everyPacket } = Promise.withResolvers<void>();
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onTrack.subscribe((track) => {
    track.onReceiveRtp.subscribe((rtp) => {
      first ??= rtp.header.sequenceNumber;
      received.set((rtp.header.sequenceNumber - first + 0x10000) % 0x10000, new Uint8Array(rtp.payload));
      if (received.size >= expected) {
        everyPacket();
      }
    });
  });
  await pc.setLocalDescription(await pc.createOffer());
  const offer = await gathered(pc, 'receiver');
  report('this machine', offer.sdp);
  room.send({ type: 'offer', sdp: offer.sdp });
  const answer = await room.expect(['answer'], 30_000);
  report('other machine', answer.sdp);
  await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
  await within(30_000, 'connecting', connected());
  console.log(`connected: ${chosenPath()}`);
  const done = await room.expect(['done'], 600_000);
  // The last packets may still be on the way when "done" arrives: up to 3 s more.
  expected = done.packets;
  if (received.size < expected) {
    await within(3000, 'the last packets', allArrived).catch(() => undefined);
  }
  const hash = createHash('sha256');
  const samples = new Int16Array(done.packets * SAMPLES_PER_PACKET);
  for (let index = 0; index < done.packets; index++) {
    const payload = received.get(index);
    if (payload !== undefined) {
      hash.update(payload);
      payload.forEach((byte, i) => {
        samples[index * SAMPLES_PER_PACKET + i] = decodeMulaw(byte);
      });
    }
  }
  await Bun.write(outPath, writeWav(samples));
  const sha256 = hash.digest('hex');
  const missing = done.packets - Math.min(received.size, done.packets);
  console.log(`path: ${chosenPath()}`);
  console.log(`sent ${done.packets}; received ${received.size}; missing ${missing}; hash ${sha256 === done.sha256 ? 'the same' : 'different'}. Saved: ${outPath}`);
  if (missing > 0 || sha256 !== done.sha256) {
    console.error('check 2: red');
    process.exit(1);
  }
  console.log(`check 2: green. Listen: afplay ${outPath}`);
  process.exit(0);
}

const payloads = packetize(readWav(await Bun.file(values.send ?? '').bytes()));
const offer = await room.expect(['offer'], 60_000);
report('other machine', offer.sdp);
await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
const transceiver = pc.getTransceivers()[0];
if (transceiver === undefined) {
  throw new Error('The offer has no audio section.');
}
const track = new MediaStreamTrack({ kind: 'audio' });
transceiver.setDirection('sendonly');
await transceiver.sender.replaceTrack(track);
await pc.setLocalDescription(await pc.createAnswer());
const answer = await gathered(pc, 'sender');
report('this machine', answer.sdp);
room.send({ type: 'answer', sdp: answer.sdp });
await within(30_000, 'connecting', connected());
console.log(`connected: ${chosenPath()}`);

const ssrc = Math.floor(Math.random() * 0xffffffff);
const startSequence = Math.floor(Math.random() * 0x10000);
const hash = createHash('sha256');
let next = 0;
// Real-time pacing, one packet each 20 ms. The last tick reports and ends the run.
const pacing = setInterval(() => {
  const payload = payloads[next];
  if (payload === undefined) {
    clearInterval(pacing);
    room.send({ type: 'done', packets: payloads.length, sha256: hash.digest('hex') });
    console.log(`sender: sent ${payloads.length} packets. The receiver reports the result.`);
    room.close();
    process.exit(0);
  }
  hash.update(payload);
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
