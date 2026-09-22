// The one handler of step 0a that carries polly verify's spec anchors. It is
// a stand-in with no business logic, there to show that polly verify is wired
// (step 0a). `createApp` does not mount it: it is not a route of the server.
// The first real anchors come with the first handlers that need them.
//
// `requires` is the handler's guard and `ensures` is its rule, written beside
// it: one turn, never two. polly verify turns the guard, the assignment and
// the rule into TLA+, and TLC checks the rule in every state the handler can
// reach, over two messages (specs/verification.config.ts). Without the guard
// a second message takes a second turn. At runtime both are no-ops.
import { $serverState } from '@fairfox/polly/state';
import { ensures, requires } from '@fairfox/polly/verify';
import { Elysia } from 'elysia';

/** How many turns have been taken. */
export const turns = $serverState('turns', { taken: 0 });

export const turnRoutes = new Elysia().post('/turn', () => {
  requires(turns.value.taken < 1, 'a second turn is refused');
  turns.value = { taken: turns.value.taken + 1 };
  ensures(turns.value.taken <= 1, 'no more than one turn is taken');
  return { taken: turns.value.taken };
});
