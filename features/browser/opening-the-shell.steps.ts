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

// Nothing on the page is wider than the screen: no element's box ends past
// the right edge of the screen, whether or not an ancestor clips it from
// view, and the page does not scroll sideways.
Then('nothing on the page is wider than the screen', async ({ world }) => {
  const page = world.shown();
  const screen = page.viewportSize();
  if (screen === null) {
    throw new Error('The page has no viewport, so it has no width to compare with');
  }
  const past = await page.evaluate((edge) => {
    const found: string[] = [];
    for (const element of document.querySelectorAll('*')) {
      const right = element.getBoundingClientRect().right + window.scrollX;
      if (right > edge + 0.5) {
        found.push(`<${element.localName}> ends at ${Math.round(right)}px`);
      }
    }
    const wide = document.documentElement.scrollWidth;
    if (wide > edge) {
      found.push(`the page is ${wide}px wide and scrolls sideways`);
    }
    return found;
  }, screen.width);
  expect(past, `what ends past the right edge of the screen, at ${screen.width}px`).toEqual([]);
});

// The errors this step reads are those the browser reported from the moment
// the page was opened until the shell marked that it has drawn: the step waits
// for that mark, then reads them. An error after the mark is not covered.
Then('the browser reports no error', async ({ world }) => {
  await world.untilDrawn();
  expect(world.errors, 'the errors the browser reported').toEqual([]);
});

Then('the name {string} is not shown', async ({ world }, name: string) => {
  await expect(world.shown().locator('body'), `the name ${name} is shown with scripts turned off`).not.toContainText(
    name,
  );
});
