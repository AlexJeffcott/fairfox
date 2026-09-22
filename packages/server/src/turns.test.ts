import { $serverState } from '@fairfox/polly/state';
import { beforeEach, expect, test } from 'bun:test';
import { turnRoutes, turns } from './turns.ts';

// Read when the module is first loaded, before any test resets it.
const initial = turns.value;

beforeEach(() => {
  turns.value = { taken: 0 };
});

async function takeTurn(): Promise<{ status: number; body: unknown }> {
  const response = await turnRoutes.handle(new Request('http://localhost/turn', { method: 'POST' }));
  return { status: response.status, body: await response.json() };
}

test('no turn is taken at first', () => {
  expect(initial).toEqual({ taken: 0 });
});

test('the turns are the server state polly names turns', () => {
  expect($serverState('turns', { taken: 5 })).toBe(turns);
});

test('three calls to POST /turn take one turn', async () => {
  const statuses: number[] = [];
  for (let call = 0; call < 3; call++) {
    statuses.push((await takeTurn()).status);
  }
  expect({ taken: turns.value.taken, statuses }).toEqual({ taken: 1, statuses: [200, 409, 409] });
});

test('each answer says how many turns are taken', async () => {
  const answers = [await takeTurn(), await takeTurn(), await takeTurn()];
  expect(answers).toEqual([
    { status: 200, body: { taken: 1 } },
    { status: 409, body: { taken: 1 } },
    { status: 409, body: { taken: 1 } },
  ]);
});
