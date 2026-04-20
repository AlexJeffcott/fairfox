// Shared timeout table and polling helpers for every e2e puppeteer
// script under scripts/. Centralising these means tuning one number
// when the fairfox server latency shifts under a new deploy, and
// every waiter in every script respects the same "deadline plus
// 200 ms tick" contract.
//
// Ordering rationale — shortest first:
//
//   POLL_INTERVAL_MS            tick between retries; human-fast
//   SHORT_TIMEOUT_MS            DOM text / element that should land
//                                without network involvement (e.g.
//                                post-render UI state)
//   NAV_TIMEOUT_MS              page.goto() / waitForNavigation()
//                                against a Railway cold start
//   PAIR_CEREMONY_TIMEOUT_MS    one-scan flow end-to-end (issuer
//                                reload → scanner reload → both
//                                paired-home visible)
//   MESH_SYNC_TIMEOUT_MS        CRDT convergence across two paired
//                                devices over WebRTC
//   SETTLE_MS                   short cushion between discrete flow
//                                steps so one event handler doesn't
//                                clip the next
//
// Override a single value per-run with an env var when debugging a
// flaky step — e.g. `MESH_SYNC_TIMEOUT_MS=60000 bun scripts/...`.
// Every script that imports from here picks up the override.

import type { Page } from 'puppeteer';

function env(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const POLL_INTERVAL_MS = env('E2E_POLL_INTERVAL_MS', 200);
export const SHORT_TIMEOUT_MS = env('E2E_SHORT_TIMEOUT_MS', 15_000);
export const NAV_TIMEOUT_MS = env('E2E_NAV_TIMEOUT_MS', 30_000);
export const PAIR_CEREMONY_TIMEOUT_MS = env('E2E_PAIR_CEREMONY_TIMEOUT_MS', 30_000);
export const MESH_SYNC_TIMEOUT_MS = env('E2E_MESH_SYNC_TIMEOUT_MS', 30_000);
export const SETTLE_MS = env('E2E_SETTLE_MS', 500);

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll an arbitrary predicate until it returns truthy or the deadline
 * elapses. The predicate may be synchronous or async. Returns the
 * value the predicate produced on the first successful tick. */
export async function waitFor<T>(
  predicate: () => T | PromiseLike<T>,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? SHORT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const description = options.description ?? 'condition';
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError instanceof Error ? ` (last error: ${lastError.message})` : '';
  throw new Error(`waitFor timed out after ${timeoutMs}ms: ${description}${suffix}`);
}

/** Wait for a body text substring to appear on the page. Uses the
 * shared short-timeout by default; callers override for longer waits
 * (e.g. `PAIR_CEREMONY_TIMEOUT_MS` for flows that cross a reload). */
export function waitForText(page: Page, text: string, timeoutMs?: number): Promise<boolean> {
  return waitFor(() => page.evaluate((t) => (document.body.innerText || '').includes(t), text), {
    timeoutMs,
    description: `body text "${text}"`,
  });
}

// TODO: swap to `@fairfox/polly/guards` once polly 0.29.2 is published
// and fairfox's catalog pin moves. The inline copy below keeps the
// build green in the interim — the shape matches polly's exports
// byte-for-byte so the swap is a one-line change.
/** Type guard: does `input` look like an object carrying its own
 * property named `key`? Uses `Object.hasOwn` so the check stays on
 * own properties only. Leaves the inner value as `unknown`. */
export function hasKeyInObject<K extends string>(
  input: unknown,
  key: K
): input is Record<K, unknown> {
  return typeof input === 'object' && input !== null && Object.hasOwn(input, key);
}

/** Type guard: narrow `input` to `Record<string, unknown>` when it's
 * a non-null, non-array object. */
export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
