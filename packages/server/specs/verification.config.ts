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
    // two. Measured on 2026-09-22: 1,590,976 distinct states, where maxTabs 1
    // gave 6,344,512.
    maxClients: 1,
    // The handlers in the model: the anchored ones, each named here. polly
    // models every route of the package otherwise, and a route with no anchor
    // still multiplies the ways a message can be sent. GET /version, added
    // at the merge of step 0a, took the model from 1,590,976 distinct states
    // to 6,759,232 and TLC from 16 s to 66 s.
    include: ['POST /turn'],
  },
  // The rest of those states are polly's web-extension MessageRouter, and
  // polly 0.82.1 has no setting for any of it: three contexts (background,
  // content, popup), each port connecting and disconnecting, a payload of
  // id, text and userId over two values each that no handler reads, message
  // timeouts (TimeoutLimit 3), a clock, and a routing depth. A subsystem
  // generates the same router.
  verification: { workers: availableParallelism() },
  onBuild: 'error',
  onRelease: 'error',
});
