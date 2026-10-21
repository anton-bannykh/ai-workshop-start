// A request for a path like //a:b/ (issue #40): the server answers 404 and stays up. Scan JetBrains/kotlin,
// send `GET //a:b/` as it is, then scan JetBrains/MPS. Live GitHub: set GITHUB_TOKEN for its rate limit.
import { connect } from 'node:net';
import type { Demo } from '../demo.ts';

/** `GET <target>` sent byte for byte, as `curl --path-as-is` does; the status line of the answer. */
function sent(address: string, target: string): Promise<string> {
  const { host, hostname, port } = new URL(address);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => socket.end(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
    let answer = '';
    socket.on('data', (chunk) => (answer += chunk));
    socket.on('end', () => resolve(answer.split('\r\n')[0] || 'no answer'));
    socket.on('error', reject);
  });
}

export default async function oddPath({ page, address, click, pause }: Demo) {
  const scan = async (repo: string) => {
    await page.locator('#repo').fill('');
    await click(page.locator('#repo'));
    await page.keyboard.type(repo, { delay: 25 });
    await click(page.locator('#scan'));
    await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  };
  // Drawn by the page, as the cursor is (a string: the page's DOM isn't typed here).
  const caption = (text: string) => page.evaluate(`{
    const box = document.getElementById('demo-caption') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'demo-caption' }));
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483645;background:#000c;color:#fff;font:15px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:6px';
    box.textContent = ${JSON.stringify(text)};
  }`);

  await scan('https://github.com/JetBrains/kotlin');
  await pause(1500);

  const status = await sent(address, '//a:b/');
  await caption(`GET //a:b/ → ${status}: the server stays up`);
  await pause(2500);

  await scan('https://github.com/JetBrains/MPS');
  await caption('JetBrains/MPS scanned after it');
  await pause(2500);
}
