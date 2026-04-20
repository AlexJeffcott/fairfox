// Custom-frame subscription — thin fan-out on top of polly's signalling
// `onCustomFrame` hook so multiple modules can subscribe without
// stepping on each other's callbacks.
//
// Polly lets one consumer register one `onCustomFrame` callback at
// client construction. Fairfox wants the pairing wizard, future
// presence pings, and anything else that layers a protocol on the
// signalling socket to each own their own listener. The pattern is a
// simple subscribe/unsubscribe registry; every incoming custom frame
// is handed to every registered listener, which filter by `type`
// themselves.

export interface CustomFrame {
  type: string;
  [key: string]: unknown;
}

type Listener = (frame: CustomFrame) => void;

const listeners = new Set<Listener>();

export function dispatchCustomFrame(frame: CustomFrame): void {
  for (const listener of listeners) {
    try {
      listener(frame);
    } catch {
      // A thrown listener doesn't block the rest. Pairing, presence
      // etc. are loosely coupled.
    }
  }
}

export function subscribeCustomFrames(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
