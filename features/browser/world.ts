// What one @browser scenario holds between its steps: the test server, the
// page the scenario opened, and every error the browser reported on it.
import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createBdd, test as base } from 'playwright-bdd';
import { PHONE } from './phone.ts';
import { type Served, serveShell } from './serve.ts';

export class ShellWorld {
  readonly errors: string[] = [];
  private readonly browser: Browser;
  /** Playwright's own page for the scenario: a fresh context, no stored data. */
  private page: Page;
  private served: Served | null = null;
  private withoutScripts: BrowserContext | null = null;
  private opened: Page | null = null;

  constructor(browser: Browser, page: Page) {
    this.browser = browser;
    this.page = page;
  }

  serve(): void {
    this.served = serveShell();
  }

  /** A second fresh context on the same screen, with JavaScript turned off. */
  async turnScriptsOff(): Promise<void> {
    this.withoutScripts = await this.browser.newContext({ ...PHONE, javaScriptEnabled: false });
    this.page = await this.withoutScripts.newPage();
  }

  /** Open the shell, listening for errors from before the first byte arrives. */
  async open(width: number): Promise<void> {
    if (this.served === null) {
      throw new Error('No test server: the Background step "the built shell is served" did not run');
    }
    const page = this.page;
    page.on('pageerror', (error) => this.errors.push(`page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        this.errors.push(`console error: ${message.text()}`);
      }
    });
    expect(page.viewportSize()?.width, 'the width of the screen this scenario runs on').toBe(width);
    const response = await page.goto(this.served.origin);
    expect(response?.status(), `the test server's answer for ${this.served.origin}`).toBe(200);
    this.opened = page;
  }

  /**
   * Wait until the shell marks that it has drawn: data-shell="drawn" on
   * <html>, which it sets in the frame after it draws the name.
   */
  async untilDrawn(): Promise<void> {
    try {
      await expect(this.shown().locator('html')).toHaveAttribute('data-shell', 'drawn');
    } catch {
      throw new Error(
        `The shell never marked that it drew. The browser reported: ${this.errors.join('; ') || 'no error'}`,
      );
    }
  }

  shown(): Page {
    if (this.opened === null) {
      throw new Error('The shell was not opened: no When step opened it');
    }
    return this.opened;
  }

  async close(): Promise<void> {
    await this.withoutScripts?.close();
    await this.served?.stop();
  }
}

export const test = base.extend<{ world: ShellWorld }>({
  world: async ({ browser, page }, use) => {
    const world = new ShellWorld(browser, page);
    await use(world);
    await world.close();
  },
});

export const { Given, When, Then } = createBdd(test);
