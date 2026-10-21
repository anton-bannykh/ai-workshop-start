// An organization scanned, as it comes: JetBrains' repositories are listed as soon as each is scanned; open
// one, read a skill and filter while the others still come, then the result. Live GitHub: set GITHUB_TOKEN.
import type { Demo } from '../demo.ts';

export default async function organizationScan({ page, click, type, pause }: Demo) {
  await type(page.locator('#repo'), 'https://github.com/JetBrains');
  await click(page.locator('#scan'));
  const groups = page.locator('#skills .repository');
  await groups.nth(3).waitFor({ timeout: 60_000 });
  await pause(1200);

  // By its name: the others coming in move it down the list, never away.
  const id = (await groups.first().locator('summary').innerText()).split(' · ')[0].replace(/^❗\s*/, '');
  await click(page.locator('#skills .repository summary', { hasText: id }));
  await click(page.locator('#skills .repository', { hasText: id }).locator('li.skill .name').first());
  await pause(1500);

  await type(page.locator('#filter'), 'gradle');
  await pause(1500);
  await page.locator('#summary', { hasText: /scanned$/ }).waitFor({ timeout: 90_000 });
  await pause(2000);
}
