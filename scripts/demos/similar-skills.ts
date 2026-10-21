// Similar skills →, on JetBrains/kotlin: the skill's group opens at its top, its words, count and tabs in view,
// the skill's column marked; then Compare two, reached from there. Live GitHub: set GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function similarSkills({ page, click, type, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab');
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(800);

  await type(page.locator('#filter'), 'bump');
  await click(page.locator('#skills li.skill .name', { hasText: 'build-bump-gradle-version' }));
  await pause(1200);
  await click(page.locator('#skill .similar'));
  await page.locator('#group h2').waitFor();
  await pause(2500);
  await click(page.locator('#tab-two'));
  await pause(2000);
}
