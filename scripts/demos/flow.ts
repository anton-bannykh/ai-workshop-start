// The normal flow: Tab completes the sample link, JetBrains/kotlin; scan it, read a skill's SKILL.md
// formatted and raw, filter by name. Live GitHub: set GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function flow({ page, click, move, type, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab');
  await pause();
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(1200);

  // By its name: the rest of the item has a link, which opens GitHub.
  const skill = (name: string) => page.locator('#skills li.skill .name', { hasText: name });
  await move(skill('analysis-api-mark-internal-apis'));
  await click(skill('build-tools-bump-gradle-api'));
  await pause(1500);
  await click(page.locator('#tab-raw'));
  await pause(1500);
  await click(page.locator('#tab-formatted'));
  await pause();

  await type(page.locator('#filter'), 'bump');
  await pause(1500);
  await click(skill('build-bump-gradle-version'));
  await pause(1500);
}
