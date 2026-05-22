/**
 * UI screenshot + horizontal-overflow audit harness.
 *
 * Pairs one puppeteer device against a local fairfox server, then
 * walks every SPA route at a narrow phone viewport (default 350px —
 * the documented minimum) and, for each:
 *   - probes for horizontal overflow (scrollWidth > clientWidth) and
 *     lists the DOM elements whose box extends past the viewport,
 *   - writes a full-page screenshot.
 * The chat widget is captured separately with injected demo data so
 * the message thread, context strip, and header buttons are all
 * exercised.
 *
 * The profile dir is persistent: the first run does the full CLI
 * pairing ceremony, later runs reuse the paired IndexedDB and skip
 * straight to screenshots — so the fix/screenshot loop is fast.
 *
 *   bun scripts/ui-screenshots.ts before          # baseline
 *   bun scripts/ui-screenshots.ts after           # after fixes
 *   WIDTH=350 HEADLESS=false bun scripts/ui-screenshots.ts before
 *   REPAIR=1 bun scripts/ui-screenshots.ts before # force re-pair
 *
 * Output: scripts/artifacts/ui/<label>/<route>.png + overflow.json
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  delay,
  PAIR_CEREMONY_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  SHORT_TIMEOUT_MS,
  waitFor,
  waitForText,
} from './e2e-config.ts';

const LABEL = process.argv[2] ?? 'shot';
const TARGET = process.env.TARGET_URL ?? 'http://localhost:3000';
const WIDTH = Number(process.env.WIDTH ?? '350');
const HEADLESS = process.env.HEADLESS !== 'false';
const FORCE_REPAIR = process.env.REPAIR === '1';

const TEST_HOME = '/tmp/fairfox-ui-screenshots';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts', 'ui', LABEL);
const PROFILE = resolve(import.meta.dir, 'artifacts', 'profile-ui');
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');

// `ready` is a CSS selector that only resolves once the route's own
// UI has rendered — every sub-app with a Tabs strip exposes
// `[data-polly-tabs]`; the two without one (docs, chat history) get a
// route-unique `data-action` button instead.
const ROUTES: readonly { path: string; name: string; ready: string }[] = [
  { path: '/', name: 'hub', ready: '[data-action="home.tab"]' },
  { path: '/todo-v2', name: 'todo-v2', ready: '[data-action="todo.tab"]' },
  { path: '/agenda', name: 'agenda', ready: '[data-action="agenda.tab"]' },
  { path: '/library', name: 'library', ready: '[data-action="library.tab"]' },
  { path: '/docs', name: 'docs', ready: '[data-action="docs.create"]' },
  { path: '/chat', name: 'chat-history', ready: '[data-action="chat.history-toggle-archived"]' },
  {
    path: '/family-phone-admin',
    name: 'family-phone-admin',
    ready: '[data-action="directory.tab"]',
  },
  { path: '/speakwell', name: 'speakwell', ready: '[data-action="speakwell.tab"]' },
  { path: '/the-struggle', name: 'the-struggle', ready: '[data-action="game.tab"]' },
];

function trace(label: string, msg: string): void {
  console.log(`[${label}] ${msg}`);
}

// --- chat widget demo payload (URL #__inject overlay) -------------
// Stresses the widget: a long title, two context chips, a message
// with an unbreakable URL token, a long assistant paragraph with the
// metadata row, an errored reply (regenerate affordance), and an
// active Claude Code session with a long cwd.
const DEMO_CHAT_ID = 'ui-demo-chat';
const injectPayload = {
  chats: [
    {
      id: DEMO_CHAT_ID,
      title: 'Planning the kitchen renovation budget for next quarter',
      contextRefs: [
        { kind: 'task', id: 't-1', label: 'Buy splashback tiles' },
        { kind: 'project', id: 'p-1', label: 'Kitchen reno' },
      ],
    },
  ],
  messages: [
    {
      id: 'm-1',
      chatId: DEMO_CHAT_ID,
      sender: 'user',
      text: 'Can you check this link for tile prices https://example.com/very/long/path/that/will/not/wrap/kitchen-tiles-catalogue-2026',
      createdAt: '2026-05-20T09:00:00.000Z',
    },
    {
      id: 'm-2',
      chatId: DEMO_CHAT_ID,
      sender: 'assistant',
      text: 'Here is a longer reply that should wrap nicely inside the message bubble even on a narrow phone screen. It mentions a budget of roughly 4,200 and a few supplier options to compare before committing.',
      model: 'claude-sonnet-4-6',
      costUsd: 0.0123,
      durationMs: 4200,
      createdAt: '2026-05-20T09:00:05.000Z',
    },
    {
      id: 'm-3',
      chatId: DEMO_CHAT_ID,
      sender: 'user',
      text: 'Thanks!',
      createdAt: '2026-05-20T09:01:00.000Z',
    },
    {
      id: 'm-4',
      chatId: DEMO_CHAT_ID,
      sender: 'assistant',
      parentId: 'm-3',
      text: 'Something went wrong reaching the model.',
      error: { kind: 'timeout' },
      createdAt: '2026-05-20T09:01:10.000Z',
    },
  ],
  sessions: [
    {
      sessionId: 'ui-demo-session-0001',
      cwd: '/Users/example/projects/fairfox/packages/home/src/client',
      state: 'running',
      lastToolName: 'Edit',
    },
  ],
};

function injectHash(): string {
  const json = JSON.stringify(injectPayload);
  const b64 = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `#chat=${DEMO_CHAT_ID}&__inject=${b64}`;
}

// --- overflow probe -----------------------------------------------
interface OverflowReport {
  route: string;
  viewport: number;
  scrollWidth: number;
  overflowPx: number;
  offenders: { tag: string; cls: string; w: number; right: number; text: string }[];
}

async function probeOverflow(page: Page, route: string): Promise<OverflowReport> {
  const raw = await page.evaluate(() => {
    const docEl = document.documentElement;
    const vw = docEl.clientWidth;
    const offenders: { tag: string; cls: string; w: number; right: number; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        continue;
      }
      if (r.right > vw + 1 || r.left < -1) {
        const cls = typeof el.className === 'string' ? el.className : '';
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls,
          w: Math.round(r.width),
          right: Math.round(r.right),
          text: (el.textContent ?? '').trim().slice(0, 50),
        });
      }
    }
    return {
      vw,
      scrollWidth: docEl.scrollWidth,
      offenders: offenders.slice(0, 30),
    };
  });
  return {
    route,
    viewport: raw.vw,
    scrollWidth: raw.scrollWidth,
    overflowPx: raw.scrollWidth - raw.vw,
    offenders: raw.offenders,
  };
}

// --- CLI pairing helpers (mirrors e2e-chat-widget.ts) -------------
function buildCliBundle(): void {
  trace('build', 'packages/cli → dist/fairfox.js');
  const result = spawnSync('bun', ['run', 'build.ts'], {
    cwd: resolve(import.meta.dir, '..', 'packages', 'cli'),
    stdio: 'inherit',
  });
  if (result.status !== 0 || !existsSync(BUILT_BUNDLE)) {
    throw new Error(`cli build failed (exit ${result.status ?? '?'})`);
  }
}

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runCli(args: string[], env: Record<string, string>): Promise<CliResult> {
  return new Promise<CliResult>((res, rej) => {
    const proc = spawn('bun', [BUILT_BUNDLE, ...args], {
      env: { ...process.env, HOME: TEST_HOME, NODE_NO_WARNINGS: '1', ...env },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => {
      stdout += String(c);
    });
    proc.stderr.on('data', (c) => {
      stderr += String(c);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rej(new Error(`runCli timeout (${args.join(' ')})`));
    }, 60_000);
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      res({ stdout, stderr, status: code ?? (signal ? -1 : 0) });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      rej(err);
    });
  });
}

interface SubprocessHandle {
  proc: ChildProcess;
  stdout: string[];
}

function spawnCli(args: string[], env: Record<string, string>): SubprocessHandle {
  const proc = spawn('bun', [BUILT_BUNDLE, ...args], {
    env: { ...process.env, HOME: TEST_HOME, NODE_NO_WARNINGS: '1', ...env },
  });
  const stdout: string[] = [];
  proc.stdout?.on('data', (chunk) => {
    stdout.push(String(chunk));
  });
  proc.stderr?.on('data', (chunk) => {
    process.stderr.write(`  [cli] ${String(chunk)}`);
  });
  return { proc, stdout };
}

async function killAndWait(h: SubprocessHandle): Promise<void> {
  if (h.proc.exitCode !== null) {
    return;
  }
  h.proc.kill('SIGTERM');
  await new Promise<void>((res) => {
    const timer = setTimeout(() => res(), 3000);
    h.proc.once('exit', () => {
      clearTimeout(timer);
      res();
    });
  });
}

async function waitForLine(
  chunks: string[],
  pattern: RegExp,
  timeoutMs: number,
  label: string
): Promise<RegExpMatchArray> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = chunks.join('').match(pattern);
    if (match) {
      return match;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label}: pattern ${pattern} never appeared within ${timeoutMs}ms`);
}

async function isPaired(page: Page): Promise<boolean> {
  await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded' });
  try {
    await waitForText(page, 'fairfox', 8000);
    // The hub's Reload control is paired-only chrome.
    return (await page.$('[data-action="app.reload"]')) !== null;
  } catch {
    return false;
  }
}

async function pairDevice(page: Page): Promise<void> {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
  buildCliBundle();
  const cliEnv = { FAIRFOX_URL: TARGET };

  trace('cli', 'init "ui screenshots" --admin Laptop');
  const init = await runCli(['init', 'ui screenshots', '--admin', 'Laptop'], cliEnv);
  if (init.status !== 0) {
    throw new Error(`init exited ${init.status}\n${init.stdout}\n${init.stderr}`);
  }

  trace('cli', 'pair open — holding a join QR');
  const pairOpen = spawnCli(['pair', 'open'], cliEnv);
  try {
    const joinMatch = await waitForLine(
      pairOpen.stdout,
      /(https?:\/\/\S+#pair=\S+)/,
      SHORT_TIMEOUT_MS,
      'join URL'
    );
    const joinUrl = (joinMatch[1] ?? '').replace(/[)\].,]+$/, '');
    trace('phone', 'navigate join URL, pairing…');
    await page.goto(joinUrl, { waitUntil: 'domcontentloaded' });

    // The ceremony writes the identity to IndexedDB and then reloads;
    // poll the identity store, tolerating the reload tearing down the
    // evaluation context mid-flight.
    await waitFor(
      async () => {
        try {
          return await page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((res, rej) => {
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
          return '';
        }
      },
      { timeoutMs: PAIR_CEREMONY_TIMEOUT_MS, intervalMs: 1000, description: 'paired identity' }
    );
    await waitForText(page, 'fairfox', PAIR_CEREMONY_TIMEOUT_MS);
    trace('phone', 'paired');
  } finally {
    await killAndWait(pairOpen);
  }
}

// --- interaction helpers ------------------------------------------
/** Click the first button/link/tab whose trimmed text equals `text`. */
function clickByText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll('button, a, [role="tab"], [data-action]'));
    const el = els.find((e) => (e.textContent ?? '').trim() === t);
    if (el instanceof HTMLElement) {
      el.click();
      return true;
    }
    return false;
  }, text);
}

/** Navigate to a route and wait for its own UI to render — a CSS
 * selector that only resolves once the sub-app shell has mounted,
 * with a network-idle settle as a backstop. */
async function gotoRoute(page: Page, path: string, readySelector: string): Promise<void> {
  await page.goto(`${TARGET}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(readySelector, { timeout: SHORT_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForNetworkIdle({ timeout: SHORT_TIMEOUT_MS }).catch(() => undefined);
}

/** Click a polly Tabs tab by its label, then wait for that tab to
 * become the active one. The Tabs primitive marks the active button
 * with `aria-current="page"`, so this is a real render signal that
 * works for every sub-app's tab strip. Returns false if no tab with
 * that label exists. */
async function clickTab(page: Page, label: string): Promise<boolean> {
  const clicked = await clickByText(page, label);
  if (!clicked) {
    return false;
  }
  await page
    .waitForFunction(
      (t) => {
        const tabs = Array.from(document.querySelectorAll('[data-polly-tabs] button'));
        return tabs.some(
          (b) => (b.textContent ?? '').trim() === t && b.getAttribute('aria-current') === 'page'
        );
      },
      { timeout: SHORT_TIMEOUT_MS },
      label
    )
    .catch(() => undefined);
  return true;
}

/** Probe + screenshot + record a named view. */
async function capture(page: Page, name: string, reports: OverflowReport[]): Promise<void> {
  const report = await probeOverflow(page, name);
  reports.push(report);
  await page.screenshot({ path: resolve(ARTIFACTS, `${name}.png`), fullPage: true });
  const flag = report.overflowPx > 1 ? `OVERFLOW +${report.overflowPx}px` : 'ok';
  trace('probe', `${name}: ${flag} (scrollWidth ${report.scrollWidth})`);
}

/** Drive the agenda create-item form so the multi-column recurrence
 * and weekday pickers — invisible on an empty route — get captured. */
async function captureAgendaForm(page: Page, reports: OverflowReport[]): Promise<void> {
  trace('route', 'agenda Items tab + create form');
  await gotoRoute(page, '/agenda', '[data-action="agenda.tab"]');
  await clickTab(page, 'Items');
  // The Items tab renders the create form, whose first control is an
  // ActionInput.
  await page.waitForSelector('[data-polly-action-input]', { timeout: SHORT_TIMEOUT_MS });
  await capture(page, 'agenda-items', reports);

  // Reveal the 7-button weekday picker (recurrence = weekdays) and
  // the 4-button recurrence cluster — both wrap on a narrow phone.
  await clickByText(page, 'weekdays');
  // The weekday picker appears as a row of `draft.weekday` buttons.
  await page.waitForSelector('[data-action="draft.weekday"]', { timeout: SHORT_TIMEOUT_MS });
  await capture(page, 'agenda-create-weekdays', reports);

  // Fairness tab — window buttons + per-person score rows.
  if (await clickTab(page, 'Fairness')) {
    await page.waitForSelector('[data-action="fairness.window"]', { timeout: SHORT_TIMEOUT_MS });
    await capture(page, 'agenda-fairness', reports);
  }
}

/** Capture the-struggle Memory tab and the speakwell History tab —
 * surfaces the route loop only sees in their empty default tab. A
 * speakwell session is created first so History has a real row.
 * (the-struggle's Story view needs authored `struggle:story`
 * content, which a fresh test mesh has none of.) */
async function captureStruggleSpeakwell(page: Page, reports: OverflowReport[]): Promise<void> {
  trace('route', 'the-struggle Memory tab');
  await gotoRoute(page, '/the-struggle', '[data-action="game.tab"]');
  if (await clickTab(page, 'Memory')) {
    await capture(page, 'the-struggle-memory', reports);
  }

  // the-struggle story editor — chapter list, chapter editor, and
  // passage editor (with a choice), each driven through the real
  // create flow.
  trace('route', 'the-struggle Edit tab');
  if (await clickTab(page, 'Edit')) {
    // The Edit tab opens on the chapter list — its create button.
    await page.waitForSelector('[data-action="chapter.create"]', { timeout: SHORT_TIMEOUT_MS });
    await capture(page, 'struggle-edit-chapters', reports);
    if (await clickByText(page, '+ New chapter')) {
      // chapter.create opens the chapter editor; its title ActionInput
      // is the marker.
      await page.waitForSelector('[data-polly-action-input][aria-label="Chapter title"]', {
        timeout: SHORT_TIMEOUT_MS,
      });
      await capture(page, 'struggle-edit-chapter', reports);
      if (await clickByText(page, '+ New passage')) {
        // passage.create opens the passage editor; its title
        // ActionInput is the marker.
        await page.waitForSelector('[data-polly-action-input][aria-label="Passage title"]', {
          timeout: SHORT_TIMEOUT_MS,
        });
        await clickByText(page, '+ New choice');
        // choice.create appends a choice row carrying a delete button.
        await page.waitForSelector('[data-action="choice.delete"]', { timeout: SHORT_TIMEOUT_MS });
        await capture(page, 'struggle-edit-passage', reports);
      }
    }
  }

  trace('route', 'speakwell — start a session, capture History');
  await gotoRoute(page, '/speakwell', '[data-action="speakwell.tab"]');
  if ((await page.$$('[data-action="speakwell.tab"]')).length > 0) {
    try {
      await fillActionInput(
        page,
        '[data-polly-action-input]',
        'Pitching the kitchen renovation idea to the family'
      );
      await page.keyboard.press('Tab');
    } catch {
      // topic is optional — proceed without it
    }
    // `session.start` appends a session to the mesh doc but leaves the
    // Start view mounted, so there is no post-Begin DOM signal here —
    // the new session surfaces once the History tab renders its row.
    await clickByText(page, 'Begin');
    if (await clickTab(page, 'History')) {
      // A populated History list renders one info Badge per session.
      await page
        .waitForSelector('[data-polly-badge]', { timeout: SHORT_TIMEOUT_MS })
        .catch(() => undefined);
      await capture(page, 'speakwell-history', reports);
    }
  }
}

/** Focus an ActionInput (a click promotes its view-mode div to an
 * editable input/textarea) and type into it. The click triggers a
 * Preact re-render plus an effect that calls `.focus()` on the new
 * field, so we wait until the live `<input>`/`<textarea>` is actually
 * the document's active element before typing — otherwise keystrokes
 * land nowhere. */
async function fillActionInput(page: Page, selector: string, text: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: SHORT_TIMEOUT_MS });
  await page.click(selector);
  await page.waitForFunction(
    () => {
      const el = document.activeElement;
      return (
        el !== null &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
        el.getAttribute('data-polly-action-input') !== null
      );
    },
    { timeout: SHORT_TIMEOUT_MS }
  );
  await page.keyboard.type(text);
}

/** Seed each sub-app with a few realistic rows through its real
 * in-app create flow, so the screenshot pass exercises populated
 * list rows rather than empty states — the gap that let a
 * list-row layout regression ship. Idempotent: a sub-app that
 * already has content is skipped. Best-effort: a failure in one
 * sub-app is logged and the rest continue. */
async function seedContent(page: Page): Promise<void> {
  // todo-v2 tasks — task.new opens the detail editor; fill the
  // description, then task.close returns to the list.
  try {
    await gotoRoute(page, '/todo-v2', '[data-action="todo.tab"]');
    await clickTab(page, 'Tasks');
    await page.waitForSelector('[data-action="task.new"]', { timeout: SHORT_TIMEOUT_MS });
    if ((await page.$$('[data-action="task.open"]')).length === 0) {
      const tasks = [
        'Buy splashback tiles and grout for the kitchen renovation before the weekend',
        'Call the plumber about the leak',
        'Review the quarterly budget',
      ];
      for (const desc of tasks) {
        await page.click('[data-action="task.new"]');
        // task.new opens the detail editor — its Description ActionInput.
        await fillActionInput(page, '[data-polly-action-input][aria-label="Description"]', desc);
        await page.keyboard.press('Tab');
        await page.click('[data-action="task.close"]');
        // task.close returns to the list, which carries the new-task button.
        await page.waitForSelector('[data-action="task.new"]', { timeout: SHORT_TIMEOUT_MS });
      }
      trace('seed', 'todo: 3 tasks');
    }
  } catch (err) {
    trace('seed', `todo tasks skipped: ${err instanceof Error ? err.message : err}`);
  }

  // todo-v2 projects.
  try {
    await gotoRoute(page, '/todo-v2', '[data-action="todo.tab"]');
    await clickTab(page, 'Projects');
    await page.waitForSelector('[data-action="project.new"]', { timeout: SHORT_TIMEOUT_MS });
    if ((await page.$$('[data-action="project.open"]')).length === 0) {
      for (const name of ['Kitchen renovation', 'Tax return 2026']) {
        await page.click('[data-action="project.new"]');
        // project.new opens the detail editor — its Name ActionInput.
        await fillActionInput(page, '[data-polly-action-input][aria-label="Name"]', name);
        await page.keyboard.press('Tab');
        await page.click('[data-action="project.close"]');
        // project.close returns to the list, which carries the new-project button.
        await page.waitForSelector('[data-action="project.new"]', { timeout: SHORT_TIMEOUT_MS });
      }
      trace('seed', 'todo: 2 projects');
    }
  } catch (err) {
    trace('seed', `todo projects skipped: ${err instanceof Error ? err.message : err}`);
  }

  // library refs — the create ActionInput commits on Enter.
  try {
    await gotoRoute(page, '/library', '[data-polly-action-input]');
    if ((await page.$$('[data-action="ref.open"]')).length === 0) {
      const titles = [
        'The Pragmatic Programmer',
        'A reference with a deliberately long title to check truncation on a narrow phone',
        'Dune',
      ];
      let expected = 0;
      for (const title of titles) {
        await fillActionInput(page, '[data-polly-action-input]', title);
        await page.keyboard.press('Enter');
        // Enter commits the ref; wait for the new row's open button to appear.
        expected += 1;
        await page.waitForFunction(
          (n) => document.querySelectorAll('[data-action="ref.open"]').length >= n,
          { timeout: SHORT_TIMEOUT_MS },
          expected
        );
      }
      trace('seed', 'library: 3 refs');
    }
  } catch (err) {
    trace('seed', `library skipped: ${err instanceof Error ? err.message : err}`);
  }

  // agenda items — type a name into the create form, pick daily so
  // it lands on Today, then Add.
  try {
    await gotoRoute(page, '/agenda', '[data-action="agenda.tab"]');
    await clickTab(page, 'Items');
    await page.waitForSelector('[data-action="draft.recurrence"]', { timeout: SHORT_TIMEOUT_MS });
    if ((await page.$$('[data-action="item.toggle-active"]')).length === 0) {
      let expected = 0;
      for (const name of ['Empty the dishwasher', 'Water the balcony plants']) {
        await fillActionInput(page, '[data-polly-action-input]', name);
        await page.keyboard.press('Tab');
        await clickByText(page, 'daily');
        // The daily recurrence button flips to the primary tier when selected.
        await page.waitForFunction(
          () => {
            const btns = Array.from(document.querySelectorAll('[data-action="draft.recurrence"]'));
            return btns.some(
              (b) =>
                (b.textContent ?? '').trim() === 'daily' &&
                b.getAttribute('data-polly-button') === 'primary'
            );
          },
          { timeout: SHORT_TIMEOUT_MS }
        );
        await clickByText(page, 'Add');
        // item.create-from-draft appends an item row carrying a toggle-active control.
        expected += 1;
        await page.waitForFunction(
          (n) => document.querySelectorAll('[data-action="item.toggle-active"]').length >= n,
          { timeout: SHORT_TIMEOUT_MS },
          expected
        );
      }
      trace('seed', 'agenda: 2 items');
    }
  } catch (err) {
    trace('seed', `agenda skipped: ${err instanceof Error ? err.message : err}`);
  }
}

// --- main ----------------------------------------------------------
async function main(): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  if (FORCE_REPAIR) {
    rmSync(PROFILE, { recursive: true, force: true });
  }

  const browser: Browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: PROFILE,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const reports: OverflowReport[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: 900 });
    page.on('pageerror', (err) => trace('pageerror', err.message));

    if (await isPaired(page)) {
      trace('pair', 'reusing paired profile');
    } else {
      trace('pair', 'device not paired — running ceremony');
      await pairDevice(page);
    }

    // Populate the sub-apps so the route captures show real list
    // rows, not empty states.
    await seedContent(page);

    for (const route of ROUTES) {
      trace('route', route.path);
      await gotoRoute(page, route.path, route.ready);
      await capture(page, route.name, reports);
    }

    // Hub Peers + Users + Help tabs (behind the home tab strip). Each
    // tab gets a tab-specific marker so the capture waits on real
    // rendered content, not a guess.
    trace('route', 'hub Peers / Users / Help tabs');
    await gotoRoute(page, '/', '[data-action="home.tab"]');
    if (await clickTab(page, 'Peers')) {
      // PeersView always renders the open-a-QR pairing button.
      await page
        .waitForSelector('[data-action="pairing.start-issue"]', { timeout: SHORT_TIMEOUT_MS })
        .catch(() => undefined);
      await capture(page, 'hub-peers', reports);
    }
    if (await clickTab(page, 'Users')) {
      // UsersView lists the mesh's users — the seed mesh has two, each
      // row carrying a revoke-peer control.
      await page
        .waitForSelector('[data-action="users.revoke-peer"]', { timeout: SHORT_TIMEOUT_MS })
        .catch(() => undefined);
      await capture(page, 'hub-users', reports);
    }
    if (await clickTab(page, 'Help')) {
      // HelpView renders a select-all-textarea control in its sections.
      await page
        .waitForSelector('[data-action="help.select-all-textarea"]', {
          timeout: SHORT_TIMEOUT_MS,
        })
        .catch(() => undefined);
      await capture(page, 'hub-help', reports);
    }

    // todo-v2 Projects tab (the route capture lands on Tasks).
    trace('route', 'todo-v2 Projects tab');
    await gotoRoute(page, '/todo-v2', '[data-action="todo.tab"]');
    if (await clickTab(page, 'Projects')) {
      await page
        .waitForSelector('[data-action="project.new"]', { timeout: SHORT_TIMEOUT_MS })
        .catch(() => undefined);
      await capture(page, 'todo-projects', reports);
    }

    // Drive the agenda create-item form.
    await captureAgendaForm(page, reports);

    // the-struggle Memory + speakwell History.
    await captureStruggleSpeakwell(page, reports);

    // Chat widget with injected demo data. A hash-only change does
    // not reload the document, so applyUrlHooks (module-load only)
    // would never see the #__inject payload — reload() forces it.
    trace('route', 'chat widget (injected demo)');
    await page.goto(`${TARGET}/agenda${injectHash()}`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The floating chat launcher always renders once the SPA mounts.
    await page
      .waitForSelector('[data-action="chat.toggle-widget"]', { timeout: SHORT_TIMEOUT_MS })
      .catch(() => undefined);
    const widgetBtn = await page.$('[data-action="chat.toggle-widget"]');
    if (widgetBtn) {
      // The inject hook opens the widget itself; click only if closed.
      const panelOpen = await page.$('[data-action="chat.close-widget"]');
      if (!panelOpen) {
        await widgetBtn.click();
      }
      // The open panel carries a Close control — wait for it before shooting.
      await page
        .waitForSelector('[data-action="chat.close-widget"]', { timeout: SHORT_TIMEOUT_MS })
        .catch(() => undefined);
    }
    await capture(page, 'chat-widget', reports);

    writeFileSync(resolve(ARTIFACTS, 'overflow.json'), `${JSON.stringify(reports, null, 2)}\n`);
  } finally {
    await browser.close().catch(() => undefined);
  }

  // Summary.
  console.log(`\n=== overflow summary (viewport ${WIDTH}px, label "${LABEL}") ===`);
  let anyOverflow = false;
  for (const r of reports) {
    if (r.overflowPx > 1) {
      anyOverflow = true;
      console.log(`  ✗ ${r.route}: +${r.overflowPx}px`);
      for (const o of r.offenders.slice(0, 6)) {
        console.log(`      <${o.tag}> w=${o.w} right=${o.right} "${o.text}"`);
      }
    } else {
      console.log(`  ✓ ${r.route}`);
    }
  }
  console.log(`\nScreenshots: ${ARTIFACTS}`);
  process.exit(anyOverflow ? 1 : 0);
}

await main();
