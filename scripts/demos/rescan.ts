// A new scan clears what the last one showed: JetBrains/kotlin, a skill chosen; then JetBrains/MPS, and
// while it scans, `Scanning…` on both sides, nothing of kotlin's to click; then MPS's groups, the first chosen.
// Live GitHub: set GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function rescan({ page, click, type, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab');
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(800);
  await click(page.locator('#skills li.skill .name', { hasText: 'build-bump-gradle-version' }));
  await pause(1200);

  // Another repository: the chosen SKILL.md, and its Similar skills →, gone while it scans.
  await click(page.locator('#repo'));
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await type(page.locator('#repo'), 'https://github.com/JetBrains/MPS');
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(1200);

  // Its groups: the first one chosen.
  await click(page.locator('#to-groups'));
  await page.locator('#columns').waitFor({ timeout: 60_000 });
  await pause(1800);
}
