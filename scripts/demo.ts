// Records a demo of the web view: `./skill-atlas serve` as a user runs it, driven by a scenario, with
// the mouse drawn on the page. Writes <out>/<name>.webp, an animated image that GitHub shows inline and
// any browser plays, and <out>/<name>-sheet.png, frames from it to check. Needs img2webp (libwebp) and
// `npx playwright install chromium`.
//
//   node scripts/demo.ts [scenario.ts] [--out .demo] [--name demo]
//
// A scenario's default export gets a Demo; scripts/demos/flow.ts, the normal flow, is the default.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright';

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
  /** Plays what happens while it runs `times` faster: a wait, such as a long scan, made short. Not nested. */
  speedUp<T>(work: () => Promise<T>, times?: number): Promise<T>;
};

// Twice the pixels of the page, as on a high-density screen: GitHub shows it about this wide, sharp.
const SIZE = { width: 1100, height: 700 };
const SCALE = 2;
// A frame lasts until the page changes; at 2x, a screenshot takes about 70 ms, so about 14 a second.
const FRAME = 40;
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

type Frame = { data: Buffer; at: number };
/** A span of the recording played `times` faster. */
type Span = { from: number; to: number; times: number };

/** When a moment of the recording is played: the spans before it shortened. */
function played(at: number, spans: Span[]) {
  let shift = 0;
  for (const span of spans) {
    if (at <= span.from) break;
    shift += (Math.min(at, span.to) - span.from) * (1 - 1 / span.times);
  }
  return at - shift;
}

async function record(scenario: (demo: Demo) => Promise<void>, out: string, name: string) {
  const server = await serve();
  const work = mkdtempSync(join(tmpdir(), 'skill-atlas-demo-'));
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: SCALE });
    await context.addInitScript(CURSOR);
    const page = await context.newPage();
    let at = { x: SIZE.width / 2, y: SIZE.height / 2 };
    const pause = (ms = 800) => page.waitForTimeout(ms);
    const spans: Span[] = [];
    const move = async (target: Locator) => {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error(`Not on the page: ${target}`);
      const to = { x: box.x + Math.min(box.width / 2, 40), y: box.y + box.height / 2 };
      // Eased, and timed like a hand: long enough for the frames to catch it, never a jump.
      const from = at;
      const duration = Math.min(700, Math.max(300, Math.hypot(to.x - from.x, to.y - from.y)));
      const start = performance.now();
      for (let t = 0; t < 1; ) {
        t = Math.min(1, (performance.now() - start) / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        await page.mouse.move(from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased);
        await page.waitForTimeout(16);
      }
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
      speedUp: async (work, times = 8) => {
        const from = performance.now();
        try {
          return await work();
        } finally {
          spans.push({ from, to: performance.now(), times });
        }
      },
    };
    await page.goto(server.address);
    await page.mouse.move(at.x, at.y);

    // Screenshots in a loop, lossless and at the page's full density: a recorded video, or Chromium's
    // screencast, is at CSS pixels and blurry. Each frame is timed from when it was asked for.
    const frames: Frame[] = [];
    let recording = true;
    const capturing = (async () => {
      while (recording) {
        const at = performance.now();
        // The caret too: the default hides it, and typing shows it.
        const frame = await page.screenshot({ type: 'png', caret: 'initial' });
        // The same picture again: the last frame lasts longer.
        if (!frames.at(-1)?.data.equals(frame)) frames.push({ data: frame, at });
        const wait = FRAME - (performance.now() - at);
        if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      }
    })();
    try {
      await pause(600);
      await scenario(demo);
      await pause(1500);
    } finally {
      recording = false;
      await capturing;
    }
    // The sped-up spans shortened: each frame at the moment it is played.
    for (const frame of frames) frame.at = played(frame.at, spans);
    const end = played(performance.now(), spans);

    mkdirSync(out, { recursive: true });
    const webp = join(out, `${name}.webp`);
    const kept = encode(frames, end, work, webp);
    const sheet = join(out, `${name}-sheet.png`);
    await contactSheet(browser, kept, sheet);
    return { webp, sheet };
  } finally {
    // Whatever failed, from the browser's launch to the encoding: no server or frames left behind.
    await browser?.close();
    server.stop();
    rmSync(work, { recursive: true, force: true });
  }
}

/** Chromium, or what to run when it isn't installed yet: the likely first-run error. */
async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      throw new Error('Chromium is not installed: run `npx playwright install chromium`', { cause: error });
    }
    throw error;
  }
}

/** The frames as an animated WebP, each shown until the next; the frames it kept, with their files. */
function encode(frames: Frame[], end: number, work: string, webp: string) {
  if (frames.length === 0) throw new Error('No frames recorded');
  // Frames closer than FRAME: the latest picture, from the earlier time.
  const kept: Frame[] = [];
  for (const frame of frames) {
    const last = kept.at(-1);
    if (last && frame.at - last.at < FRAME) last.data = frame.data;
    else kept.push({ ...frame });
  }
  const args = ['-loop', '0', '-lossy', '-q', '90', '-m', '4', '-sharp_yuv', '-kmax', '50'];
  kept.forEach((frame, index) => {
    const file = join(work, `${String(index).padStart(5, '0')}.png`);
    writeFileSync(file, frame.data);
    const duration = (kept[index + 1]?.at ?? end) - frame.at;
    args.push('-d', String(Math.max(FRAME, Math.round(duration))), file);
  });
  const result = spawnSync('img2webp', [...args, '-o', webp], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.error) throw new Error(`img2webp: ${result.error.message}; install libwebp (brew install webp)`);
  if (result.status !== 0) throw new Error(`img2webp failed with ${result.status}`);
  return kept;
}

/** Eight moments of the demo, evenly apart, side by side: what to look at before publishing. */
async function contactSheet(browser: Browser, frames: Frame[], file: string) {
  const start = frames[0].at;
  const length = frames.at(-1)!.at - start;
  const shots = Array.from({ length: 8 }, (_, index) => {
    const time = start + (length * index) / 7;
    const frame = frames.findLast((candidate) => candidate.at <= time) ?? frames[0];
    return { second: ((frame.at - start) / 1000).toFixed(1), src: `data:image/png;base64,${frame.data.toString('base64')}` };
  });
  const page = await browser.newPage({ viewport: { width: 1300, height: 400 } });
  await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#888;font:14px sans-serif">${
    shots.map((shot) => `<figure style="margin:0;position:relative"><img src="${shot.src}" style="width:100%;display:block"><figcaption style="position:absolute;right:4px;bottom:4px;background:#000a;color:#fff;padding:1px 6px">${shot.second} s</figcaption></figure>`).join('')}</body>`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', default: '.demo' }, name: { type: 'string' } } });
const file = resolve(positionals[0] ?? join(ROOT, 'scripts/demos/flow.ts'));
const { default: scenario } = (await import(pathToFileURL(file).href)) as { default: (demo: Demo) => Promise<void> };
const files = await record(scenario, resolve(values.out), values.name ?? basename(file).replace(/\.[^.]+$/, ''));
console.log(`${files.webp}\n${files.sheet}`);
