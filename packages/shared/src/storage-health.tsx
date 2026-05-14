/** @jsxImportSource preact */
// StorageHealthBanner — polly#107 follow-through.
//
// Polly 0.61.0 bounds the storage-touching awaits inside
// `buildHandleFactory` with a 5s timeout and populates
// `meshStateModule.storageOpenError` when the underlying IndexedDB
// hangs (zombie connection from a previous renderer crash, blocked
// versionchange, transaction deadlock). Without this banner the
// user sees an indefinitely-loading SPA with no recovery path; with
// it they see a named failure and a one-click clear.
//
// The banner deliberately offers no dismiss button — the SPA cannot
// actually do anything useful until the storage layer is unwedged,
// and dismissing the warning would only leave the user staring at a
// silent broken app.

import { signal } from '@preact/signals';
import { mesh } from '#src/ensure-mesh.ts';

const POLL_INTERVAL_MS = 2_000;

interface StorageOpenError {
  operation: string;
  documentId: string;
  timeoutMs: number;
  elapsedMs: number;
  message: string;
}

const storageError = signal<StorageOpenError | null>(null);

let pollInstalled = false;

/** Start the snapshot poll as a singleton. Safe to call more than
 * once; subsequent calls are no-ops. Reads polly's own
 * `meshStateModule.storageOpenError` field — no fairfox-side
 * detection logic, just a render of what polly already knows. */
export function installStorageHealthPoll(): void {
  if (pollInstalled || typeof window === 'undefined') {
    return;
  }
  const m = mesh;
  if (!m) {
    return;
  }
  pollInstalled = true;
  const tick = (): void => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: polly's MeshClientPeerStateSnapshot type isn't re-exported through @fairfox/shared and the diagnostic boundary keeps it loose elsewhere too
      const snap: any = m.getPeerStateSnapshot();
      const err = snap?.meshStateModule?.storageOpenError;
      if (
        err &&
        typeof err === 'object' &&
        typeof err.operation === 'string' &&
        typeof err.documentId === 'string' &&
        typeof err.message === 'string'
      ) {
        storageError.value = {
          operation: err.operation,
          documentId: err.documentId,
          timeoutMs: typeof err.timeoutMs === 'number' ? err.timeoutMs : 0,
          elapsedMs: typeof err.elapsedMs === 'number' ? err.elapsedMs : 0,
          message: err.message,
        };
      } else {
        storageError.value = null;
      }
    } catch {
      // best-effort; a failing snapshot read isn't itself a storage
      // hang, just leave the previous value alone.
    }
  };
  tick();
  window.setInterval(tick, POLL_INTERVAL_MS);
}

export function StorageHealthBanner(): preact.JSX.Element | null {
  const err = storageError.value;
  if (!err) {
    return null;
  }
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '0.75rem 1.25rem',
        background: '#7f1d1d',
        color: '#fef2f2',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        fontSize: '0.85rem',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: '0.75rem',
        maxWidth: '40rem',
        zIndex: 9999,
      }}
    >
      <span>
        Local mesh storage is unresponsive ({err.operation} on{' '}
        <code>{err.documentId.slice(0, 12)}</code> hung for {Math.round(err.elapsedMs / 1000)}s).
        Clear local mesh storage and reload to recover; your keyring and identity stay paired.
      </span>
      <button
        type="button"
        data-action="app.clear-local-mesh"
        style={{
          background: '#f87171',
          color: '#7f1d1d',
          border: 'none',
          padding: '0.4rem 0.85rem',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Clear and reload
      </button>
    </div>
  );
}
