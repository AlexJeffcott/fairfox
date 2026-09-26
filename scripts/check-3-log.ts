// Step 0c, check 3: the page's own log and a second call in one room. Two
// headless Chromium pages, named and with a network marked, join one room and
// connect. The second leaves and joins again while the first stays; the call
// must connect again. Then the second reloads in the middle of a call, and
// its page must log that the call ended with no Leave. Then /check/3/log must
// hold the lines of both pages, under their names, with the result of each
// call.
//
//   bun scripts/check-3-log.ts --secret-file ~/.config/fairfox/turn-secret
//       starts the server on this machine and tests it
//   bun scripts/check-3-log.ts --origin https://fairfox.fly.dev
//       tests the deployed page
import { parseArgs } from 'node:util';
import { type Page, chromium } from '@playwright/test';
import { createApp } from '../packages/server/src/index.ts';

const { values } = parseArgs({ options: { 'secret-file': { type: 'string' }, origin: { type: 'string' } } });
const secretFile = values['secret-file'];
const given = values.origin;
if ((secretFile === undefined) === (given === undefined)) {
  throw new Error('Give --secret-file, to start the server here, or --origin, to test a deployed page. Not both.');
}

let origin = given ?? '';
let stopServer = async () => {};
if (secretFile !== undefined) {
  const secret = (await Bun.file(secretFile).text()).trim();
  const app = createApp({ FAIRFOX_COMMIT: 'check3', FAIRFOX_DATABASE_PATH: ':memory:', FAIRFOX_TURN_SECRET: secret }).listen({
    hostname: 'localhost',
    port: 0,
  });
  origin = `http://localhost:${app.server?.port ?? 0}`;
  stopServer = async () => {
    await app.stop();
  };
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const room = `log-${Date.now() % 100000}`;
const tag = `${Date.now() % 100000}`;

async function open(name: string, network: 'wifi' | 'mobile'): Promise<Page> {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await page.goto(`${origin}/check/3`);
  await page.fill('#device', name);
  await page.check(`input[name=network][value=${network}]`);
  await page.fill('#room', room);
  return page;
}

async function connected(page: Page): Promise<void> {
  await page.locator('#path').filter({ hasText: /Straight path|Through the relay/ }).waitFor({ timeout: 20_000 });
}

/** A string, run in the page: at least 50 sound packets received in this call. */
async function heard(page: Page): Promise<void> {
  await page.waitForFunction("/packets ([5-9]\\d|\\d{3,})/.test(document.getElementById('path')?.title ?? '')", undefined, { timeout: 10_000 });
}

const first = await open(`first-${tag}`, 'wifi');
// A swipe down must not reload the page in a call: no overscroll on the page, none passed on from the log.
const overscroll = await first.evaluate(
  "[getComputedStyle(document.documentElement).overscrollBehaviorY, getComputedStyle(document.body).overscrollBehaviorY, getComputedStyle(document.getElementById('log')).overscrollBehaviorY].join(' ')",
);
if (overscroll !== 'none none contain') {
  console.error(`overscroll on the page, the body and the log: ${overscroll}; none none contain expected`);
  process.exit(1);
}
const second = await open(`second-${tag}`, 'mobile');
let ok = true;
try {
  await first.click('#join');
  await first.locator('#log').filter({ hasText: 'joined;' }).waitFor({ timeout: 10_000 });
  await second.click('#join');
  await connected(first);
  await connected(second);
  console.log(`call 1: ${await first.textContent('#path')}`);

  await heard(first);
  await heard(second);
  await second.click('#leave');
  await first.locator('#log').filter({ hasText: 'the other device left' }).waitFor({ timeout: 10_000 });
  await second.click('#join');
  await connected(second);
  await connected(first);
  console.log(`call 2, the same room: ${await first.textContent('#path')}`);
  await heard(first);
  await heard(second);
  await second.reload();
  await first.locator('#log').filter({ hasText: /left[\s\S]*left/ }).waitFor({ timeout: 10_000 });
  await second.locator('#log').filter({ hasText: 'ended with no Leave' }).waitFor({ timeout: 10_000 });
  await first.click('#leave');
  // The page sends its lines once a second: wait until the first page's last line is on the server.
  await first.waitForFunction(
    `fetch('/check/3/log').then((r) => r.text()).then((t) => t.split('\\n').some((l) => l.includes('first-${tag}') && l.includes('result: Not connected')))`,
    undefined,
    { timeout: 10_000, polling: 500 },
  );

  const text = await (await fetch(`${origin}/check/3/log`)).text();
  const mine = text.split('\n').filter((line) => line.includes(tag));
  const want = [
    `first-${tag} (wifi)`,
    `second-${tag} (mobile)`,
    'network: wifi',
    'network: mobile',
    'remote candidate:',
    'path: ',
    'result: ',
    'the other device left',
    'page loaded (reload); the call of session',
    'page closed or left',
  ];
  for (const piece of want) {
    if (!mine.some((line) => line.includes(piece))) {
      ok = false;
      console.error(`the log has no line with "${piece}"`);
    }
  }
  // Times are the owner's, Berlin and Rome: CEST or CET, or GMT+2 or GMT+1 where a browser names the zone so.
  const unstamped = mine.filter((line) => !/ \d\d:\d\d:\d\d (CEST|CET|GMT\+[12]) /.test(line));
  if (unstamped.length > 0) {
    ok = false;
    console.error(`${unstamped.length} lines have no Berlin time, the first: ${unstamped[0]}`);
  }
  const results = mine.filter((line) => /result: (Straight path|Through the relay).*packets [1-9]/.test(line));
  if (results.length < 2) {
    ok = false;
    console.error(`the log has ${results.length} results with sound packets; 2 expected (both after call 1; after call 2, the first)`);
  }
  console.log(`the log holds ${mine.length} lines of this run, ${results.length} results with sound packets`);
} catch (error) {
  ok = false;
  console.error(`red. ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  console.error(`first page log:\n${await first.textContent('#log')}`);
  console.error(`second page log:\n${await second.textContent('#log')}`);
}
await browser.close();
await stopServer();
if (!ok) {
  process.exit(1);
}
console.log(`check 3 log: green at ${origin}`);
