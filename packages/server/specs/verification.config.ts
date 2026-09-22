// polly verify (step 0a): the state the handlers write, and the bounds of the
// model TLC explores. `devctl verify` runs it from packages/server/, inside
// its time limit; the TLA+ it generates goes to specs/tla/generated/, which
// is not committed.
import { availableParallelism } from 'node:os';
import { defineVerification } from '@fairfox/polly/verify';

export default defineVerification({
  state: {
    // One past the rule's bound, so a state that breaks the rule is in the model.
    'turns.taken': { type: 'number', min: 0, max: 2 },
  },
  messages: {
    // Two messages in a behaviour: the fewest in which the guard of
    // src/turns.ts is what keeps its rule. With one, no state needs it.
    maxInFlight: 2,
    // One client, in place of maxTabs, which polly will not set below 1.
    // With it polly's generator models one tab: a quarter of the states of
    // two. Measured on 2026-09-22: 1.6 million distinct states, where
    // maxTabs 1 gave 6.3 million.
    maxClients: 1,
  },
  verification: { workers: availableParallelism() },
  onBuild: 'error',
  onRelease: 'error',
});
