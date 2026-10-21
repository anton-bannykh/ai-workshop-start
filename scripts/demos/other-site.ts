// Another site can't drive the web view: the page itself scans JetBrains/kotlin; then a page on
// http://localhost:8123 frames it and asks /api/scan to scan the JetBrains organization: the frame stays empty and
// the scan is refused, 403, at once, nothing scanned. Its link to /?repo= can stay. Live GitHub: set GITHUB_TOKEN.
import { createServer } from 'node:http';
import type { Demo } from '../demo.ts';

const OTHER = 'http://localhost:8123/';

/** The other site's page: what the issue's reproduction does, and a plain link. */
function otherPage(target: string) {
  const kotlin = `${target}?repo=${encodeURIComponent('https://github.com/JetBrains/kotlin')}`;
  return `<!doctype html><meta charset="utf-8"><title>Another site</title>
<body style="font: 15px system-ui, sans-serif; margin: 24px">
<h1 style="margin: 0 0 8px">Another site, ${OTHER}</h1>
<p style="margin: 4px 0">It frames the web view and asks <code>${target}api/scan?repo=https://github.com/JetBrains</code>.</p>
<p id="log" style="margin: 4px 0; font-weight: bold; min-height: 1.3em"></p>
<iframe id="frame" width="1000" height="380" style="border: 2px dashed #e5484d"></iframe>
<p style="margin: 8px 0"><a id="link" href="${kotlin}">Open JetBrains/kotlin in Skill Atlas</a></p>
<script>
const start = performance.now();
fetch(${JSON.stringify(`${target}api/scan?repo=${encodeURIComponent('https://github.com/JetBrains')}`)}, { mode: 'no-cors' })
  .finally(() => { window.answeredIn = Math.round(performance.now() - start); });
document.getElementById('frame').src = ${JSON.stringify(kotlin)};
</script>`;
}

export default async function otherSite({ page, address, click, pause }: Demo) {
  // The web view's own page scans, as before.
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab');
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await pause(1500);

  const other = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(otherPage(address));
  });
  await new Promise<void>((done) => other.listen(8123, '127.0.0.1', done));
  try {
    // The other page can't read the answer; the browser can: shown on the page, so the demo says what the server did.
    const answered = page.waitForResponse((response) => response.url().includes('/api/scan'));
    await page.goto(`${OTHER}?target=${encodeURIComponent(address)}`);
    const response = await answered;
    await page.waitForFunction('window.answeredIn !== undefined');
    await page.evaluate(`document.getElementById('log').textContent =
      'Skill Atlas answered the scan: ${response.status()} ${response.statusText()}, after ' + window.answeredIn + ' ms, nothing scanned. The frame is refused.'`);
    await pause(4000);
  } finally {
    other.close();
  }
}
