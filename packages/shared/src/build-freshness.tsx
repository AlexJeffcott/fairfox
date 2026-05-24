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

import { Button, Cluster, Surface, Text } from '@fairfox/polly/ui';
import { signal } from '@preact/signals';

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

async function fetchServerHash(): Promise<string | null> {
  try {
    const response = await fetch('/build-hash', { cache: 'no-store' });
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

let pollInstalled = false;

/** Start the server-hash poll as a singleton. Safe to call more than
 * once; subsequent calls are no-ops. The poll runs for the lifetime
 * of the page — there is no unmount — which matches the banner's
 * role as a global concern rather than a component-scoped effect. */
export function installBuildFreshnessPoll(): void {
  if (pollInstalled || typeof window === 'undefined') {
    return;
  }
  pollInstalled = true;
  if (bundleHash.value === null) {
    bundleHash.value = readBundleHash();
  }
  const tick = async (): Promise<void> => {
    const fresh = await fetchServerHash();
    if (fresh !== null) {
      serverHash.value = fresh;
    }
    setTimeout(() => {
      void tick();
    }, pollInterval());
  };
  void tick();
}

export function BuildFreshnessBanner(): preact.JSX.Element | null {
  const local = bundleHash.value;
  const remote = serverHash.value;
  const stale = local !== null && remote !== null && local !== remote;
  if (!stale || dismissed.value) {
    return null;
  }

  return (
    <Surface
      variant="floating"
      background="#1f2937"
      padding="var(--polly-space-sm) var(--polly-space-md)"
      radius="md"
      inset="auto auto var(--polly-space-md) 50%"
      transform="translateX(-50%)"
      scheme="dark"
    >
      <Cluster gap="var(--polly-space-sm)" align="center">
        <Text size="sm">A new version of fairfox is available.</Text>
        <Button
          label="Reload"
          tier="primary"
          color="warning"
          size="small"
          data-action="build-freshness.reload"
        />
        <Button
          label="Dismiss"
          tier="tertiary"
          size="small"
          data-action="build-freshness.dismiss"
        />
      </Cluster>
    </Surface>
  );
}
