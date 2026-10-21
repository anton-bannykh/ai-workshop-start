// Expand all / Collapse all on an organization, filtered: it goes by the repositories shown, not the ones the
// filter hides; its label follows the filter. Live GitHub: set GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function expandAllFilter({ page, click, type, pause }: Demo) {
  await type(page.locator('#repo'), 'https://github.com/JetBrains');
  await click(page.locator('#scan'));
  await page.locator('#toggle').filter({ hasText: /all/ }).waitFor({ timeout: 300_000 });
  await pause(1500);

  // One repository left: Expand all until it is opened, then Collapse all.
  await type(page.locator('#filter'), 'mps-aspect');
  await pause(1500);
  await click(page.locator('#skills .repository:not([hidden]) summary'));
  await pause(2000);
  // Collapse all collapses it at once; Expand all opens it again, and only it.
  await click(page.locator('#toggle'));
  await pause(1500);
  await click(page.locator('#toggle'));
  await pause(1500);

  // Cleared: the other repositories, still closed, and the label follows.
  await click(page.locator('#filter'));
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await pause(2500);
}
