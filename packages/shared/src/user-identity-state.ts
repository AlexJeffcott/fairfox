// User-identity signals — reactive view over the persisted
// UserIdentity in IndexedDB. `userIdentity` is the source of truth
// for "has this device's owner declared themselves yet?"; the login
// page consults it to decide whether to show the "Who are you?"
// wizard ahead of the pairing choices.
//
// Lives separate from pairing-state.ts so the user-identity /
// pairing split on the state side mirrors the user-identity.ts /
// pairing.ts split on the helpers side.

import { signal } from '@preact/signals';
import { loadUserIdentity, type UserIdentity } from '#src/user-identity.ts';

/** Loaded user identity, or null if the device's owner hasn't
 * declared themselves yet. `undefined` means the IDB load hasn't
 * resolved — the UI waits to render. */
export const userIdentity = signal<UserIdentity | null | undefined>(undefined);

/** Draft fields for the bootstrap / import wizards so the inputs
 * survive focus loss and re-renders. Split per-form so a half-typed
 * display name on the create screen isn't clobbered by a paste into
 * the recovery-blob form. */
export const displayNameDraft = signal<string>('');
export const recoveryBlobDraft = signal<string>('');
export const userSetupError = signal<string | null>(null);
/** Recovery blob shown to the user once right after bootstrap. They
 * have to save this somewhere — losing it means the user key is
 * unrecoverable if every device holding it is wiped. */
export const pendingRecoveryBlob = signal<string | null>(null);

/** Hydrate `userIdentity` from IndexedDB. Call from MeshGate on
 * mount; idempotent — only triggers an IDB read the first time. */
export async function hydrateUserIdentity(): Promise<void> {
  if (userIdentity.value !== undefined) {
    return;
  }
  try {
    const loaded = await loadUserIdentity();
    userIdentity.value = loaded ?? null;
  } catch {
    userIdentity.value = null;
  }
}
