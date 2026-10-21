// The front matter's numbers as the file writes them: version 1.10, not 1.1; the same in the Raw tab.
// No GitHub repository has such a skill, so a directory it writes: /tmp/skill-atlas-demo, nothing of this machine's.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Demo } from '../demo.ts';

const ROOT = '/tmp/skill-atlas-demo';

export default async function frontMatterNumbers({ page, click, type, pause }: Demo) {
  mkdirSync(`${ROOT}/.claude/skills/release`, { recursive: true });
  writeFileSync(
    `${ROOT}/.claude/skills/release/SKILL.md`,
    '---\nname: release\ndescription: Cuts a release of the plugin and publishes it to the Marketplace.\n'
      + 'version: 1.10\nsince-build: 2024.30\nuntil-build: 0242\n---\n# Release\n\nBump the version, tag the commit, publish.\n',
  );
  await type(page.locator('#repo'), ROOT);
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(2500);
  await click(page.locator('#tab-raw'));
  await pause(2500);
  await click(page.locator('#tab-formatted'));
  await pause(2000);
}
