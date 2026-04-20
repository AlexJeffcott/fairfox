// Strict-mode flag — drives whether `mesh:users` / `mesh:devices`
// reads reject unsigned rows outright (strict) or log a warning and
// pass them through (lenient). The default is lenient so existing
// paired-but-pre-user deployments keep working during migration;
// Phase G flips it on once every device has run through WhoAreYou.
//
// This is a deliberate two-step rollout: ship the verification code
// first, let it observe for a window, then flip the enforcement
// switch. Env-configurable at build time via `FAIRFOX_STRICT_MODE`
// so a deployment can go strict without a code change.

import { signal } from '@preact/signals';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

function initialFromEnv(): boolean {
  try {
    const raw = typeof process === 'undefined' ? undefined : process?.env?.FAIRFOX_STRICT_MODE;
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export const strictMode = signal<boolean>(initialFromEnv());

/** Turn strict mode on/off at runtime. Used by the e2e drill to
 * simulate the post-lenient-window deploy without waiting seven
 * actual days. */
export function setStrictMode(on: boolean): void {
  strictMode.value = on;
}

/** Log a lenient-mode violation with a consistent prefix so a
 * deploy-time grep can count "would have been rejected" events over
 * the lenient window and decide whether it's safe to flip strict. */
export function logLenientViolation(reason: string, context?: unknown): void {
  const payload = context === undefined ? '' : ` ${JSON.stringify(context)}`;
  console.warn(`[strict-mode lenient] ${reason}${payload}`);
}
