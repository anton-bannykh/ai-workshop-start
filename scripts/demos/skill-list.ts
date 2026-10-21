// The list of skills, made easier to scan: each skill's SKILL.md path instead of its whole link, and its
// description two lines at most; the whole link once chosen. Live GitHub: set GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function skillList({ page, click, move, scroll, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab'); // completes the sample link, JetBrains/kotlin
  await pause();
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(1500);

  // Down the list: name, a description cut at two lines, the path.
  const items = page.locator('#skills li.skill');
  for (let index = 0; index < Math.min(4, await items.count()); index++) {
    await move(items.nth(index).locator('.path'));
    await pause(600);
  }
  await scroll(page.locator('#list'), 400);
  await pause(1000);

  // Chosen by its name: the whole link, with the commit, is above its SKILL.md.
  await click(items.nth(5).locator('.name'));
  await pause(800);
  await move(page.locator('#skill .link'));
  await pause(2000);
}
