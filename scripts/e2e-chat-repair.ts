/**
 * End-to-end of the chat widget Repair button. Proves the targeted
 * IndexedDB-recovery path works without taking the user back to a
 * fresh-pair flow.
 *
 * The harness mirrors `e2e-chat-widget.ts` for the setup (admin +
 * invite + phone profile + relay-with-stub) and then drives the
 * Repair flow specifically:
 *
 *   1. Phone sends a message and gets the stub reply — establishes
 *      that chat:main is healthy and the baseline round-trip works.
 *   2. Read fairfox-mesh IndexedDB and count rows whose first key
 *      element equals chat:main's deterministic DocumentId. Must be
 *      > 0 (the snapshots the relay replicated to us).
 *   3. Click `chat.repair-storage`. ConfirmDialog appears; click
 *      the polly confirm-ok button. Page reloads.
 *   4. Read fairfox-mesh again. Rows for chat:main must be 0. Rows
 *      for at least one other doc (mesh:devices) must remain > 0
 *      — proves the wipe is targeted, not nuclear.
 *   5. Read fairfox-keyring. Entry count must be unchanged from
 *      before — proves the keyring DB is untouched.
 *   6. Phone sends another message after re-sync from the relay;
 *      relay processes it and the assistant reply renders. Proves
 *      recovery actually restores function, not just looks clean.
 *
 *   bun scripts/e2e-chat-repair.ts                # prod
 *   TARGET_URL=http://localhost:3000/agenda HEADLESS=false bun \
 *     scripts/e2e-chat-repair.ts                  # watch
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { type BinaryDocumentId, interpretAsDocumentId } from '@automerge/automerge-repo/slim';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import nacl from 'tweetnacl';
import {
  MESH_SYNC_TIMEOUT_MS,
  PAIR_CEREMONY_TIMEOUT_MS,
  SHORT_TIMEOUT_MS,
  sleep,
  waitForText,
} from './e2e-config.ts';

const TARGET = process.env.TARGET_URL ?? 'https://fairfox-production-8273.up.railway.app/agenda';
const HEADLESS = process.env.HEADLESS !== 'false';
const TEST_HOME = '/tmp/fairfox-test-chat-repair';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(import.meta.dir, 'artifacts', 'profiles-chat-repair');
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');
const STUB_REPLY_BEFORE = 'repair-test reply BEFORE';
const STUB_REPLY_AFTER = 'repair-test reply AFTER';
const RELAY_READY_TIMEOUT_MS = 30_000;
const POLLY_DOC_ID_DOMAIN = 'polly/meshState/v1';

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

/** Same derivation polly uses internally — domain-prefixed
 * SHA-512(key) truncated to 16 bytes, interpreted as a base58check
 * DocumentId. The repair action recomputes this in the browser; we
 * recompute it here in the test harness so we can assert IDB rows
 * directly without coupling to either the action's runtime state or
 * polly's internals. */
function chatMainDocumentId(): string {
  const encoded = new TextEncoder().encode(`${POLLY_DOC_ID_DOMAIN}:chat:main`);
  const digest = nacl.hash(encoded);
  return interpretAsDocumentId(digest.slice(0, 16) as unknown as BinaryDocumentId);
}

interface DbCensus {
  readonly chatMainRows: number;
  readonly otherDocRows: number;
  readonly keyringRows: number;
}

/** Inspect the two IDBs the patch promises to treat differently:
 * - fairfox-mesh `documents` store: rows are keyed `[docId, kind, …]`.
 *   Count rows whose first key element matches chat:main's docId
 *   versus rows for any other docId.
 * - fairfox-keyring: a separate IDB whose total row count must not
 *   change across the repair, since the patch only touches the mesh
 *   store. */
async function censusIDB(page: Page, chatMainDocId: string): Promise<DbCensus> {
  return await page.evaluate(async (targetDocId: string) => {
    function open(name: string): Promise<IDBDatabase> {
      return new Promise<IDBDatabase>((res, rej) => {
        const req = window.indexedDB.open(name);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    }
    async function countMeshDocuments(): Promise<{ chatMain: number; other: number }> {
      const db = await open('fairfox-mesh');
      try {
        if (!db.objectStoreNames.contains('documents')) {
          return { chatMain: 0, other: 0 };
        }
        const tx = db.transaction('documents', 'readonly');
        const store = tx.objectStore('documents');
        return await new Promise<{ chatMain: number; other: number }>((res, rej) => {
          let chatMain = 0;
          let other = 0;
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) {
              res({ chatMain, other });
              return;
            }
            const key: unknown = cursor.key;
            const head = Array.isArray(key) ? key[0] : key;
            if (head === targetDocId) {
              chatMain += 1;
            } else {
              other += 1;
            }
            cursor.continue();
          };
          cursorReq.onerror = () => rej(cursorReq.error);
        });
      } finally {
        db.close();
      }
    }
    async function countKeyringRows(): Promise<number> {
      const db = await open('fairfox-keyring');
      try {
        const stores = Array.from(db.objectStoreNames);
        let total = 0;
        for (const name of stores) {
          const tx = db.transaction(name, 'readonly');
          const store = tx.objectStore(name);
          const n = await new Promise<number>((res, rej) => {
            const req = store.count();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
          });
          total += n;
        }
        return total;
      } finally {
        db.close();
      }
    }
    const mesh = await countMeshDocuments();
    const keyringRows = await countKeyringRows();
    return {
      chatMainRows: mesh.chatMain,
      otherDocRows: mesh.other,
      keyringRows,
    };
  }, chatMainDocId);
}

async function sendInComposer(page: Page, text: string): Promise<void> {
  await page.waitForSelector('[data-polly-action-input][aria-label="Message text"]', {
    timeout: SHORT_TIMEOUT_MS,
  });
  await page.click('[data-polly-action-input][aria-label="Message text"]');
  await page.waitForSelector(
    'textarea[data-polly-action-input][aria-label="Message text"], input[data-polly-action-input][aria-label="Message text"]',
    { timeout: SHORT_TIMEOUT_MS }
  );
  const composer = await page.$(
    'textarea[data-polly-action-input][aria-label="Message text"], input[data-polly-action-input][aria-label="Message text"]'
  );
  if (!composer) {
    throw new Error('composer input not editable after click');
  }
  await composer.focus();
  await sleep(100);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
  await sleep(200);
  await page.click('button[data-action="chat.send"]');
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
  const parsed = new URL(TARGET);
  const targetOrigin = parsed.origin;
  const targetPath = parsed.pathname || '/agenda';
  const cliEnv = { FAIRFOX_URL: targetOrigin };

  trace('cli', 'mesh init --admin Laptop --user Phone:member');
  const init = await runCli(['init', '--admin', 'Laptop', '--user', 'Phone:member'], cliEnv);
  if (init.status !== 0) {
    throw new Error(`mesh init exited ${init.status}\n${init.stdout}\n${init.stderr}`);
  }

  trace('cli', 'mesh invite open phone');
  inviteOpen = spawnCli(['add', 'user', 'phone'], cliEnv);
  const shareMatch = await waitForLine(
    inviteOpen.stdout,
    /(https?:\/\/\S+#pair=\S+invite=\S+)/,
    SHORT_TIMEOUT_MS,
    'invite-open share URL'
  );
  const shareUrl = (shareMatch[1] ?? '').replace(/[)\].,]+$/, '');
  const sharedFragment = shareUrl.split('#')[1] ?? '';
  const phoneShareUrl = `${targetOrigin}${targetPath}#${sharedFragment}`;

  phone = await launchProfile('phone');
  await phone.page.goto(phoneShareUrl, { waitUntil: 'domcontentloaded' });

  trace('cli', 'wait for ✓ phone paired');
  await waitForLine(
    inviteOpen.stdout,
    /✓\s+"phone"\s+paired/i,
    PAIR_CEREMONY_TIMEOUT_MS,
    'invite-open pair ack'
  );
  await waitForText(phone.page, 'Agenda', PAIR_CEREMONY_TIMEOUT_MS);
  await killAndWait(inviteOpen);
  inviteOpen = undefined;

  trace('cli', `chat serve (stub="${STUB_REPLY_BEFORE}")`);
  chatServe = spawnCli(['chat', 'serve'], {
    ...cliEnv,
    FAIRFOX_CLAUDE_STUB: STUB_REPLY_BEFORE,
  });
  await waitForLine(
    chatServe.stdout,
    /\[chat serve\] chat:main loaded/,
    RELAY_READY_TIMEOUT_MS,
    'chat serve ready'
  );
  await sleep(5000); // WebRTC handshake settle.

  // ── Step 1: baseline round-trip works.
  trace('phone', 'open chat widget and send "before-repair"');
  await phone.page.waitForSelector('[data-action="chat.toggle-widget"]', {
    timeout: SHORT_TIMEOUT_MS,
  });
  await phone.page.click('[data-action="chat.toggle-widget"]');
  await sendInComposer(phone.page, `before-repair ${Date.now()}`);
  await waitForText(phone.page, STUB_REPLY_BEFORE, MESH_SYNC_TIMEOUT_MS);
  trace('phone', 'baseline reply rendered ✓');

  // ── Step 2: census IDB — chat:main rows must exist; keyring populated.
  const targetDocId = chatMainDocumentId();
  const before = await censusIDB(phone.page, targetDocId);
  trace(
    'idb-before',
    `chatMain=${before.chatMainRows} other=${before.otherDocRows} keyring=${before.keyringRows}`
  );
  if (before.chatMainRows === 0) {
    throw new Error('IDB has no chat:main rows before repair — relay never replicated to phone?');
  }
  if (before.otherDocRows === 0) {
    throw new Error('IDB has no non-chat:main rows — mesh:devices/users never replicated either?');
  }
  if (before.keyringRows === 0) {
    throw new Error('keyring IDB is empty — pairing never persisted?');
  }

  // ── Step 3: click Repair, confirm in dialog, wait for reload.
  trace('phone', 'click Repair');
  // The reload happens after the action settles. waitForNavigation
  // races with the click sequence; arm it before the confirm so the
  // post-confirm reload is what resolves it.
  await phone.page.click('button[data-action="chat.repair-storage"]');
  await phone.page.waitForSelector('[data-polly-confirm-ok]', { timeout: SHORT_TIMEOUT_MS });
  const reload = phone.page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: SHORT_TIMEOUT_MS,
  });
  await phone.page.click('[data-polly-confirm-ok]');
  await reload;
  trace('phone', 'reloaded after repair ✓');

  // ── Step 4 & 5: census IDB after — chat:main wiped, others survive.
  // Re-render the SPA enough to evaluate IDB; the documents store
  // can be queried any time after navigation.
  await sleep(500); // brief settle so any synchronous re-init has a chance.
  const after = await censusIDB(phone.page, targetDocId);
  trace(
    'idb-after',
    `chatMain=${after.chatMainRows} other=${after.otherDocRows} keyring=${after.keyringRows}`
  );
  if (after.chatMainRows !== 0) {
    throw new Error(
      `expected 0 chat:main rows after repair, got ${after.chatMainRows} — wipe missed entries`
    );
  }
  if (after.otherDocRows < before.otherDocRows) {
    throw new Error(
      `expected other-doc rows preserved (${before.otherDocRows}), got ${after.otherDocRows} — repair was not targeted`
    );
  }
  if (after.keyringRows !== before.keyringRows) {
    throw new Error(
      `keyring row count changed ${before.keyringRows} → ${after.keyringRows} — repair touched the wrong IDB`
    );
  }

  // ── Step 6: post-repair Send still reaches the relay.
  // Switch the relay's stub reply so we can distinguish this round
  // from the baseline cached in the page-bus history. Restart relay
  // with the new stub; sync resumes when the phone reconnects.
  trace('cli', `restart chat serve with stub="${STUB_REPLY_AFTER}"`);
  await killAndWait(chatServe);
  chatServe = spawnCli(['chat', 'serve'], {
    ...cliEnv,
    FAIRFOX_CLAUDE_STUB: STUB_REPLY_AFTER,
  });
  await waitForLine(
    chatServe.stdout,
    /\[chat serve\] chat:main loaded/,
    RELAY_READY_TIMEOUT_MS,
    'chat serve ready (post-repair)'
  );
  await sleep(5000);

  trace('phone', 'open widget and send "after-repair"');
  await phone.page.waitForSelector('[data-action="chat.toggle-widget"]', {
    timeout: SHORT_TIMEOUT_MS,
  });
  await phone.page.click('[data-action="chat.toggle-widget"]');
  await sendInComposer(phone.page, `after-repair ${Date.now()}`);
  await waitForText(phone.page, STUB_REPLY_AFTER, MESH_SYNC_TIMEOUT_MS);

  await phone.page.screenshot({
    path: resolve(ARTIFACTS, 'chat-repair-success.png'),
    fullPage: true,
  });
  ok = true;
  trace(
    'result',
    'SUCCESS — Repair wiped chat:main only, other docs and keyring intact, post-repair Send round-trips'
  );
} catch (err) {
  failureReason = err instanceof Error ? err.message : String(err);
  trace('result', `FAILURE — ${failureReason}`);
  if (phone?.page) {
    try {
      await phone.page.screenshot({
        path: resolve(ARTIFACTS, 'chat-repair-error.png'),
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

if (!ok) {
  process.exit(1);
}
