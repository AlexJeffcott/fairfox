// WebRTC helpers shared by the step 0c checks that run werift.
import type { RTCPeerConnection } from 'werift';

/** Rejects when `promise` has not settled after `ms`: a limit, not a wait. */
export function within<T>(ms: number, what: string, promise: Promise<T>): Promise<T> {
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

/** The session description once every candidate is gathered: no trickle. */
export async function gathered(pc: RTCPeerConnection, label: string): Promise<{ type: 'offer' | 'answer'; sdp: string }> {
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
export function candidates(sdp: string): { line: string; relay: boolean }[] {
  return sdp
    .split(/\r?\n/)
    .filter((line) => line.startsWith('a=candidate:'))
    .map((line) => ({ line, relay: / typ relay( |$)/.test(line) }));
}
