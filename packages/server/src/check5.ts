// Step 0c, check 5: the server on Fly is one end of a WebRTC call, as the
// PSTN phone and the assistant need. The bare page connects to
// /check/5/ws, which speaks the messages of a check 3 room with the server as
// the other device: the page says hello, the server offers a PCMU call, and
// every sound packet the page sends, the server sends back. The Fly app has
// no UDP address of its own (a shared IPv4), so the server reaches the page
// through the relay fairfox-turn, as a client of it. The last deploy of step
// 0c removes this file (L2).
import { Elysia } from 'elysia';
import { MediaStreamTrack, RTCPeerConnection, type RTCIceCandidateInit, usePCMU } from 'werift';
import { RELAY, turnCredentials } from './check3.ts';

type Socket = { send: (message: string) => unknown };

/** A candidate as the page sends it, or undefined. */
function candidateOf(value: unknown): RTCIceCandidateInit | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate: unknown = Reflect.get(value, 'candidate');
  const mid: unknown = Reflect.get(value, 'sdpMid');
  const index: unknown = Reflect.get(value, 'sdpMLineIndex');
  if (typeof candidate !== 'string') {
    return undefined;
  }
  return {
    candidate,
    ...(typeof mid === 'string' ? { sdpMid: mid } : {}),
    ...(typeof index === 'number' ? { sdpMLineIndex: index } : {}),
  };
}

/** One call: the server's end, which sends back what it hears. */
function echoCall(turnSecret: string, socket: Socket) {
  const { username, credential } = turnCredentials(turnSecret, new Date());
  const pc = new RTCPeerConnection({
    codecs: { audio: [usePCMU()] },
    iceServers: [{ urls: `turn:${RELAY}?transport=udp`, username, credential }],
  });
  const back = new MediaStreamTrack({ kind: 'audio' });
  pc.addTransceiver(back, { direction: 'sendrecv' });
  pc.onTrack.subscribe((incoming) => {
    incoming.onReceiveRtp.subscribe((rtp) => back.writeRtp(rtp));
  });
  pc.connectionStateChange.subscribe((state) => console.log(`check 5: ${state}`));
  const held: RTCIceCandidateInit[] = [];
  let described = false;
  const say = (message: object) => socket.send(JSON.stringify(message));

  return {
    async hello() {
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.iceGatheringState !== 'complete') {
        await pc.iceGatheringStateChange.watch((state) => state === 'complete', 15_000);
      }
      say({ type: 'offer', sdp: pc.localDescription?.sdp ?? '' });
    },
    async answer(sdp: string) {
      await pc.setRemoteDescription({ type: 'answer', sdp });
      described = true;
      for (const candidate of held.splice(0)) {
        await pc.addIceCandidate(candidate).catch(() => undefined);
      }
    },
    async candidate(candidate: RTCIceCandidateInit) {
      if (described) {
        await pc.addIceCandidate(candidate).catch(() => undefined);
      } else {
        held.push(candidate);
      }
    },
    close() {
      // werift's close() of a peer with a live relay allocation may not return.
      void pc.close();
    },
  };
}

export function check5Routes(turnSecret: string) {
  const calls = new Map<string, ReturnType<typeof echoCall>>();
  return new Elysia().ws('/check/5/ws', {
    open(ws) {
      calls.set(ws.id, echoCall(turnSecret, ws));
      // The page reads this as a room with one device already in it, and says hello.
      ws.send(JSON.stringify({ type: 'joined', others: 1 }));
    },
    async message(ws, message) {
      const call = calls.get(ws.id);
      const value: unknown = typeof message === 'string' ? JSON.parse(message) : message;
      const type: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'type') : undefined;
      if (call === undefined || typeof value !== 'object' || value === null) {
        return;
      }
      if (type === 'hello') {
        await call.hello();
      } else if (type === 'answer') {
        await call.answer(String(Reflect.get(value, 'sdp')));
      } else if (type === 'candidate') {
        const candidate = candidateOf(Reflect.get(value, 'candidate'));
        if (candidate !== undefined) {
          await call.candidate(candidate);
        }
      }
    },
    close(ws) {
      calls.get(ws.id)?.close();
      calls.delete(ws.id);
    },
  });
}
