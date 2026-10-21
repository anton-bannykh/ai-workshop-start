// Groups: from a skill of JetBrains/kotlin, its similar skills, those whose names share a word, side by
// side; another group, two of its skills compared line by line, the filter, and back to the skills.
// Live GitHub: set GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function groups({ page, click, move, type, scroll, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab');
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(800);

  // A skill, then its similar skills: the page of groups, the skill marked in its first group.
  await click(page.locator('#skills li.skill .name', { hasText: 'build-tools-bump-gradle-api' }));
  await pause(800);
  await click(page.locator('#skill .similar'));
  await page.locator('#columns').waitFor({ timeout: 60_000 });
  await pause(1500);
  await scroll(page.locator('#group'), 300);
  await pause(800);

  // Another group: the words its skills share, each one's own lines marked.
  const group = (words: string) => page.locator('#groups li.group .words', { hasText: words });
  await move(group('api'));
  await click(group('bump · gradle'));
  await pause(1500);

  // Two of them, line by line.
  await click(page.locator('#tab-two'));
  await pause(1200);
  await click(page.locator('#right'));
  await page.locator('#right').selectOption({ label: 'build-tools-bump-gradle-in-tests' });
  await page.keyboard.press('Escape');
  await pause(1500);

  await type(page.locator('#filter'), 'analysis');
  await pause(1200);
  await click(page.locator('#to-skills'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(800);
}
