/**
 * Two-device mesh sync verification — the CLI-originated pairing flow.
 *
 * @covers: agenda:main, mesh:users, mesh:devices, mesh:meta
 *
 * Since the pairing redesign, starting a mesh is a CLI-only act and the
 * browser's only onboarding door is "Join a mesh". This script proves
 * the whole flow end-to-end, the way a real user hits it:
 *
 *   1. `fairfox init` on a disposable HOME creates a fresh mesh + admin.
 *   2. `fairfox pair open` shows a transport-only join QR and holds the
 *      signalling socket open as a live mesh peer.
 *   3. A headless Chrome opens the join URL printed by the CLI. Its
 *      hash consumer pairs, receives the admin identity *encrypted over
 *      the relay's pair-ack* (never on the QR), and reloads into the
 *      paired agenda.
 *   4. The browser creates a chore.
 *   5. The chore reaches the CLI peer over the real WebRTC data channel;
 *      `fairfox agenda list` (read-only, safe alongside `pair open`)
 *      confirms it. After SIGINT-ing `pair open`, a final list read is
 *      the authoritative post-flush assertion.
 *
 * This exercises the CLI-issuer → browser-scanner half of the redesign
 * plus the encrypted identity hand-off and real cross-process WebRTC
 * sync. A screenshot of the synced chore lands in scripts/artifacts/.
 * Exits non-zero on failure.
 *
 *   bun scripts/e2e-two-device-sync.ts                # prod
 *   TARGET_URL=http://localhost:3000/agenda bun scripts/e2e-two-device-sync.ts
 *   HEADLESS=false bun scripts/e2e-two-device-sync.ts # watch it run
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  MESH_SYNC_TIMEOUT_MS,
  PAIR_CEREMONY_TIMEOUT_MS,
  SHORT_TIMEOUT_MS,
  sleep,
  waitFor,
  waitForText,
} from './e2e-config.ts';

const TARGET_URL = process.env.TARGET_URL ?? 'https://fairfox.fly.dev/agenda';
const ORIGIN = new URL(TARGET_URL).origin;
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(ARTIFACTS, 'profiles');
const TEST_HOME = '/tmp/fairfox-test-e2e-sync';
// The bundled fairfox.js collapses @fairfox/polly to one instance, the
// way prod does; running from source can produce two copies. Always
// rebuild fresh — see packages/cli/CLAUDE.md.
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');

const TRACE = (label: string, msg: string): void => {
  console.log(`[${label}] ${msg}`);
};

rmSync(PROFILES, { recursive: true, force: true });
rmSync(TEST_HOME, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(TEST_HOME, { recursive: true });

function buildBundle(): string {
  TRACE('cli', 'building packages/cli/dist/fairfox.js');
  const build = spawnSync('bun', ['run', 'build.ts'], {
    cwd: resolve(import.meta.dir, '..', 'packages', 'cli'),
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    throw new Error(`cli build failed (exit ${build.status ?? '?'})`);
  }
  if (!existsSync(BUILT_BUNDLE)) {
    throw new Error(`cli build did not produce ${BUILT_BUNDLE}`);
  }
  return BUILT_BUNDLE;
}

const CLI_ENV = {
  ...process.env,
  HOME: TEST_HOME,
  FAIRFOX_URL: ORIGIN,
  NODE_NO_WARNINGS: '1',
};

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('bun', [BUILT_BUNDLE, ...args], {
    env: CLI_ENV,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

// A freshly-paired device's write capability settles a beat after the
// post-pair reload (selfHeal writes the endorsement); the create click
// is retried until then, so transient `agenda.write` blocks are
// expected. If the permission never settles the chore never syncs and
// the run fails on that — this allowlist only silences the noise, it
// cannot mask the real assertion.
const CONSOLE_NOISE_ALLOWLIST: RegExp[] = [/\[policy\] blocked .* agenda\.write/];

interface DeviceHandle {
  browser: Browser;
  page: Page;
  consoleProblems: { level: 'warning' | 'error'; text: string }[];
}

async function launchBrowser(label: string): Promise<DeviceHandle> {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: resolve(PROFILES, label),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 900 });
  const consoleProblems: DeviceHandle['consoleProblems'] = [];
  page.on('pageerror', (err) => {
    TRACE(`${label}-pageerror`, err.message);
    consoleProblems.push({ level: 'error', text: err.message });
  });
  page.on('console', (m) => {
    const text = m.text();
    const type = m.type();
    if (type === 'error' || type === 'warning') {
      if (!CONSOLE_NOISE_ALLOWLIST.some((re) => re.test(text))) {
        TRACE(`${label}-console-${type}`, text);
        consoleProblems.push({ level: type, text });
      }
    } else {
      TRACE(`${label}-console`, text);
    }
  });
  return { browser, page, consoleProblems };
}

buildBundle();

// 1 — fresh mesh on the disposable HOME.
TRACE('cli', `init mesh (origin ${ORIGIN})`);
const init = runCli(['init', 'e2e sync mesh', '--admin', 'Desktop']);
if (init.status !== 0) {
  TRACE('cli', init.stdout.trim());
  TRACE('cli', init.stderr.trim());
  throw new Error('fairfox init failed');
}
TRACE('cli', 'mesh created, admin "Desktop"');

// 2 — `pair open` as a long-lived peer; capture the join URL it prints.
TRACE('cli', 'pair open — holding a join QR');
const pairOpen: ChildProcess = spawn('bun', [BUILT_BUNDLE, 'pair', 'open'], { env: CLI_ENV });
let pairOpenOut = '';
pairOpen.stdout?.on('data', (chunk: Buffer) => {
  pairOpenOut += chunk.toString();
});
pairOpen.stderr?.on('data', (chunk: Buffer) => {
  pairOpenOut += chunk.toString();
});

let pairOpenExited = false;
pairOpen.on('exit', () => {
  pairOpenExited = true;
});

const desktopBrowser = await launchBrowser('desktop');
let ok = false;

try {
  const joinUrl = await waitFor(
    () => {
      const match = pairOpenOut.match(/https?:\/\/\S*#pair=\S+/);
      return match ? match[0] : undefined;
    },
    { timeoutMs: SHORT_TIMEOUT_MS, description: 'join URL from `pair open`' }
  );
  // The CLI builds the URL at the origin root; point the browser at the
  // agenda route so it lands there after the post-pair reload.
  const browserJoinUrl = joinUrl.replace(/\/#pair=/, '/agenda#pair=');
  TRACE('cli', `join URL captured (${joinUrl.length} chars)`);

  // 3 — the browser joins. consumePairingHash pairs, waits for the
  // encrypted identity over pair-ack, applies it, and reloads.
  TRACE('browser', 'open the join URL');
  await desktopBrowser.page.goto(browserJoinUrl, { waitUntil: 'domcontentloaded' });
  await waitForText(desktopBrowser.page, 'Agenda', PAIR_CEREMONY_TIMEOUT_MS);
  TRACE('browser', 'paired — agenda visible');

  // DIAGNOSTIC — did the encrypted identity hand-off land?
  const identityState = await desktopBrowser.page.evaluate(async () => {
    try {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('fairfox-user-identity', 1);
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
      return val ? `present (${val.displayName ?? '?'})` : 'ABSENT';
    } catch (err) {
      return `read failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
  TRACE('browser', `user identity in IDB: ${identityState}`);
  TRACE('cli', `pair-open log so far:\n${pairOpenOut.trim()}`);

  // Let the WebRTC data channel to the CLI peer settle before writing.
  await sleep(5000);

  // 4 — type a chore. polly's ActionInput starts as a view-mode div; a
  // click promotes it into an editable input.
  await desktopBrowser.page.click('button[data-action="agenda.tab"][data-action-id="items"]');
  await desktopBrowser.page.waitForSelector('[data-polly-action-input]', {
    timeout: SHORT_TIMEOUT_MS,
  });
  const chore = `e2e-sync-${Date.now()}`;
  TRACE('browser', `add chore "${chore}"`);
  await desktopBrowser.page.click('[data-polly-action-input][data-state="empty"]');
  await desktopBrowser.page.waitForSelector(
    'input[data-polly-action-input], textarea[data-polly-action-input]',
    { timeout: SHORT_TIMEOUT_MS }
  );
  const input = await desktopBrowser.page.$(
    'input[data-polly-action-input], textarea[data-polly-action-input]'
  );
  if (!input) {
    throw new Error('no add-chore input');
  }
  await input.focus();
  await sleep(100);
  await desktopBrowser.page.keyboard.type(chore);
  await desktopBrowser.page.keyboard.press('Tab');
  await sleep(200);

  // 5 — create the chore and wait for it to converge to the CLI peer.
  // A freshly-paired device's write capability settles asynchronously
  // (mesh-gate's selfHeal writes the device endorsement after the
  // post-pair reload), so the create click is retried until the chore
  // actually lands in the mesh doc. `agenda list` is read-only
  // (openMeshClientReadOnly), safe to poll while `pair open` holds the
  // mesh.
  TRACE('cli', 'create + wait for the chore to converge to the CLI peer');
  try {
    await waitFor(
      async () => {
        await desktopBrowser.page
          .click('button[data-action="item.create-from-draft"]')
          .catch(() => undefined);
        await sleep(1500);
        return runCli(['agenda', 'list']).stdout.includes(chore);
      },
      { timeoutMs: MESH_SYNC_TIMEOUT_MS, intervalMs: 0, description: 'chore in `agenda list`' }
    );
    ok = true;
  } catch {
    ok = false;
  }

  await desktopBrowser.page.screenshot({
    path: resolve(ARTIFACTS, 'desktop.png'),
    fullPage: true,
  });

  // Close the live peer; on SIGINT it flushes storage on the way out.
  TRACE('cli', 'closing `pair open`');
  pairOpen.kill('SIGINT');
  await waitFor(() => pairOpenExited, {
    timeoutMs: SHORT_TIMEOUT_MS,
    description: '`pair open` exit',
  }).catch(() => {
    pairOpen.kill('SIGKILL');
  });

  // Authoritative post-flush read.
  const finalList = runCli(['agenda', 'list']);
  if (!finalList.stdout.includes(chore)) {
    ok = false;
    TRACE('cli', `final agenda list:\n${finalList.stdout.trim()}`);
    TRACE('cli', `peers:\n${runCli(['peers']).stdout.trim()}`);
    TRACE('cli', `users:\n${runCli(['users']).stdout.trim()}`);
    throw new Error(`chore "${chore}" never reached the CLI peer`);
  }
  ok = true;

  const consoleProblems = desktopBrowser.consoleProblems;
  if (consoleProblems.length > 0) {
    ok = false;
    const summary = consoleProblems.map((p) => `  [${p.level}] ${p.text}`).join('\n');
    throw new Error(
      `chore synced but ${consoleProblems.length} unexpected console message(s) appeared — extend CONSOLE_NOISE_ALLOWLIST if a match is genuinely benign:\n${summary}`
    );
  }

  TRACE('result', `SUCCESS — "${chore}" synced browser → CLI over WebRTC`);
  TRACE('result', `screenshot at ${resolve(ARTIFACTS, 'desktop.png')}`);
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await desktopBrowser.page.screenshot({
      path: resolve(ARTIFACTS, 'desktop-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort on the error screenshot
  }
} finally {
  if (!pairOpenExited) {
    pairOpen.kill('SIGKILL');
  }
  await desktopBrowser.browser.close();
}

process.exit(ok ? 0 : 1);
