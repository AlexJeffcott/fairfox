// Step 0c, check 3, before the owner's devices: two headless Chromium pages,
// each with a fake microphone, open the bare page and call each other. Run
// twice: once with any path, once with one page on relay only. Each run passes
// when the page shows the path it expects and the other page has received
// sound packets. This is not check 3: check 3 is the owner's iPhone, iPad and
// Mac. It shows the page works before anyone picks up a device.
//
//   bun scripts/check-3-page.ts --secret-file ~/.config/fairfox/turn-secret
//       starts the server on this machine and tests it
//   bun scripts/check-3-page.ts --origin https://fairfox.fly.dev
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

async function open(policy: 'all' | 'relay', room: string): Promise<Page> {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await page.goto(`${origin}/check/3`);
  await page.check(`input[name=policy][value=${policy}]`);
  await page.fill('#room', room);
  await page.click('#join');
  return page;
}

/** The number of sound packets a page has received, from the title the page sets on its path line. */
async function packets(page: Page): Promise<number> {
  const title = (await page.getAttribute('#path', 'title')) ?? '';
  return Number(/packets (\d+)/.exec(title)?.[1] ?? 0);
}

async function run(label: string, second: 'all' | 'relay', expect: RegExp): Promise<boolean> {
  const room = `${label}-${Date.now() % 100000}`;
  const first = await open('all', room);
  const other = await open(second, room);
  let ok = true;
  try {
    for (const page of [first, other]) {
      await page.locator('#path').filter({ hasText: expect }).waitFor({ timeout: 20_000 });
    }
    // A string, run in the page: at least 50 sound packets received.
    await first.waitForFunction("/packets ([5-9]\\d|\\d{3,})/.test(document.getElementById('path')?.title ?? '')", undefined, {
      timeout: 10_000,
    });
    const path = await other.textContent('#path');
    console.log(`${label}: ${path}; the first page received ${await packets(first)} packets`);
  } catch (error) {
    ok = false;
    console.error(`${label}: red. ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    console.error(`${label}: first page log:\n${await first.textContent('#log')}`);
    console.error(`${label}: second page log:\n${await other.textContent('#log')}`);
  }
  await first.context().close();
  await other.context().close();
  return ok;
}

const results = [
  await run('any-path', 'all', /Straight path|Through the relay/),
  await run('relay', 'relay', /Through the relay/),
];
await browser.close();
await stopServer();
if (results.includes(false)) {
  console.error('check 3 page: red');
  process.exit(1);
}
console.log(`check 3 page: green at ${origin}`);
process.exit(0);
