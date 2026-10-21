// The visual tests: the web view's key moments, screenshotted and compared with tests/visual/screenshots.
// Screenshots depend on fonts and the platform, so they are made in one place only, the Playwright image
// on linux/amd64, or a Linux that renders as it does (Ubuntu 24.04 on x86_64, its own system):
// `npm run test:visual` picks the one it can, locally and in CI.
import { defineConfig } from '@playwright/test';
import { PORT } from './tests/visual/server.ts';

if (!process.env.SKILL_ATLAS_VISUAL) {
  throw new Error('Run the visual tests with `npm run test:visual`, not `npx playwright test`: screenshots made here would not match.');
}

export default defineConfig({
  testDir: 'tests/visual',
  // One file per moment, the same name on every platform: the PR shows the old and the new side by side.
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  expect: {
    // Any pixel: the screenshots are made in the same image every time.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 },
  },
  webServer: {
    command: 'node tests/visual/server.ts',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
