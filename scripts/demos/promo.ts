// A promotional video, about 30 s: a repository scanned and a skill read; then a whole organization,
// JetBrains, scanned, searched, and the copies of a skill across its repositories grouped and compared. The
// scans sped up, so they look instant; a caption on each step, a title card at the start and the end.
// Live GitHub: set GITHUB_TOKEN for its rate limit. The post that goes with it: docs/promo.md.
import type { Demo } from '../demo.ts';

const FONT = 'font-family:system-ui,-apple-system,sans-serif';

// Drawn by the page, as the mouse is (scripts/demo.ts): page scripts, as text, for the video to have them.
const CAPTION = (text: string) => `(() => {
  document.getElementById('promo-caption')?.remove();
  const text = ${JSON.stringify(text)};
  if (!text) return;
  const box = document.createElement('div');
  box.id = 'promo-caption';
  box.textContent = text;
  box.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483640;pointer-events:none;${FONT};font-size:20px;font-weight:600;padding:10px 22px;border-radius:999px;background:#1d1d1fe6;color:#fff;box-shadow:0 6px 24px #0004;white-space:nowrap';
  document.body.append(box);
})()`;
const CARD = (title: string, line: string) => `(() => {
  const box = document.createElement('div');
  box.id = 'promo-card';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:linear-gradient(135deg,#7057ff,#2b1e7a);color:#fff;${FONT};transition:opacity .5s';
  const big = document.createElement('div');
  big.textContent = ${JSON.stringify(title)};
  big.style.cssText = 'font-size:56px;font-weight:800;letter-spacing:-1px';
  const small = document.createElement('div');
  small.textContent = ${JSON.stringify(line)};
  small.style.cssText = 'font-size:22px;font-weight:500;opacity:.9;max-width:820px;text-align:center';
  box.append(big, small);
  document.body.append(box);
})()`;
const FADE = `document.getElementById('promo-card').style.opacity = '0'`;
const UNCARD = `document.getElementById('promo-card')?.remove()`;

export default async function promo({ page, click, type, pause, speedUp }: Demo) {
  /** A caption at the bottom of the page, until the next one; none for an empty text. */
  const caption = (text: string) => page.evaluate(CAPTION(text));
  /** A card over the whole page: a title, and a line under it. */
  const card = (title: string, line: string) => page.evaluate(CARD(title, line));
  const uncard = async () => {
    await page.evaluate(FADE);
    await pause(500);
    await page.evaluate(UNCARD);
  };

  await card('Skill Atlas', 'Every AI agent skill on your GitHub: found, read, compared.');
  await pause(1800);
  await uncard();

  // A repository: one link, every SKILL.md in it.
  await caption('Paste a repository link');
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab'); // completes the sample link, JetBrains/kotlin
  await click(page.locator('#scan'));
  await speedUp(() => page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 }));
  await caption('Every skill in it, in a second');
  await pause(900);
  await click(page.locator('#skills li.skill .name', { hasText: 'build-tools-bump-gradle-api' }));
  await caption('Each SKILL.md, formatted');
  await pause(1300);

  // A whole organization: every repository scanned, the scan sped up; the counts as the page shows them.
  await caption('Now a whole organization');
  await click(page.locator('#repo'));
  await page.keyboard.press('Control+A');
  await page.keyboard.type('https://github.com/JetBrains', { delay: 40 });
  await click(page.locator('#scan'));
  await speedUp(() => page.locator('#skills .repository').first().waitFor({ timeout: 300_000 }), 6);
  const summary = (await page.locator('#summary').textContent()) ?? '';
  const [, skills, scanned] = /(\d+) skills in \d+ repositories · (\d+) scanned/.exec(summary) ?? [];
  await caption(scanned ? `${scanned} repositories, ${skills} skills, in seconds` : 'Every repository, in seconds');
  await pause(1500);

  // Search all of them: the same skill, copied in two repositories.
  await type(page.locator('#filter'), 'style');
  await caption('Search them all');
  await click(page.locator('#toggle')); // Expand all
  await pause(1300);

  // Grouped: the copies side by side, then line by line, where they drifted apart.
  await caption('Copies across repositories, side by side');
  await click(page.locator('#to-groups'));
  await click(page.locator('#groups li.group .words span:first-child', { hasText: /^style$/ }));
  await page.locator('#columns').waitFor({ timeout: 60_000 });
  await pause(1600);
  await caption('And exactly where they drifted apart');
  await click(page.locator('#tab-two'));
  await pause(1900);
  await caption('');

  await card('Skill Atlas', 'Know every skill your agents use. A working proof of concept, ready to grow.');
  await pause(2500);
}
