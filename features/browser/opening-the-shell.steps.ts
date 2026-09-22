// The steps of features/opening-the-shell.feature.
import { expect } from '@playwright/test';
import { Given, Then, When } from './world.ts';

Given('the built shell is served', ({ world }) => {
  world.serve();
});

Given('a browser with scripts turned off', async ({ world }) => {
  await world.turnScriptsOff();
});

When('the shell is opened on a screen {int}px wide', async ({ world }, width: number) => {
  await world.open(width);
});

Then('the shell shows the name {string}', async ({ world }, name: string) => {
  await expect(world.shown().getByText(name, { exact: true }), `the name ${name} on the page`).toBeVisible();
});

// The page scrolls sideways when anything on it is wider than the screen:
// the document is then wider than the viewport.
Then('nothing on the page is wider than the screen', async ({ world }) => {
  const page = world.shown();
  const screen = page.viewportSize();
  if (screen === null) {
    throw new Error('The page has no viewport, so it has no width to compare with');
  }
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide, `the page is ${wide}px wide on a screen ${screen.width}px wide: it scrolls sideways`).toBeLessThanOrEqual(
    screen.width,
  );
});

Then('the browser reports no error', ({ world }) => {
  expect(world.errors, 'the errors the browser reported').toEqual([]);
});

Then('the name {string} is not shown', async ({ world }, name: string) => {
  await expect(world.shown().locator('body'), `the name ${name} is shown with scripts turned off`).not.toContainText(
    name,
  );
});
