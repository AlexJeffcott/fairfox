/**
 * Concurrent agenda writes round-trip — two paired CLIs add a
 * chore at the same instant, both writes survive, both peers see
 * the union.
 *
 * Mirrors the puppeteer `e2e-two-device-sync.ts` for `agenda:main`
 * but pure CLI: faster (≈30 s), no browser flake. Catches the
 * "concurrent assignment to messages list silently drops one"
 * regression that bit chat:main during the rename refactor.
 */

import { mkdirSync, rmSync } from 'node:fs';
import {
  bootstrapAndOpenInvite,
  buildBundleIfMissing,
  fail,
  pass,
  runCli,
  trace,
} from './e2e-cli-helpers.ts';

const ALICE_HOME = '/tmp/fairfox-e2e-agenda-alice';
const BOB_HOME = '/tmp/fairfox-e2e-agenda-bob';

rmSync(ALICE_HOME, { recursive: true, force: true });
rmSync(BOB_HOME, { recursive: true, force: true });
mkdirSync(ALICE_HOME, { recursive: true });
mkdirSync(BOB_HOME, { recursive: true });

buildBundleIfMissing();

const invite = await bootstrapAndOpenInvite({
  adminHome: ALICE_HOME,
  adminName: 'Alice',
  invitees: [{ name: 'Bob' }],
  inviteToOpen: 'bob',
});
trace('alice', 'bootstrapped, invite open');

// Pair Bob.
{
  const r = await runCli(['pair', invite.shareUrl], BOB_HOME);
  if (r.status !== 0) {
    await invite.close();
    fail(`bob pair failed: ${r.stderr.slice(0, 200)}`);
  }
}
trace('bob', 'paired');
// Hold the invite-open until pair-ack lands so the issuer's
// keyring learns Bob's identity. The helper waits for the ack
// internally on `pairWithShare` — but we used a bare `pair`
// above to demo the share URL flow. Pull the ack now via the
// invite handle's stdout.
await invite.close();

// Concurrent writes — fire both `agenda add` invocations as soon
// as their promises resolve in sequence within Promise.all. They
// won't be perfectly simultaneous, but they will overlap in the
// 8-second waitForPeer + write window each runs through.
const ALICE_CHORE = `alice-chore-${Date.now()}`;
const BOB_CHORE = `bob-chore-${Date.now()}`;
trace('both', 'concurrent agenda add');
const [aliceAdd, bobAdd] = await Promise.all([
  runCli(['agenda', 'add', ALICE_CHORE], ALICE_HOME),
  runCli(['agenda', 'add', BOB_CHORE], BOB_HOME),
]);
if (aliceAdd.status !== 0 || bobAdd.status !== 0) {
  fail(`agenda add failed (alice=${aliceAdd.status}, bob=${bobAdd.status})`);
}

// Both should see both items after a brief settle. agenda list
// already does an 8-s waitForPeer + 2-s flush internally, so no
// explicit sleep needed.
const [aliceList, bobList] = await Promise.all([
  runCli(['agenda', 'list'], ALICE_HOME),
  runCli(['agenda', 'list'], BOB_HOME),
]);
const aliceSeesAlice = aliceList.stdout.includes(ALICE_CHORE);
const aliceSeesBob = aliceList.stdout.includes(BOB_CHORE);
const bobSeesAlice = bobList.stdout.includes(ALICE_CHORE);
const bobSeesBob = bobList.stdout.includes(BOB_CHORE);

if (!(aliceSeesAlice && aliceSeesBob && bobSeesAlice && bobSeesBob)) {
  fail(
    `concurrent writes lost: alice→{alice:${aliceSeesAlice}, bob:${aliceSeesBob}}, bob→{alice:${bobSeesAlice}, bob:${bobSeesBob}}`
  );
}
pass('two concurrent agenda writes both visible to both peers');
