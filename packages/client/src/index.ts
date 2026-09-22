import { treaty } from '@elysiajs/eden';
import type { App } from '@fairfox/server';

/** The one typed client (M9). The caller gives the origin; there is no default (C1, C4). */
export function createClient(origin: string) {
  return treaty<App>(origin);
}

export type Client = ReturnType<typeof createClient>;
