/**
 * Fly TURN relay verification for issue #18 — the redesign-era flow.
 *
 * Proves the deployed Fly stack — fairfox web (signalling) + fairfox-turn
 * (coturn) — actually carries WebRTC data between a browser and a real
 * werift CLI peer. The original symptom was `peers=0` indefinitely on
 * the CLI heartbeat after both sides emitted matching
 * `typ relay 213.x` ICE candidates: signalling and ALLOCATE worked,
 * but the relay-port UDP window declared in fly.toml with
 * `start_port`/`end_port` was not actually forwarded at Fly's edge, so
 * peers could not exchange bytes once they tried to use the returned
 * relay endpoint.
 *
 * @covers: mesh:devices
 *
 * The script asserts the live-stack invariant by pairing a browser
 * through the CLI-originated flow, then holding a long-lived CLI peer
 * open and watching its heartbeat:
 *
 *   1. `fairfox init` seeds a fresh mesh on a disposable HOME.
 *   2. `fairfox pair open` issues a transport-only join QR; a headless
 *      Chrome opens it and pairs into the mesh.
 *   3. `pair open` is closed — the browser stays a live mesh peer.
 *   4. `fairfox daemon start --foreground` runs long-lived under the
 *      same HOME and ticks `[time] peers=N` every 15s. Test passes the
 *      moment a heartbeat reports `peers=1` — the original AC
 *      ("peers=0 indefinitely" → "peers=1 within 15s") expressed at
 *      the CLI's own observability layer.
 *
 * A long-lived daemon avoids the WebRTC renegotiation race that
 * short-lived `agenda add`/`agenda list` invocations introduce: the
 * data channel only needs to form once, not on every operation.
 *
 *   bun scripts/e2e-fly-turn-relay.ts                # Fly stack, headless
 *   HEADLESS=false bun scripts/e2e-fly-turn-relay.ts # watch it run
 *   TARGET_URL=https://other.example/agenda bun scripts/e2e-fly-turn-relay.ts
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildBundle,
  interruptAndWait,
  killAndWait,
  lastHeartbeatLine,
  runCli,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';
import { SHORT_TIMEOUT_MS } from './e2e-config.ts';
import { joinMeshFromBrowser, launchBrowser } from './e2e-pairing.ts';

const TARGET_URL = process.env.TARGET_URL ?? 'https://fairfox.fly.dev/agenda';
const ORIGIN = new URL(TARGET_URL).origin;
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(ARTIFACTS, 'fly-turn-profiles');
const TEST_HOME = '/tmp/fairfox-test-fly-turn';
// daemon heartbeats every 15s; allow ~4 ticks before giving up.
const PEER_BUDGET_MS = 60_000;

rmSync(PROFILES, { recursive: true, force: true });
rmSync(TEST_HOME, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(TEST_HOME, { recursive: true });

const CLI_ENV = { FAIRFOX_URL: ORIGIN };

buildBundle();

// 1 — fresh mesh on the disposable HOME.
trace('cli', `init mesh (origin ${ORIGIN})`);
const init = await runCli(['init', 'fly-turn mesh', '--admin', 'FlyTurnTest'], TEST_HOME, CLI_ENV);
if (init.status !== 0) {
  trace('cli', init.stdout.trim());
  trace('cli', init.stderr.trim());
  throw new Error('fairfox init failed');
}
trace('cli', 'mesh created, admin "FlyTurnTest"');

// 2 — `pair open` issues the join QR.
trace('cli', 'pair open — holding a join QR');
const pairOpen = spawnCli('pair-open', ['pair', 'open'], TEST_HOME, CLI_ENV);

const browser = await launchBrowser('fly-turn', PROFILES, HEADLESS);
let ok = false;
let daemon: ReturnType<typeof spawnCli> | null = null;

try {
  const joinMatch = await waitForLine(
    pairOpen.stdout,
    /(https?:\/\/\S*#pair=\S+)/,
    SHORT_TIMEOUT_MS,
    'join URL from `pair open`'
  );
  const joinUrl = (joinMatch[1] ?? '').replace(/[)\].,]+$/, '');
  trace('cli', `join URL captured (${joinUrl.length} chars)`);

  // 3 — the browser joins and pairs into the mesh.
  trace('browser', 'open the join URL');
  const identityName = await joinMeshFromBrowser(browser.page, joinUrl);
  trace('browser', `identity applied: "${identityName}" — paired`);

  // Close the issuer socket; the browser remains a live mesh peer.
  trace('cli', 'closing `pair open`');
  await interruptAndWait(pairOpen);

  // 4 — long-lived daemon forms the data channel back to the browser
  // through Fly TURN and ticks the heartbeat we read.
  trace('cli', 'daemon start --foreground');
  daemon = spawnCli('daemon', ['daemon', 'start', '--foreground'], TEST_HOME, CLI_ENV);

  trace('test', `waiting up to ${PEER_BUDGET_MS / 1000}s for peers>=1`);
  await waitForLine(
    daemon.stdout,
    /peers=[1-9]\d*/,
    PEER_BUDGET_MS,
    'daemon heartbeat peers>=1',
    () => lastHeartbeatLine(daemon?.stdout ?? [])
  );

  await browser.page.screenshot({
    path: resolve(ARTIFACTS, 'fly-turn-relay.png'),
    fullPage: true,
  });
  ok = true;
  trace('result', 'SUCCESS — daemon reported peers>=1 against the Fly TURN stack');
  trace('result', `screenshot at ${resolve(ARTIFACTS, 'fly-turn-relay.png')}`);
} catch (err) {
  trace('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await browser.page.screenshot({
      path: resolve(ARTIFACTS, 'fly-turn-relay-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort on the error screenshot
  }
} finally {
  await interruptAndWait(pairOpen);
  if (daemon) {
    await killAndWait(daemon);
  }
  await browser.browser.close();
}

process.exit(ok ? 0 : 1);
