/**
 * Shared helper for e2e tests: clear the WhoAreYou identity wizard on a
 * fresh profile so the test proceeds to the pairing screen.
 *
 * Flow on a cold IndexedDB: LoginPage shows WhoAreYouView with an
 * ActionInput for the display name (`users.display-name-input`, saves on
 * blur) and a "Create my identity" button (`users.create-bootstrap`).
 * After bootstrap, `pendingRecoveryBlob` flips non-null and the user
 * must click "I've saved it — continue" (`users.dismiss-recovery-blob`).
 * Only then does the pairing screen's "This device isn't connected to
 * your mesh yet." header render.
 */

import type { Page } from 'puppeteer';
import { SHORT_TIMEOUT_MS, waitForText } from './e2e-config.ts';

async function clickByText(page: Page, text: string): Promise<void> {
  const handle = await page.evaluateHandle((t) => {
    const candidates = Array.from(document.querySelectorAll('button, a')) as HTMLElement[];
    return candidates.find((el) => (el.innerText || '').trim() === t) ?? null;
  }, text);
  const element = handle.asElement();
  if (!element) {
    throw new Error(`no clickable element with text "${text}"`);
  }
  await element.click();
}

/** Walk a fresh-profile page through the WhoAreYou wizard so it lands
 * on the pairing screen. No-op when an identity already exists — the
 * wizard never renders and the function returns as soon as the
 * pairing header text appears. */
function noop(_: string): void {
  // default trace sink when the caller doesn't provide one
}

export async function createIdentity(
  page: Page,
  displayName: string,
  trace: (msg: string) => void = noop
): Promise<void> {
  await waitForText(page, 'fairfox', SHORT_TIMEOUT_MS);

  // A profile that already has an identity skips WhoAreYou entirely.
  const needsBootstrap = await page.evaluate(() =>
    document.body.innerText.includes('First, tell fairfox who you are')
  );
  if (!needsBootstrap) {
    trace('identity already present, skipping bootstrap');
    return;
  }

  trace(`bootstrap identity "${displayName}"`);

  // Promote the ActionInput view-mode div into an editable input, type
  // the display name, then blur to commit via the saveOn="blur" path
  // configured on `users.display-name-input`.
  await page.waitForSelector('[data-polly-action-input]', { timeout: SHORT_TIMEOUT_MS });
  await page.click('[data-polly-action-input]');
  await page.waitForSelector('input[data-polly-action-input], textarea[data-polly-action-input]', {
    timeout: SHORT_TIMEOUT_MS,
  });
  const input = await page.$('input[data-polly-action-input], textarea[data-polly-action-input]');
  if (!input) {
    throw new Error('no display-name input on WhoAreYouView');
  }
  await input.type(displayName);
  // Tab out to fire blur and commit the value through the delegated
  // `users.display-name-input` handler.
  await input.press('Tab');

  await clickByText(page, 'Create my identity');
  await waitForText(page, 'Save this recovery blob', SHORT_TIMEOUT_MS);
  await clickByText(page, "I've saved it — continue");
}
