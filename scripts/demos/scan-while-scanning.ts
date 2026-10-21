// A link entered while a scan runs: the JetBrains organization's scan starts, and while it runs
// JetBrains/MPS is entered and Enter pressed. It is scanned at once, the organization's scan given up, and
// only MPS is shown, under its own link. Live GitHub: set GITHUB_TOKEN for its rate limit.
import type { Demo } from '../demo.ts';

export default async function scanWhileScanning({ page, click, type, pause }: Demo) {
  await type(page.locator('#repo'), 'https://github.com/JetBrains');
  await click(page.locator('#scan'));
  await page.locator('#summary', { hasText: /Scanning… \d+ of/ }).waitFor({ timeout: 60_000 });
  await pause(1500);

  // Changed one's mind: the repository instead, with Enter, while the organization is still scanned.
  await click(page.locator('#repo'));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('https://github.com/JetBrains/MPS', { delay: 70 });
  await pause(500);
  await page.keyboard.press('Enter');
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(2500);
  // Still MPS, a while later: the organization's scan, given up, never shows.
  await click(page.locator('#skills li.skill .name').nth(2));
  await pause(2000);
}
