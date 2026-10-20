// Records a demo of the web view: `./skill-atlas serve` as a user runs it, driven by a scenario, with
// the mouse drawn on the page (videos don't show it). Writes <out>/<name>.gif, inline on GitHub, and
// <out>/<name>.mp4. Needs ffmpeg and `npx playwright install chromium`.
//
//   node scripts/demo.ts [scenario.ts] [--out .demo] [--name demo]
//
// A scenario's default export gets a Demo; scripts/demos/flow.ts, the normal flow, is the default.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { chromium, type Locator, type Page } from 'playwright';

export type Demo = {
  page: Page;
  /** The web view's address, `http://127.0.0.1:<port>/`. */
  address: string;
  /** Moves the mouse there the way a hand does, then rests a moment. */
  move(target: Locator): Promise<void>;
  click(target: Locator): Promise<void>;
  /** Clicks the field, then types at a readable pace. */
  type(target: Locator, text: string): Promise<void>;
  /** Scrolls with the wheel, the mouse over the target. */
  scroll(target: Locator, pixels: number): Promise<void>;
  /** Time for the viewer to see what changed. */
  pause(ms?: number): Promise<void>;
};

const SIZE = { width: 1280, height: 800 };
const ROOT = resolve(import.meta.dirname, '..');

// An arrow that follows the mouse, and a ring on each click; drawn by the page, so the video has them.
const CURSOR = `addEventListener('DOMContentLoaded', () => {
  const arrow = document.createElement('div');
  arrow.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-8.5L21 10z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  arrow.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .08s';
  document.documentElement.append(arrow);
  addEventListener('mousemove', (event) => { arrow.style.left = event.clientX + 'px'; arrow.style.top = event.clientY + 'px'; }, true);
  addEventListener('mousedown', (event) => {
    arrow.style.transform = 'translate(-3px,-2px) scale(.85)';
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #e5484d;left:' + event.clientX + 'px;top:' + event.clientY + 'px;transition:transform .4s,opacity .4s';
    document.documentElement.append(ring);
    requestAnimationFrame(() => { ring.style.transform = 'scale(1.6)'; ring.style.opacity = '0'; });
    setTimeout(() => ring.remove(), 450);
  }, true);
  addEventListener('mouseup', () => { arrow.style.transform = 'translate(-3px,-2px)'; }, true);
});`;

/** `./skill-atlas serve 0`, and the address it prints. */
async function serve() {
  const server = spawn(join(ROOT, 'skill-atlas'), ['serve', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  const address = await new Promise<string>((done, fail) => {
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /Skill Atlas at (\S+)/.exec(output);
      if (match) done(match[1]);
    });
    server.on('exit', (code) => fail(new Error(`skill-atlas serve exited with ${code}: ${output}`)));
  });
  return { address, stop: () => server.kill() };
}

async function record(scenario: (demo: Demo) => Promise<void>, out: string, name: string) {
  const server = await serve();
  const videos = mkdtempSync(join(tmpdir(), 'skill-atlas-demo-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: videos, size: SIZE } });
    await context.addInitScript(CURSOR);
    const page = await context.newPage();
    let at = { x: SIZE.width / 2, y: SIZE.height / 2 };
    const pause = (ms = 800) => page.waitForTimeout(ms);
    const move = async (target: Locator) => {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error(`Not on the page: ${target}`);
      const to = { x: box.x + Math.min(box.width / 2, 40), y: box.y + box.height / 2 };
      // About 60 px a step: quick across the page, never a jump.
      await page.mouse.move(to.x, to.y, { steps: Math.max(8, Math.round(Math.hypot(to.x - at.x, to.y - at.y) / 60)) });
      at = to;
      await pause(250);
    };
    const click = async (target: Locator) => {
      await move(target);
      await page.mouse.down();
      await page.mouse.up();
      await pause(400);
    };
    const demo: Demo = {
      page,
      address: server.address,
      move,
      click,
      type: async (target, text) => {
        await click(target);
        await page.keyboard.type(text, { delay: 70 });
        await pause(400);
      },
      scroll: async (target, pixels) => {
        await move(target);
        for (let done = 0; done < Math.abs(pixels); done += 100) {
          await page.mouse.wheel(0, Math.sign(pixels) * 100);
          await page.waitForTimeout(60);
        }
        await pause(400);
      },
      pause,
    };
    await page.goto(server.address);
    await page.mouse.move(at.x, at.y);
    await pause(600);
    await scenario(demo);
    await pause(1200);
    await context.close(); // the video is written on close
  } finally {
    await browser.close();
    server.stop();
  }

  const [video] = readdirSync(videos).filter((file) => file.endsWith('.webm'));
  mkdirSync(out, { recursive: true });
  const gif = join(out, `${name}.gif`);
  const mp4 = join(out, `${name}.mp4`);
  ffmpeg('-i', join(videos, video), '-vf',
    // 64 colors, no dithering: a page is mostly flat, and its text stays sharp.
    'fps=10,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', gif);
  ffmpeg('-i', join(videos, video), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-crf', '28', mp4);
  rmSync(videos, { recursive: true, force: true });
  return { gif, mp4 };
}

function ffmpeg(...args: string[]) {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`ffmpeg failed: ${result.error?.message ?? result.status}`);
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', default: '.demo' }, name: { type: 'string' } } });
const file = resolve(positionals[0] ?? join(ROOT, 'scripts/demos/flow.ts'));
const { default: scenario } = (await import(pathToFileURL(file).href)) as { default: (demo: Demo) => Promise<void> };
const files = await record(scenario, resolve(values.out), values.name ?? basename(file).replace(/\.[^.]+$/, ''));
console.log(`${files.gif}\n${files.mp4}`);
