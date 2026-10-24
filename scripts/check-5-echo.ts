// Step 0c, check 5, before the owner's devices: headless Chromium with a fake
// microphone opens the bare page, ticks "Call the server" and joins. The
// server's werift end answers through the relay and sends back every sound
// packet. Green when the page shows a connected path and has received at
// least 100 packets back. Check 5 itself is the owner's device: the page on
// the iPhone, and the owner hears their own voice come back.
//
//   bun scripts/check-5-echo.ts --secret-file ~/.config/fairfox/turn-secret
//       starts the server on this machine and tests it
//   bun scripts/check-5-echo.ts --origin https://fairfox.fly.dev
//       tests the deployed server
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createApp } from '../packages/server/src/index.ts';

const { values } = parseArgs({ options: { 'secret-file': { type: 'string' }, origin: { type: 'string' } } });
const secretFile = values['secret-file'];
const given = values.origin;
if ((secretFile === undefined) === (given === undefined)) {
  throw new Error('Give --secret-file, to start the server here, or --origin, to test a deployed server. Not both.');
}

let origin = given ?? '';
let stopServer = async () => {};
if (secretFile !== undefined) {
  const secret = (await Bun.file(secretFile).text()).trim();
  const app = createApp({ FAIRFOX_COMMIT: 'check5', FAIRFOX_DATABASE_PATH: ':memory:', FAIRFOX_TURN_SECRET: secret, FAIRFOX_CHECK7_PUSH_KEY: 'check7' }).listen({
    hostname: 'localhost',
    port: 0,
  });
  origin = `http://localhost:${app.server?.port ?? 0}`;
  stopServer = async () => {
    await app.stop();
  };
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
await page.goto(`${origin}/check/3`);
await page.check('#server');
await page.click('#join');

let ok = true;
try {
  await page.locator('#path').filter({ hasText: /Straight path|Through the relay/ }).waitFor({ timeout: 30_000 });
  // A string, run in the page: at least 100 sound packets back from the server.
  await page.waitForFunction("/packets (\\d{3,})/.test(document.getElementById('path')?.title ?? '')", undefined, { timeout: 15_000 });
  console.log(`check 5 page: ${await page.textContent('#path')}; ${await page.getAttribute('#path', 'title')}`);
} catch (error) {
  ok = false;
  console.error(`check 5 page: red. ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  console.error(await page.textContent('#log'));
}
await browser.close();
await stopServer();
if (!ok) {
  process.exit(1);
}
console.log(`check 5 page: green at ${origin}`);
process.exit(0);
