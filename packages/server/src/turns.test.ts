import { beforeEach, expect, test } from 'bun:test';
import { turnRoutes, turns } from './turns.ts';

beforeEach(() => {
  turns.value = { taken: 0 };
});

test('three calls to POST /turn take one turn', async () => {
  const statuses: number[] = [];
  for (let call = 0; call < 3; call++) {
    const response = await turnRoutes.handle(new Request('http://localhost/turn', { method: 'POST' }));
    statuses.push(response.status);
  }
  expect({ taken: turns.value.taken, statuses }).toEqual({ taken: 1, statuses: [200, 409, 409] });
});
