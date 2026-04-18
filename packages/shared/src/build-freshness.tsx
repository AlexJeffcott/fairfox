/** @jsxImportSource preact */
// BuildFreshnessBanner — watches the server for a new deploy and
// nudges the user to reload.
//
// On mount the component reads the build hash the server embedded in
// the HTML shell (<meta name="fairfox-build-hash" content="...">) and
// stores it as the baseline. It then polls `/build-hash` every
// POLL_INTERVAL_MS; if the returned hash ever diverges from the
// baseline, the banner renders a fixed-position strip at the bottom of
// the viewport with a reload button.
//
// The user-visible behaviour is deliberately passive. A deploy mid-
// session does not yank the page out from under someone who is mid-
// input; it announces itself, lets the user finish the thought, and
// only reloads when they ask. For cases where the client is
// compatible with the new server (mesh protocol additions are
// additive, for example) they can dismiss the banner and keep going.
//
// The poll uses `fetch` with `cache: "no-store"` so a stale CDN cache
// never fools the comparison. Network errors are treated as "still
// connected" — an offline tab shouldn't flash a "new version" banner.

import { signal, useSignalEffect } from '@preact/signals';
import { useEffect } from 'preact/hooks';

const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;
const META_SELECTOR = 'meta[name="fairfox-build-hash"]';

function pollInterval(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  const override = (window as unknown as { FAIRFOX_POLL_INTERVAL_MS?: unknown })
    .FAIRFOX_POLL_INTERVAL_MS;
  if (typeof override === 'number' && Number.isFinite(override) && override >= 100) {
    return override;
  }
  return DEFAULT_POLL_INTERVAL_MS;
}

const serverHash = signal<string | null>(null);
const bundleHash = signal<string | null>(null);
const dismissed = signal<boolean>(false);

/** Action registry fragment every sub-app spreads into its own
 * dispatcher. The banner's reload and dismiss buttons fire these
 * actions through the global event delegator rather than inline
 * handlers so the no-inline-handlers rule stays satisfied. */
export const buildFreshnessActions: Record<
  string,
  (ctx: { data: Record<string, string>; event: Event; element: HTMLElement }) => void
> = {
  'build-freshness.reload': () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  },
  'build-freshness.dismiss': () => {
    dismissed.value = true;
  },
};

function readBundleHash(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const meta = document.querySelector(META_SELECTOR);
  return meta?.getAttribute('content') ?? null;
}

async function fetchServerHash(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch('/build-hash', { cache: 'no-store', signal });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { hash?: unknown };
    return typeof data.hash === 'string' ? data.hash : null;
  } catch {
    // Offline or network blip — leave the previously-known hash alone.
    return null;
  }
}

export function BuildFreshnessBanner(): preact.JSX.Element | null {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    if (bundleHash.value === null) {
      bundleHash.value = readBundleHash();
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async (): Promise<void> => {
      const fresh = await fetchServerHash(controller.signal);
      if (fresh !== null) {
        serverHash.value = fresh;
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(() => {
          void tick();
        }, pollInterval());
      }
    };

    void tick();
    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  // Re-read the dismissal signal so the render reacts to it.
  useSignalEffect(() => {
    void dismissed.value;
  });

  const local = bundleHash.value;
  const remote = serverHash.value;
  const stale = local !== null && remote !== null && local !== remote;
  if (!stale || dismissed.value) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '0.5rem 1rem',
        background: '#1f2937',
        color: '#f9fafb',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        fontSize: '0.85rem',
        display: 'grid',
        gridAutoFlow: 'column',
        alignItems: 'center',
        gap: '0.75rem',
        zIndex: 9999,
      }}
    >
      <span>A new version of fairfox is available.</span>
      <button
        type="button"
        data-action="build-freshness.reload"
        style={{
          background: '#f59e0b',
          color: '#1f2937',
          border: 'none',
          padding: '0.35rem 0.75rem',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Reload
      </button>
      <button
        type="button"
        data-action="build-freshness.dismiss"
        style={{
          background: 'transparent',
          color: '#f9fafb',
          border: '1px solid rgba(249,250,251,0.3)',
          padding: '0.35rem 0.5rem',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '0.8rem',
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
