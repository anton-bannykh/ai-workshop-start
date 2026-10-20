// When each skill was last modified: in grey, DD-MM-YY, on the right of its name in the list, and under
// its link once chosen. Live GitHub: set GITHUB_TOKEN, which the dates need.
import type { Demo } from '../demo.ts';

export default async function modified({ page, click, move, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab'); // completes the sample link, JetBrains/kotlin
  await pause();
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill .modified').first().waitFor({ timeout: 60_000 });
  await pause(1200);

  // Down the list, by the dates.
  const dates = page.locator('#skills li.skill .modified');
  for (let index = 0; index < Math.min(4, await dates.count()); index++) {
    await move(dates.nth(index));
    await pause(500);
  }

  // Chosen by its name: the rest of the item has a link, which opens GitHub. Its date is under its link.
  await click(page.locator('#skills li.skill .name').nth(2));
  await pause(800);
  await move(page.locator('#skill .modified'));
  await pause(2000);
}
