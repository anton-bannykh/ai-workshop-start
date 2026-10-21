// The web view's key moments, from spec/web.md, each a screenshot in tests/visual/screenshots. GitHub
// answers from recordings (tests/visual/server.ts), so a change in a screenshot is a change in the page.
import { expect, test, type Page } from '@playwright/test';

async function scan(page: Page, repo: string) {
  await page.goto('/');
  await page.locator('#repo').fill(repo);
  await page.locator('#scan').click();
  // Scan is disabled while it scans: enabled again, the page shows the result or the error.
  await expect(page.locator('#scan')).toBeEnabled();
}

const skill = (page: Page, name: string) => page.locator('#skills li.skill', { has: page.locator('.name', { hasText: name }) });

test('the empty page: a field for a link, and what to do', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('empty.png');
});

test('Tab completes the sample link', async ({ page }) => {
  await page.goto('/');
  await page.locator('#repo').press('Tab');
  await expect(page.locator('#repo')).toHaveValue('https://github.com/JetBrains/kotlin');
  await expect(page).toHaveScreenshot('tab-completion.png');
});

test('a repository: its skills, the first chosen, its SKILL.md formatted', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/handbook');
  await expect(page.locator('#summary')).toHaveText('JetBrains/handbook · 2 skills');
  await expect(page).toHaveScreenshot('repository.png');
});

test('the Raw tab: the SKILL.md as it is in the file', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/handbook');
  await page.locator('#tab-raw').click();
  await expect(page).toHaveScreenshot('raw.png');
});

test('another skill chosen, with its copy', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/handbook');
  await skill(page, 'review').locator('.name').click();
  await expect(page.locator('#skill h2')).toHaveText('review');
  await expect(page).toHaveScreenshot('copy.png');
});

test('the filter: only the skills whose name contains it, and the counts of those', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/handbook');
  await page.locator('#filter').fill('REL');
  await expect(page.locator('#summary')).toHaveText('JetBrains/handbook · 1 of 2 skills');
  await expect(page).toHaveScreenshot('filter.png');
});

test('the filter keeps nothing', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/handbook');
  await page.locator('#filter').fill('deploy');
  await expect(page.locator('#no-match')).toBeVisible();
  await expect(page).toHaveScreenshot('filter-no-match.png');
});

test('an organization: a collapsed group per repository, ❗ on those with warnings', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains');
  await expect(page.locator('#toggle')).toHaveText('Expand all');
  await expect(page).toHaveScreenshot('organization.png');
});

test('an organization, all expanded: each repository’s warnings in its group, above its skills', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains');
  await page.locator('#toggle').click();
  await expect(page.locator('#toggle')).toHaveText('Collapse all');
  await expect(page).toHaveScreenshot('organization-expanded.png');
});

test('a skill with a warning: the warning above its SKILL.md', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains');
  await page.locator('#toggle').click();
  await skill(page, 'build').locator('.name').click();
  await expect(page.locator('#skill .warning')).toBeVisible();
  await expect(page).toHaveScreenshot('skill-warning.png');
});

test('an organization, filtered: groups that keep nothing are hidden', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains');
  await page.locator('#toggle').click();
  await page.locator('#filter').fill('lint');
  await expect(page.locator('#summary')).toContainText('1 of');
  await expect(page).toHaveScreenshot('organization-filter.png');
});

test('an organization, filtered, its one repository left opened: Collapse all', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains');
  await page.locator('#filter').fill('lint');
  await expect(page.locator('#toggle')).toHaveText('Expand all');
  await page.locator('#skills .repository:not([hidden]) summary').click();
  await expect(page.locator('#toggle')).toHaveText('Collapse all');
  await expect(page).toHaveScreenshot('organization-filter-opened.png');
});

test('a repository that does not exist: a clear message', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/no-such-repository');
  await expect(page.locator('#messages .error')).toHaveText('Repository not found: https://github.com/JetBrains/no-such-repository');
  await expect(page).toHaveScreenshot('not-found.png');
});

test('/?repo=<link> opens the page with that repository scanned', async ({ page }) => {
  await page.goto(`/?repo=${encodeURIComponent('https://github.com/JetBrains/example')}`);
  await expect(page.locator('#summary')).toHaveText('JetBrains/example · 1 skill');
  await expect(page).toHaveScreenshot('link.png');
});

test('Groups: the same scan grouped, in the page; the field and the filter stay, and the skills as they were', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/playbook');
  await page.locator('#filter').fill('review');
  await skill(page, 'security-review').locator('.name').click();
  let scans = 0;
  page.on('request', (request) => { if (request.url().includes('/api/')) scans++; });
  await page.locator('#to-groups').click();
  await expect(page).toHaveURL(`/?repo=${encodeURIComponent('https://github.com/JetBrains/playbook')}&view=groups`);
  await expect(page.locator('#groups-summary')).toHaveText('JetBrains/playbook · 1 of 2 groups · 4 skills');
  await expect(page.locator('#repo')).toHaveValue('https://github.com/JetBrains/playbook');
  await expect(page.locator('#filter')).toHaveValue('review');
  await expect(page).toHaveScreenshot('groups-kept.png');
  await page.locator('#to-skills').click();
  await expect(page.locator('#skill h2')).toHaveText('security-review');
  await expect(page.locator('#summary')).toHaveText('JetBrains/playbook · 2 of 4 skills');
  expect(scans).toBe(0);
});

test('Tab completes the sample link on the groups too', async ({ page }) => {
  await page.goto('/?view=groups');
  await page.locator('#repo').press('Tab');
  await expect(page.locator('#repo')).toHaveValue('https://github.com/JetBrains/kotlin');
  await expect(page.locator('#groups-view')).toBeVisible();
});

/** The groups, with the repository scanned. */
async function groups(page: Page, repo: string) {
  await page.goto(`/?repo=${encodeURIComponent(repo)}&view=groups`);
  await expect(page.locator('#scan')).toBeEnabled();
  await expect(page.locator('#groups-summary')).not.toHaveText('Scanning…');
}

const group = (page: Page, words: string) => page.locator('#groups li.group', { has: page.locator('.words', { hasText: words }) });

test('groups: the skills whose names share a word, the first group side by side, what all share in grey, what is only one’s marked', async ({ page }) => {
  await groups(page, 'https://github.com/JetBrains/playbook');
  await expect(page.locator('#groups-summary')).toHaveText('JetBrains/playbook · 2 groups · 4 skills');
  await expect(page.locator('#group h2')).toHaveText('release');
  await expect(page).toHaveScreenshot('groups.png');
});

test('groups: another group chosen', async ({ page }) => {
  await groups(page, 'https://github.com/JetBrains/playbook');
  await group(page, 'review').click();
  await expect(page.locator('#group h2')).toHaveText('review');
  await expect(page).toHaveScreenshot('groups-review.png');
});

test('groups: two skills compared, line by line', async ({ page }) => {
  await groups(page, 'https://github.com/JetBrains/playbook');
  await group(page, 'review').click();
  await page.locator('#tab-two').click();
  await expect(page.locator('#pair .stats')).toHaveText('2 lines the same · 6 only in the first · 6 only in the second');
  await expect(page).toHaveScreenshot('groups-compare.png');
});

test('groups: the filter keeps the groups with a skill whose name contains it', async ({ page }) => {
  await groups(page, 'https://github.com/JetBrains/playbook');
  await page.locator('#filter').fill('SECUR');
  await expect(page.locator('#groups-summary')).toHaveText('JetBrains/playbook · 1 of 2 groups · 4 skills');
  await expect(page).toHaveScreenshot('groups-filter.png');
});

test('groups: no two skills share a word of their names', async ({ page }) => {
  await groups(page, 'https://github.com/JetBrains/handbook');
  await expect(page.locator('#group .empty')).toHaveText('No two skills here share a word of their names.');
  await expect(page).toHaveScreenshot('groups-none.png');
});

test('groups opened from a skill’s link: its group chosen, the skill marked; no new scan', async ({ page }) => {
  await scan(page, 'https://github.com/JetBrains/playbook');
  await skill(page, 'security-review').locator('.name').click();
  let scans = 0;
  page.on('request', (request) => { if (request.url().includes('/api/')) scans++; });
  await page.locator('#skill .similar').click();
  await expect(page).toHaveURL(/\/\?repo=.*&view=groups&skill=/);
  expect(scans).toBe(0);
  await expect(page.locator('#group h2')).toHaveText('review');
  await expect(page.locator('.column.wanted .name')).toHaveText('security-review');
  await expect(page).toHaveScreenshot('groups-skill.png');
});
