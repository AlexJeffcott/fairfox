/**
 * Browser-side helpers for the redesign-era pairing flow.
 *
 * Since the 2026-05 pairing redesign, starting a mesh is a CLI-only
 * act: `fairfox init` seeds the mesh, `fairfox pair open` issues a
 * transport-only join QR, and the browser's sole onboarding door is
 * "Join a mesh". A headless Chrome opens the join URL the CLI prints,
 * receives the identity it should adopt *encrypted over the relay's
 * pair-ack frame* (never on the QR), and reloads into the paired app.
 *
 * The CLI-side seeding — `buildBundle`, `runCli`, `spawnCli`,
 * `waitForLine` — lives in `e2e-cli-helpers.ts`. This module owns only
 * what runs in the browser, so every redesign-era e2e drives the join
 * half through one code path rather than an inline copy each. The
 * canonical end-to-end script that wires both halves together is
 * `e2e-two-device-sync.ts`.
 */

import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { PAIR_CEREMONY_TIMEOUT_MS, waitFor, waitForText } from './e2e-config.ts';

export interface BrowserHandle {
  browser: Browser;
  page: Page;
}

/** Launch a headless (or headed) Chrome on an isolated profile so the
 * browser starts from the cold state a fresh device sees — empty
 * IndexedDB keyring, no user identity. `pageerror`s are traced so a
 * crash in the SPA surfaces in the test log. */
export async function launchBrowser(
  label: string,
  profilesDir: string,
  headless: boolean
): Promise<BrowserHandle> {
  const browser = await puppeteer.launch({
    headless,
    userDataDir: resolve(profilesDir, label),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 900 });
  page.on('pageerror', (err) => console.log(`[${label}-pageerror] ${err.message}`));
  return { browser, page };
}

/** The join URL `fairfox pair open` prints sits at the origin root
 * (`https://…/#pair=…`). Rewrite it so the post-pair reload lands on
 * a real sub-app route instead of the hub. */
function joinUrlForRoute(joinUrl: string, route: string): string {
  return joinUrl.replace(/\/#pair=/, `/${route.replace(/^\/+/, '')}#pair=`);
}

/**
 * Drive a fresh-profile browser through the join half of the
 * redesigned ceremony: open the join URL, wait for the encrypted
 * identity to land in IndexedDB, then wait for the post-pair reload to
 * settle on the paired app. Returns the display name the device
 * adopted — the issuer's own name for an "add my device" QR, the
 * invitee's name for a `pair open --user` QR.
 *
 * `consumePairingHash` renders the app the instant `knownPeerCount`
 * flips — before the identity lands — then applies the identity and
 * reloads. So the wait polls IndexedDB directly and tolerates the
 * reload destroying the evaluation context mid-poll.
 */
export async function joinMeshFromBrowser(
  page: Page,
  joinUrl: string,
  opts: { route?: string; settleText?: string } = {}
): Promise<string> {
  const route = opts.route ?? 'agenda';
  const settleText = opts.settleText ?? 'Agenda';
  await page.goto(joinUrlForRoute(joinUrl, route), { waitUntil: 'domcontentloaded' });

  const identityName = await waitFor(
    async () => {
      try {
        return await page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((res, rej) => {
            // Versionless open — the app's own openDb may have bumped
            // the DB past version 1 via its missing-store self-heal.
            const r = indexedDB.open('fairfox-user-identity');
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          const val = await new Promise<{ displayName?: string } | null>((res, rej) => {
            const rq = db
              .transaction('user-identity', 'readonly')
              .objectStore('user-identity')
              .get('default');
            rq.onsuccess = () => res(rq.result ?? null);
            rq.onerror = () => rej(rq.error);
          });
          return val?.displayName ?? '';
        });
      } catch {
        // Execution context destroyed mid-reload — retry.
        return '';
      }
    },
    {
      timeoutMs: PAIR_CEREMONY_TIMEOUT_MS,
      intervalMs: 1000,
      description: 'user identity applied on the browser',
    }
  );

  await waitForText(page, settleText, PAIR_CEREMONY_TIMEOUT_MS);
  return identityName;
}
