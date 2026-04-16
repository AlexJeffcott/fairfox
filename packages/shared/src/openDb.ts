// LEGACY — this module exists only for packages/todo and packages/struggle
// during the transition period. It will be deleted when those packages are
// rebuilt on the meshState baseline (Phase 7, ADR 0006). New sub-apps must
// NOT import this; the check-mesh-state.ts conformance script will flag it.

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { loadEnv } from './env.ts';

export function openDb(name: string): Database {
  const env = loadEnv();
  if (!env.DATA_DIR) {
    throw new Error('[openDb] DATA_DIR is required for legacy sub-apps but is not set.');
  }
  return new Database(join(env.DATA_DIR, name), { create: true });
}
