// The screen every @browser scenario opens on (U1): the smallest phone a
// member uses, 320px wide in CSS px. The owner's phone is an iPhone 12 mini;
// its own width is not measured, so the width is the owner's 320, not the
// device's 375. After eal's `mobile-350` project, set to 320px, and in WebKit,
// the owner's choice: a mobile user agent, touch, the device pixel ratio and
// the page's meta viewport all in play, which a narrowed desktop window has
// none of. `playwright.config.ts` and the scenario that turns scripts off both
// read it, so the two browsers of a run open the same screen.
import { devices } from '@playwright/test';

const mini = devices['iPhone 12 Mini'];

export const WIDTH = 320;

export const PHONE = {
  userAgent: mini.userAgent,
  deviceScaleFactor: mini.deviceScaleFactor,
  isMobile: mini.isMobile,
  hasTouch: mini.hasTouch,
  viewport: { width: WIDTH, height: mini.viewport.height },
};
