// The one handler of step 0a that carries polly verify's spec anchors. It is
// a stand-in with no business logic, there to show that polly verify is wired
// (step 0a). `createApp` does not mount it: it is not a route of the server.
// The first real anchors come with the first handlers that need them.
//
// The code refuses a second turn itself. `requires` and `ensures` are the
// anchors: the guard and the rule, written beside the code for polly verify,
// which turns them and the assignment into TLA+ and has TLC check the rule in
// every state the model reaches (specs/verification.config.ts). At run time
// both anchors do nothing, so polly checks the model and not the code:
// turns.test.ts tests the code.
import { $serverState } from '@fairfox/polly/state';
import { ensures, requires } from '@fairfox/polly/verify';
import { Elysia } from 'elysia';

/** How many turns have been taken. */
export const turns = $serverState('turns', { taken: 0 });

export const turnRoutes = new Elysia().post('/turn', ({ status }) => {
  if (turns.value.taken >= 1) {
    return status(409, { taken: turns.value.taken });
  }
  // The anchors are not mutated. polly 0.82.1's requires and ensures are empty
  // functions (`function requires(condition, message) {}`), so a mutant of
  // their arguments changes no answer, no state and no error: no test of the
  // route can tell it from the code. The anchors are checked by polly verify.
  // Stryker disable next-line all: an argument of an empty function
  requires(turns.value.taken < 1, 'a second turn is refused');
  turns.value = { taken: turns.value.taken + 1 };
  // Stryker disable next-line all: an argument of an empty function
  ensures(turns.value.taken <= 1, 'no more than one turn is taken');
  return { taken: turns.value.taken };
});
