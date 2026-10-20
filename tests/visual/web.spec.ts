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
