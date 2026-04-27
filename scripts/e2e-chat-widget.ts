/**
 * End-to-end of the chat widget round-trip — the surface a real
 * phone user touches. Covers what `e2e-chat-relay.ts` skips: the
 * widget Composer, the browser-side `chat.send` action, the WebRTC
 * delivery of a pending message to a separately-running CLI relay,
 * and the assistant reply rendering back into the widget.
 *
 * Three actors over the prod signalling relay (or a TARGET_URL
 * override):
 *
 *   1. Disposable HOME `/tmp/fairfox-test-chat-widget` runs the CLI
 *      admin "Laptop". `mesh init --admin Laptop --user Phone:member`
 *      bootstraps the admin and queues a Phone invite.
 *   2. `mesh invite open phone` opens the share URL on stdout.
 *   3. Puppeteer phone profile navigates the share URL; mesh-gate
 *      pairs and adopts the Phone user identity.
 *   4. The CLI relay (`chat serve` with FAIRFOX_CLAUDE_STUB) is then
 *      started in the same disposable HOME and waits for pending.
 *   5. The phone clicks 💬, types in the Composer, hits Send.
 *   6. The relay must log `[chat serve] processing` AND the assistant
 *      reply text must render in the phone's widget panel within
 *      MESH_SYNC_TIMEOUT_MS.
 *
 * Failure modes the test catches that the existing scripts do not:
 *   - Composer send writes a pending message that never replicates.
 *   - The migration wipe in `openChatDoc` deletes in-flight pendings.
 *   - The widget reads from a different doc id than the relay writes.
 *   - `chat.send`'s `derivePeerId().then` resolves with no peerId on
 *     fresh-paired browsers, silently swallowing the send.
 *
 *   bun scripts/e2e-chat-widget.ts                # prod
 *   TARGET_URL=http://localhost:3000/agenda HEADLESS=false bun \
 *     scripts/e2e-chat-widget.ts                  # watch it
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
// spawnSync is used only for the up-front cli build; runtime CLI
// invocations go through runCli (async) — spawnSync flakily returns
// status -1 with empty pipes when bun spawns bun under load.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  MESH_SYNC_TIMEOUT_MS,
  PAIR_CEREMONY_TIMEOUT_MS,
  SHORT_TIMEOUT_MS,
  sleep,
  waitForText,
} from './e2e-config.ts';

const TARGET = process.env.TARGET_URL ?? 'https://fairfox-production-8273.up.railway.app/agenda';
const HEADLESS = process.env.HEADLESS !== 'false';
const TEST_HOME = '/tmp/fairfox-test-chat-widget';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(import.meta.dir, 'artifacts', 'profiles-chat-widget');
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');
const STUB_REPLY = 'hi from the e2e stub';
const RELAY_READY_TIMEOUT_MS = 30_000;

function trace(label: string, msg: string): void {
  console.log(`[${label}] ${msg}`);
}

function buildBundle(): string {
  trace('build', 'building packages/cli/dist/fairfox.js');
  const result = spawnSync('bun', ['run', 'build.ts'], {
    cwd: resolve(import.meta.dir, '..', 'packages', 'cli'),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`cli build failed (exit ${result.status ?? '?'})`);
  }
  if (!existsSync(BUILT_BUNDLE)) {
    throw new Error(`cli build did not produce ${BUILT_BUNDLE}`);
  }
  return BUILT_BUNDLE;
}

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

async function runCli(args: string[], extra: Record<string, string> = {}): Promise<CliResult> {
  return await new Promise<CliResult>((res, rej) => {
    const proc = spawn('bun', [BUILT_BUNDLE, ...args], {
      env: { ...process.env, HOME: TEST_HOME, NODE_NO_WARNINGS: '1', ...extra },
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
      rej(new Error(`runCli timeout after 60s (${args.join(' ')})`));
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
  stderr: string[];
}

function spawnCli(args: string[], extra: Record<string, string> = {}): SubprocessHandle {
  const proc = spawn('bun', [BUILT_BUNDLE, ...args], {
    env: { ...process.env, HOME: TEST_HOME, NODE_NO_WARNINGS: '1', ...extra },
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  proc.stdout?.on('data', (chunk) => {
    const s = String(chunk);
    stdout.push(s);
    process.stdout.write(`  [${args.join(' ')} stdout] ${s}`);
  });
  proc.stderr?.on('data', (chunk) => {
    const s = String(chunk);
    stderr.push(s);
    process.stderr.write(`  [${args.join(' ')} stderr] ${s}`);
  });
  return { proc, stdout, stderr };
}

async function killAndWait(h: SubprocessHandle, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (h.proc.exitCode !== null) {
    return;
  }
  h.proc.kill(signal);
  await new Promise<void>((res) => {
    const timer = setTimeout(() => res(), 3000);
    h.proc.once('exit', () => {
      clearTimeout(timer);
      res();
    });
  });
}

async function launchProfile(label: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: resolve(PROFILES, label),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 480, height: 900 });
  page.on('pageerror', (err) => trace(`${label}-pageerror`, err.message));
  return { browser, page };
}

async function waitForLine(
  chunks: string[],
  pattern: RegExp,
  timeoutMs: number,
  label: string
): Promise<RegExpMatchArray> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const joined = chunks.join('');
    const match = joined.match(pattern);
    if (match) {
      return match;
    }
    await sleep(250);
  }
  throw new Error(`${label}: pattern ${pattern} never appeared within ${timeoutMs}ms`);
}

rmSync(PROFILES, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
rmSync(TEST_HOME, { recursive: true, force: true });
mkdirSync(TEST_HOME, { recursive: true });

buildBundle();

let phone: { browser: Browser; page: Page } | undefined;
let inviteOpen: SubprocessHandle | undefined;
let chatServe: SubprocessHandle | undefined;
let ok = false;
let failureReason = '';

try {
  // The CLI signals through FAIRFOX_URL's relay; default is prod.
  // For a localhost run, every CLI subprocess must point at the
  // same origin the phone is loading from, otherwise the
  // pair-return frame routes through one relay and the issuer
  // listens on another.
  const parsed = new URL(TARGET);
  const targetOrigin = parsed.origin;
  const targetPath = parsed.pathname || '/agenda';
  const cliEnv = { FAIRFOX_URL: targetOrigin };

  trace('cli', 'mesh init --admin Laptop --user Phone:member');
  const init = await runCli(
    ['mesh', 'init', '--admin', 'Laptop', '--user', 'Phone:member'],
    cliEnv
  );
  if (init.status !== 0) {
    throw new Error(
      `mesh init exited ${init.status}\nstdout:\n${init.stdout}\nstderr:\n${init.stderr}`
    );
  }

  trace('cli', 'mesh invite open phone');
  inviteOpen = spawnCli(['mesh', 'invite', 'open', 'phone'], cliEnv);
  const shareMatch = await waitForLine(
    inviteOpen.stdout,
    /(https?:\/\/\S+#pair=\S+invite=\S+)/,
    SHORT_TIMEOUT_MS,
    'invite-open share URL'
  );
  const shareUrlRaw = shareMatch[1] ?? '';
  // mesh invite open prints the URL inside terminal-formatted blocks
  // sometimes followed by trailing punctuation; trim known suffixes.
  const shareUrl = shareUrlRaw.replace(/[)\].,]+$/, '');
  trace('cli', `share url length ${shareUrl.length}`);

  // The phone navigates to TARGET's origin; the share URL fragment
  // (pair token + invite blob) is what matters. Both sides — phone
  // and CLI — connect through the same signalling origin via
  // FAIRFOX_URL set on every CLI subprocess.
  const sharedFragment = shareUrl.split('#')[1] ?? '';
  const phoneShareUrl = `${targetOrigin}${targetPath}#${sharedFragment}`;
  trace('phone', `navigate ${phoneShareUrl.slice(0, 80)}…`);

  phone = await launchProfile('phone');
  const phoneNav = phone.page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: PAIR_CEREMONY_TIMEOUT_MS,
  });
  await phone.page.goto(phoneShareUrl, { waitUntil: 'domcontentloaded' });
  await phoneNav.catch(() => undefined);

  trace('cli', 'wait for ✓ phone paired');
  await waitForLine(
    inviteOpen.stdout,
    /✓\s+"phone"\s+paired/i,
    PAIR_CEREMONY_TIMEOUT_MS,
    'invite-open pair ack'
  );

  trace('phone', 'wait for paired home (Agenda)');
  await waitForText(phone.page, 'Agenda', PAIR_CEREMONY_TIMEOUT_MS);

  trace('cli', 'kill mesh invite open');
  await killAndWait(inviteOpen);
  inviteOpen = undefined;

  trace('cli', `chat serve (stub="${STUB_REPLY}")`);
  chatServe = spawnCli(['chat', 'serve'], {
    ...cliEnv,
    FAIRFOX_CLAUDE_STUB: STUB_REPLY,
  });
  await waitForLine(
    chatServe.stdout,
    /\[chat serve\] chat:main loaded/,
    RELAY_READY_TIMEOUT_MS,
    'chat serve ready'
  );

  // Wait briefly for the WebRTC handshake to settle.
  await sleep(5000);

  // The user's actual flow: open the widget on the page where pair
  // completed and start typing. The Composer must be there. The
  // post-pair flush barrier (pairing-actions.ts) plus the
  // devicesState-reactive selfHeal loop (mesh-gate.tsx) together
  // guarantee the device's self-endorsement is in mesh:devices
  // before the widget renders. If the Composer is missing here,
  // either the IDB flush regressed or selfHealIdentity stopped
  // re-running on doc changes; both should fail loud.
  trace('phone', 'open chat widget — Composer must render on first try');
  await phone.page.waitForSelector('[data-action="chat.toggle-widget"]', {
    timeout: SHORT_TIMEOUT_MS,
  });
  await phone.page.click('[data-action="chat.toggle-widget"]');

  // The Composer's ActionInput is `aria-label="Message text"` and
  // saveOn="blur" — same promote-then-type pattern as the agenda
  // chore. SHORT_TIMEOUT_MS is the right gate: if the flush barrier
  // and reactive selfHeal worked, the row is in memory by the time
  // the panel mounts. If we have to wait MESH_SYNC_TIMEOUT_MS,
  // something regressed.
  await phone.page.waitForSelector('[data-polly-action-input][aria-label="Message text"]', {
    timeout: SHORT_TIMEOUT_MS,
  });
  await phone.page.click('[data-polly-action-input][aria-label="Message text"]');
  await phone.page.waitForSelector(
    'textarea[data-polly-action-input][aria-label="Message text"], input[data-polly-action-input][aria-label="Message text"]',
    { timeout: SHORT_TIMEOUT_MS }
  );
  const composer = await phone.page.$(
    'textarea[data-polly-action-input][aria-label="Message text"], input[data-polly-action-input][aria-label="Message text"]'
  );
  if (!composer) {
    throw new Error('composer input not editable after click');
  }
  await composer.focus();
  await sleep(100);
  const userText = `e2e ping ${Date.now()}`;
  await phone.page.keyboard.type(userText);
  // Tab so saveOn="blur" commits draftText, then click Send.
  await phone.page.keyboard.press('Tab');
  await sleep(200);
  trace('phone', `click Send for "${userText}"`);
  await phone.page.click('button[data-action="chat.send"]');

  trace('phone', 'wait for assistant reply in widget');
  try {
    await waitForText(phone.page, STUB_REPLY, MESH_SYNC_TIMEOUT_MS);
    ok = true;
  } catch (err) {
    failureReason = err instanceof Error ? err.message : String(err);
  }

  // Always grab the screenshot so we can see what the phone shows
  // — pending bubble, error chip, empty thread, whatever it is.
  await phone.page.screenshot({
    path: resolve(ARTIFACTS, ok ? 'phone-chat.png' : 'phone-chat-error.png'),
    fullPage: true,
  });

  if (!ok) {
    // Diagnostic: did the relay see the pending at all? Did it
    // process? Drop the relay stdout into the failure block so the
    // operator can tell which leg of the round-trip broke.
    const relayLog = (chatServe?.stdout ?? []).join('');
    const sawProcessing = /\[chat serve\] processing/.test(relayLog);
    const sawReplied = /\[chat serve\] replied to/.test(relayLog);
    trace(
      'diagnose',
      `relay sawProcessing=${sawProcessing} sawReplied=${sawReplied}; widget never showed "${STUB_REPLY}"`
    );
    throw new Error(`chat widget round-trip failed: ${failureReason}`);
  }
  trace('result', 'SUCCESS — assistant reply rendered in phone widget');
} catch (err) {
  failureReason = err instanceof Error ? err.message : String(err);
  trace('result', `FAILURE — ${failureReason}`);
  if (phone?.page) {
    try {
      await phone.page.screenshot({
        path: resolve(ARTIFACTS, 'phone-chat-error.png'),
        fullPage: true,
      });
    } catch {
      // best effort
    }
  }
} finally {
  if (chatServe) {
    await killAndWait(chatServe).catch(() => undefined);
  }
  if (inviteOpen) {
    await killAndWait(inviteOpen).catch(() => undefined);
  }
  if (phone) {
    await phone.browser.close().catch(() => undefined);
  }
}

process.exit(ok ? 0 : 1);
