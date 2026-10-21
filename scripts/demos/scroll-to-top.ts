// Another skill or group chosen opens at its top (#56): JetBrains/kotlin, a long SKILL.md scrolled down a few
// screens, then another skill: its name, link and tabs in sight. The same in the groups. Live GitHub: set
// GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function scrollToTop({ page, click, scroll, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab');
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause();

  const atTop = async (pane: string) => {
    const top = await page.locator(pane).evaluate((element) => element.scrollTop);
    if (top !== 0) throw new Error(`${pane} opened at scrollTop ${top}, not at its top`);
  };
  const skill = (name: string) => page.locator('#skills li.skill .name', { hasText: name });
  await click(skill('build-bump-gradle-version'));
  await pause();
  await scroll(page.locator('#skill'), 3000);
  await pause();
  await click(skill('build-tools-bump-gradle-api'));
  await atTop('#skill');
  await pause(2000);

  await click(page.locator('#to-groups'));
  const group = (words: string) => page.locator('#groups .group', { has: page.locator('.words > span:first-child', { hasText: new RegExp(`^${words}$`) }) });
  await click(group('build'));
  await pause();
  await scroll(page.locator('#group'), 2000);
  await pause();
  await click(group('api'));
  await atTop('#group');
  await pause(2000);
}
