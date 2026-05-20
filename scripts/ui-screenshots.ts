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
import { PAIR_CEREMONY_TIMEOUT_MS, SHORT_TIMEOUT_MS, sleep, waitForText } from './e2e-config.ts';

const LABEL = process.argv[2] ?? 'shot';
const TARGET = process.env.TARGET_URL ?? 'http://localhost:3000';
const WIDTH = Number(process.env.WIDTH ?? '350');
const HEADLESS = process.env.HEADLESS !== 'false';
const FORCE_REPAIR = process.env.REPAIR === '1';

const TEST_HOME = '/tmp/fairfox-ui-screenshots';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts', 'ui', LABEL);
const PROFILE = resolve(import.meta.dir, 'artifacts', 'profile-ui');
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');

const ROUTES: readonly { path: string; name: string; ready: string }[] = [
  { path: '/', name: 'hub', ready: 'fairfox' },
  { path: '/todo-v2', name: 'todo-v2', ready: '' },
  { path: '/agenda', name: 'agenda', ready: '' },
  { path: '/library', name: 'library', ready: '' },
  { path: '/docs', name: 'docs', ready: '' },
  { path: '/chat', name: 'chat-history', ready: 'Chat history' },
  { path: '/family-phone-admin', name: 'family-phone-admin', ready: '' },
  { path: '/speakwell', name: 'speakwell', ready: '' },
  { path: '/the-struggle', name: 'the-struggle', ready: '' },
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
    await sleep(250);
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

  trace('cli', 'mesh init --admin Laptop --user Phone:member');
  const init = await runCli(['init', '--admin', 'Laptop', '--user', 'Phone:member'], cliEnv);
  if (init.status !== 0) {
    throw new Error(`mesh init exited ${init.status}\n${init.stdout}\n${init.stderr}`);
  }

  trace('cli', 'add user phone (invite open)');
  const inviteOpen = spawnCli(['add', 'user', 'phone'], cliEnv);
  try {
    const shareMatch = await waitForLine(
      inviteOpen.stdout,
      /(https?:\/\/\S+#pair=\S+invite=\S+)/,
      SHORT_TIMEOUT_MS,
      'invite share URL'
    );
    const shareUrl = (shareMatch[1] ?? '').replace(/[)\].,]+$/, '');
    const fragment = shareUrl.split('#')[1] ?? '';
    const phoneUrl = `${TARGET}/#${fragment}`;
    trace('phone', 'navigate share URL, pairing…');
    await page.goto(phoneUrl, { waitUntil: 'domcontentloaded' });

    await waitForLine(
      inviteOpen.stdout,
      /✓\s+"phone"\s+paired/i,
      PAIR_CEREMONY_TIMEOUT_MS,
      'pair ack'
    );
    await waitForText(page, 'fairfox', PAIR_CEREMONY_TIMEOUT_MS);
    trace('phone', 'paired');
  } finally {
    await killAndWait(inviteOpen);
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
  await page.goto(`${TARGET}/agenda`, { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  await clickByText(page, 'Items');
  await sleep(800);
  await capture(page, 'agenda-items', reports);

  // Reveal the 7-button weekday picker (recurrence = weekdays) and
  // the 4-button recurrence cluster — both wrap on a narrow phone.
  await clickByText(page, 'weekdays');
  await sleep(600);
  await capture(page, 'agenda-create-weekdays', reports);

  // Fairness tab — window buttons + per-person score rows.
  if (await clickByText(page, 'Fairness')) {
    await sleep(700);
    await capture(page, 'agenda-fairness', reports);
  }
}

/** Focus an ActionInput (a click promotes it to an editable field)
 * and type into it. */
async function fillActionInput(page: Page, selector: string, text: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: SHORT_TIMEOUT_MS });
  await page.click(selector);
  await sleep(250);
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
    await page.goto(`${TARGET}/todo-v2`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    await clickByText(page, 'Tasks');
    await sleep(600);
    if ((await page.$$('[data-action="task.open"]')).length === 0) {
      const tasks = [
        'Buy splashback tiles and grout for the kitchen renovation before the weekend',
        'Call the plumber about the leak',
        'Review the quarterly budget',
      ];
      for (const desc of tasks) {
        await page.click('[data-action="task.new"]');
        await sleep(700);
        await fillActionInput(page, '[data-polly-action-input][aria-label="Description"]', desc);
        await page.keyboard.press('Tab');
        await sleep(400);
        await page.click('[data-action="task.close"]');
        await sleep(600);
      }
      trace('seed', 'todo: 3 tasks');
    }
  } catch (err) {
    trace('seed', `todo tasks skipped: ${err instanceof Error ? err.message : err}`);
  }

  // todo-v2 projects.
  try {
    await page.goto(`${TARGET}/todo-v2`, { waitUntil: 'domcontentloaded' });
    await sleep(800);
    await clickByText(page, 'Projects');
    await sleep(600);
    if ((await page.$$('[data-action="project.open"]')).length === 0) {
      for (const name of ['Kitchen renovation', 'Tax return 2026']) {
        await page.click('[data-action="project.new"]');
        await sleep(700);
        await fillActionInput(page, '[data-polly-action-input][aria-label="Name"]', name);
        await page.keyboard.press('Tab');
        await sleep(400);
        await page.click('[data-action="project.close"]');
        await sleep(600);
      }
      trace('seed', 'todo: 2 projects');
    }
  } catch (err) {
    trace('seed', `todo projects skipped: ${err instanceof Error ? err.message : err}`);
  }

  // library refs — the create ActionInput commits on Enter.
  try {
    await page.goto(`${TARGET}/library`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    if ((await page.$$('[data-action="ref.open"]')).length === 0) {
      const titles = [
        'The Pragmatic Programmer',
        'A reference with a deliberately long title to check truncation on a narrow phone',
        'Dune',
      ];
      for (const title of titles) {
        await fillActionInput(page, '[data-polly-action-input]', title);
        await page.keyboard.press('Enter');
        await sleep(600);
      }
      trace('seed', 'library: 3 refs');
    }
  } catch (err) {
    trace('seed', `library skipped: ${err instanceof Error ? err.message : err}`);
  }

  // agenda items — type a name into the create form, pick daily so
  // it lands on Today, then Add.
  try {
    await page.goto(`${TARGET}/agenda`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    await clickByText(page, 'Items');
    await sleep(600);
    if ((await page.$$('[data-action="item.toggle-active"]')).length === 0) {
      for (const name of ['Empty the dishwasher', 'Water the balcony plants']) {
        await fillActionInput(page, '[data-polly-action-input]', name);
        await page.keyboard.press('Tab');
        await sleep(300);
        await clickByText(page, 'daily');
        await sleep(300);
        await clickByText(page, 'Add');
        await sleep(900);
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
      await page.goto(`${TARGET}${route.path}`, { waitUntil: 'domcontentloaded' });
      if (route.ready) {
        await waitForText(page, route.ready, SHORT_TIMEOUT_MS).catch(() => undefined);
      }
      await sleep(1200);
      await capture(page, route.name, reports);
    }

    // Hub Peers + Users tabs (behind the home tab strip).
    trace('route', 'hub Peers / Users tabs');
    await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    if (await clickByText(page, 'Peers')) {
      await sleep(900);
      await capture(page, 'hub-peers', reports);
    }
    if (await clickByText(page, 'Users')) {
      await sleep(900);
      await capture(page, 'hub-users', reports);
    }
    if (await clickByText(page, 'Help')) {
      await sleep(900);
      await capture(page, 'hub-help', reports);
    }

    // todo-v2 Projects tab (the route capture lands on Tasks).
    trace('route', 'todo-v2 Projects tab');
    await page.goto(`${TARGET}/todo-v2`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    if (await clickByText(page, 'Projects')) {
      await sleep(800);
      await capture(page, 'todo-projects', reports);
    }

    // Drive the agenda create-item form.
    await captureAgendaForm(page, reports);

    // Chat widget with injected demo data. A hash-only change does
    // not reload the document, so applyUrlHooks (module-load only)
    // would never see the #__inject payload — reload() forces it.
    trace('route', 'chat widget (injected demo)');
    await page.goto(`${TARGET}/agenda${injectHash()}`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    const widgetBtn = await page.$('[data-action="chat.toggle-widget"]');
    if (widgetBtn) {
      // The inject hook opens the widget itself; click only if closed.
      const panelOpen = await page.$('[data-action="chat.close-widget"]');
      if (!panelOpen) {
        await widgetBtn.click();
      }
      await sleep(1500);
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
