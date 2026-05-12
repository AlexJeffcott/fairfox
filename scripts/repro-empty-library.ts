/**
 * Reproduces (and now should disprove) the empty-library bug:
 * a fresh Chrome that joins Alex's mesh via a CLI-issued pair URL
 * carrying both pair token and recovery blob shows zero data in
 * /library, despite the CLI being a long-lived peer with hundreds
 * of refs locally.
 *
 * The script:
 *   1. Starts `fairfox add device` in the background pointed at Fly.
 *   2. Captures the share URL it prints.
 *   3. Boots puppeteer Chrome to that URL.
 *   4. Lets the mesh-gate hash consumer run, waits for the auto-reload.
 *   5. Visits /library and reports refs.length.
 *
 * Exits 0 if the references tab populates within budget, 1 otherwise.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const HEADLESS = process.env.HEADLESS !== 'false';
const CHROME =
  process.env.CHROME ??
  '/Users/AJT/.cache/puppeteer/chrome/mac_arm-147.0.7727.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PROFILE = '/tmp/repro-empty-profile';
const CLI = '/Users/AJT/.local/bin/fairfox';
const ADD_DEVICE_LOG = '/tmp/repro-add-device.log';

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });
writeFileSync(ADD_DEVICE_LOG, '');

// Start `fairfox add device` so it issues a share URL.
const addDevice = spawn(CLI, ['add', 'device'], {
  env: { ...process.env, FAIRFOX_URL: 'https://fairfox.fly.dev' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let addBuf = '';
addDevice.stdout.on('data', (c: Buffer) => {
  const text = c.toString();
  addBuf += text;
  writeFileSync(ADD_DEVICE_LOG, addBuf);
});
addDevice.stderr.on('data', (c: Buffer) => {
  const text = c.toString();
  addBuf += text;
  writeFileSync(ADD_DEVICE_LOG, addBuf);
});

// Wait for the share URL.
const deadline = Date.now() + 20_000;
let shareUrl = '';
while (Date.now() < deadline) {
  const m = addBuf.match(/https:\/\/fairfox\.fly\.dev\/#pair=[^\s]+/);
  if (m) {
    shareUrl = m[0];
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
if (!shareUrl) {
  console.log('[repro] FAIL: never got a share URL from add device');
  addDevice.kill('SIGTERM');
  process.exit(1);
}
console.log('[repro] share URL captured');

const browser = await puppeteer.launch({
  headless: HEADLESS,
  executablePath: CHROME,
  userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });

// Instrument WebRTC + WebSocket BEFORE the SPA loads so we capture
// every RTCPeerConnection construction and every signalling frame.
await page.evaluateOnNewDocument(() => {
  type W = Window & { __rtcLog?: string[]; __wsLog?: string[] };
  const w = window as unknown as W;
  w.__rtcLog = [];
  w.__wsLog = [];
  const OrigRTC = window.RTCPeerConnection;
  function wireChannel(prefix: string, ch: RTCDataChannel): void {
    w.__rtcLog?.push(`${prefix} construct label=${ch.label} rs=${ch.readyState}`);
    ch.addEventListener('open', () => w.__rtcLog?.push(`${prefix} open`));
    ch.addEventListener('close', () => w.__rtcLog?.push(`${prefix} close`));
    ch.addEventListener('error', (e) => w.__rtcLog?.push(`${prefix} error ${e}`));
    const origSend = ch.send.bind(ch);
    ch.send = (data: ArrayBufferView | ArrayBuffer | Blob | string): void => {
      const len = typeof data === 'string' ? data.length : (data as ArrayBuffer).byteLength ?? 0;
      w.__rtcLog?.push(`${prefix} send ${len}b`);
      origSend(data as Parameters<typeof origSend>[0]);
    };
    ch.addEventListener('message', (e) => {
      const len =
        typeof e.data === 'string'
          ? e.data.length
          : (e.data as ArrayBuffer)?.byteLength ?? 0;
      w.__rtcLog?.push(`${prefix} recv ${len}b`);
    });
  }
  window.RTCPeerConnection = class extends OrigRTC {
    constructor(config?: RTCConfiguration) {
      super(config);
      w.__rtcLog?.push(`pc-construct ice=${JSON.stringify(config?.iceServers ?? [])}`);
      this.addEventListener('connectionstatechange', () => {
        w.__rtcLog?.push(`pc-state ${this.connectionState}`);
      });
      this.addEventListener('iceconnectionstatechange', () => {
        w.__rtcLog?.push(`ice-state ${this.iceConnectionState}`);
      });
      this.addEventListener('signalingstatechange', () => {
        w.__rtcLog?.push(`sig-state ${this.signalingState}`);
      });
      this.addEventListener('datachannel', (e) => wireChannel('dc-remote', e.channel));
    }
    createDataChannel(label: string, dict?: RTCDataChannelInit): RTCDataChannel {
      const ch = super.createDataChannel(label, dict);
      wireChannel('dc-local', ch);
      return ch;
    }
  } as typeof RTCPeerConnection;

  const OrigWS = window.WebSocket;
  window.WebSocket = class extends OrigWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('signaling') || u.includes('signal')) {
        w.__wsLog?.push(`ws-open ${u}`);
        this.addEventListener('message', (e) => {
          const text = typeof e.data === 'string' ? e.data : '<binary>';
          if (text.length < 300) w.__wsLog?.push(`ws-msg ${text}`);
          else w.__wsLog?.push(`ws-msg ${text.slice(0, 200)}...`);
        });
        this.addEventListener('close', (e) => {
          w.__wsLog?.push(`ws-close ${e.code}`);
        });
      }
    }
  } as typeof WebSocket;
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || /webrtc|peer|sync|signal|setRemote|InvalidState/i.test(t)) {
    console.log('[console]', m.type(), t.slice(0, 240));
  }
});

let ok = false;
try {
  console.log('[repro] navigate to pair URL');
  await page.goto(shareUrl, { waitUntil: 'domcontentloaded' });

  async function bodyHas(text: string): Promise<boolean> {
    return page.evaluate((t) => (document.body.innerText || '').includes(t), text);
  }
  const homeDeadline = Date.now() + 30_000;
  while (Date.now() < homeDeadline) {
    try {
      if ((await bodyHas('Apps')) || (await bodyHas('Library'))) break;
    } catch {
      // Page may be navigating after pair-induced reload — keep polling.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Let the post-pair reload settle fully before any further navigation.
  await new Promise((r) => setTimeout(r, 3000));

  console.log('[repro] navigate /library');
  try {
    await page.goto('https://fairfox.fly.dev/library', { waitUntil: 'domcontentloaded' });
  } catch (err) {
    // If the goto raced another in-flight nav, retry once after a beat.
    await new Promise((r) => setTimeout(r, 2000));
    await page.goto('https://fairfox.fly.dev/library', { waitUntil: 'domcontentloaded' });
  }

  // Diagnostic: dump browser-side knownPeers from the fairfox-keyring IDB.
  const keyringInfo = await page.evaluate(async () => {
    return await new Promise<{ peers: string[]; docKeys: string[] }>((resolve) => {
      const req = indexedDB.open('fairfox-keyring', 1);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('keyring', 'readonly');
          const store = tx.objectStore('keyring');
          const getReq = store.get('default');
          getReq.onsuccess = () => {
            const k = getReq.result as
              | { knownPeers?: [string, number[]][]; documentKeys?: [string, number[]][] }
              | undefined;
            const peers = (k?.knownPeers ?? []).map((e) => e[0]);
            const docKeys = (k?.documentKeys ?? []).map((e) => e[0]);
            resolve({ peers, docKeys });
          };
          getReq.onerror = () => resolve({ peers: [], docKeys: [] });
        } catch {
          resolve({ peers: [], docKeys: [] });
        }
      };
      req.onerror = () => resolve({ peers: [], docKeys: [] });
    });
  });
  console.log(
    `[repro] browser keyring knownPeers (${keyringInfo.peers.length}):`,
    keyringInfo.peers.slice(0, 5)
  );
  console.log('[repro] browser keyring documentKeys:', keyringInfo.docKeys);

  // Poll for actual ref content. The library renders each reference in
  // a card; reading `signal.value.refs.length` from the page's runtime
  // is the strict check. Fall back to DOM heuristics if window.__lib
  // isn't exposed.
  const syncDeadline = Date.now() + 45_000;
  let refsSeen = 0;
  while (Date.now() < syncDeadline) {
    refsSeen = await page.evaluate(() => {
      // Strict: count visible ref title elements (each ref has a title).
      // The library App renders refs inside the Refs tab; look for
      // anything that's plausibly a ref entry. Conservative DOM-only
      // approach: any element whose text matches "by <author>" pattern
      // tends to be a ref row.
      const text = document.body.innerText || '';
      const lines = text.split('\n').filter((l) => /\bby\s+[A-Z]/.test(l));
      return lines.length;
    });
    if (refsSeen > 0) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`[repro] refs counted: ${refsSeen}`);

  // Dump WebRTC + WebSocket activity for diagnostics
  const rtcLog = await page.evaluate(() => (window as unknown as { __rtcLog?: string[] }).__rtcLog ?? []);
  const wsLog = await page.evaluate(() => (window as unknown as { __wsLog?: string[] }).__wsLog ?? []);
  console.log(`[repro] rtcLog (${rtcLog.length} entries):`);
  rtcLog.slice(0, 25).forEach((l) => console.log('  ', l));
  console.log(`[repro] wsLog (${wsLog.length} entries):`);
  wsLog.slice(0, 25).forEach((l) => console.log('  ', l));

  await page.screenshot({ path: '/tmp/repro-final.png', fullPage: true });
  if (ok) {
    console.log('[repro] SUCCESS — library populated (refs visible)');
  } else {
    const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 600));
    console.log('[repro] FAIL — library still empty after budget');
    console.log('[repro] last body:', body.replace(/\n+/g, ' | '));
  }
} finally {
  await browser.close();
  addDevice.kill('SIGTERM');
}

const log = readFileSync(ADD_DEVICE_LOG, 'utf8');
const paired = log.includes('✓ Paired');
console.log(`[repro] add-device pair-return received: ${paired}`);

process.exit(ok ? 0 : 1);
