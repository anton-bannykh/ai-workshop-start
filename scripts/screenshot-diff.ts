// The visual tests' screenshots that a change changed, before and after, with a red box around each part
// that differs, when that helps: not when the page changed throughout. Writes .demo/screenshots/; with
// --pr, uploads them (scripts/publish-demo.ts) and prints a `## Screenshots` section for the PR, each
// screenshot under a cut.
//
//   node scripts/screenshot-diff.ts [--base <ref>] [--pr <number>]
//
// The base is what the screenshots are compared with: by default where this branch left origin/main.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { publish } from './publish-demo.ts';

export type Box = { x: number; y: number; width: number; height: number };

const DIRECTORY = 'tests/visual/screenshots';
/** Differing pixels this close together are one part: a word, a row, a panel. */
const CELL = 16;
/** Room around a part, so the box doesn't cover it. */
const PADDING = 6;
/** Beyond this many parts, or this share of the page, boxes are clutter: the page changed throughout. */
const MAX_BOXES = 8;
const MAX_AREA = 0.35;
const RED = [229, 72, 77];

/**
 * The parts where two screenshots of the same size differ, as boxes; none if they are the same, and
 * undefined if they differ throughout, where boxes wouldn't help. Anti-aliasing alone is no difference.
 */
export function differences(before: PNG, after: PNG): Box[] | undefined {
  const { width, height } = after;
  const mask = new Uint8Array(width * height * 4);
  pixelmatch(before.data, after.data, mask, width, height, { threshold: 0.1, diffMask: true, diffColor: [255, 0, 0], aaColor: [0, 0, 255] });

  // The cells with a differing pixel, and the differing pixels' bounds in each.
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cells = new Map<number, Box & { right: number; bottom: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (mask[at] !== 255 || mask[at + 2] !== 0 || mask[at + 3] === 0) continue; // only the diff color
      const cell = Math.floor(y / CELL) * columns + Math.floor(x / CELL);
      const bounds = cells.get(cell);
      if (!bounds) cells.set(cell, { x, y, width: 0, height: 0, right: x, bottom: y });
      else Object.assign(bounds, { x: Math.min(bounds.x, x), y: Math.min(bounds.y, y), right: Math.max(bounds.right, x), bottom: Math.max(bounds.bottom, y) });
    }
  }

  // Cells next to each other, or one cell apart, are one part.
  const boxes: Box[] = [];
  const seen = new Set<number>();
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const part = { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity };
    for (const queue = [start]; queue.length > 0; ) {
      const cell = queue.pop()!;
      const bounds = cells.get(cell)!;
      Object.assign(part, { x: Math.min(part.x, bounds.x), y: Math.min(part.y, bounds.y), right: Math.max(part.right, bounds.right), bottom: Math.max(part.bottom, bounds.bottom) });
      const row = Math.floor(cell / columns);
      const column = cell % columns;
      for (let r = Math.max(0, row - 2); r <= Math.min(rows - 1, row + 2); r++) {
        for (let c = Math.max(0, column - 2); c <= Math.min(columns - 1, column + 2); c++) {
          const next = r * columns + c;
          if (cells.has(next) && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
    }
    const x = Math.max(0, part.x - PADDING);
    const y = Math.max(0, part.y - PADDING);
    boxes.push({ x, y, width: Math.min(width - 1, part.right + PADDING) - x + 1, height: Math.min(height - 1, part.bottom + PADDING) - y + 1 });
  }
  const area = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
  if (boxes.length > MAX_BOXES || area > MAX_AREA * width * height) return undefined;
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A copy of the image with a red frame, 3 px, around each box. */
export function framed(image: PNG, boxes: Box[]): PNG {
  const copy = PNG.sync.read(PNG.sync.write(image));
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= copy.width || y >= copy.height) return;
    const at = (y * copy.width + x) * 4;
    copy.data.set([...RED, 255], at);
  };
  for (const { x, y, width, height } of boxes) {
    for (let line = 0; line < 3; line++) {
      for (let i = x; i < x + width; i++) {
        paint(i, y + line);
        paint(i, y + height - 1 - line);
      }
      for (let j = y; j < y + height; j++) {
        paint(x + line, j);
        paint(x + width - 1 - line, j);
      }
    }
  }
  return copy;
}

type Change = { name: string; status: 'changed' | 'new' | 'removed'; before?: string; after?: string; note: string };

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Each changed, new or removed screenshot, its before and after written to the output directory. */
function changes(base: string, out: string): Change[] {
  const listed = git('diff', '--name-status', '--no-renames', base, '--', DIRECTORY).split('\n').filter(Boolean)
    .map((line) => line.split('\t') as [string, string]);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', DIRECTORY).split('\n').filter(Boolean)
    .map((path) => ['A', path] as [string, string]);
  const result: Change[] = [];
  for (const [status, path] of [...listed, ...untracked].sort((a, b) => a[1].localeCompare(b[1]))) {
    if (!path.endsWith('.png')) continue;
    const name = basename(path, '.png');
    const before = status === 'A' ? undefined : PNG.sync.read(execFileSync('git', ['show', `${base}:${path}`], { maxBuffer: 64 * 1024 * 1024 }));
    const after = status === 'D' ? undefined : PNG.sync.read(readFileSync(path));
    const write = (image: PNG, side: string) => {
      const file = join(out, `${name}.${side}.png`);
      writeFileSync(file, PNG.sync.write(image));
      return file;
    };
    if (!before) result.push({ name, status: 'new', after: write(after!, 'after'), note: 'new' });
    else if (!after) result.push({ name, status: 'removed', before: write(before, 'before'), note: 'removed' });
    else {
      const sized = before.width === after.width && before.height === after.height;
      const boxes = sized ? differences(before, after) : undefined;
      if (boxes?.length === 0) continue; // the same picture, written anew
      const note = !sized ? `resized, ${before.width}×${before.height} → ${after.width}×${after.height}`
        : !boxes ? 'changed throughout'
        : `changed in ${boxes.length} ${boxes.length === 1 ? 'place' : 'places'}, boxed in red`;
      result.push({ name, status: 'changed', before: write(boxes ? framed(before, boxes) : before, 'before'), after: write(boxes ? framed(after, boxes) : after, 'after'), note });
    }
  }
  return result;
}

/** The PR's `## Screenshots` section: a line for all, then each screenshot under a cut. */
function section(changes: Change[], url: (file: string) => string): string {
  if (changes.length === 0) return '## Screenshots\nUnchanged.';
  const counts = (['changed', 'new', 'removed'] as const)
    .map((status) => [status, changes.filter((change) => change.status === status).length] as const)
    .filter(([, n]) => n > 0).map(([status, n]) => `${n} ${status}`);
  const image = (file: string | undefined, alt: string) => (file ? `<img src="${url(file)}" alt="${alt}">` : '—');
  return [
    '## Screenshots',
    `${counts.join(', ')}. Each is in \`${DIRECTORY}/\` in "Files changed" too.`,
    ...changes.map((change) => [
      '',
      `<details><summary><code>${change.name}.png</code>: ${change.note}</summary>`,
      '',
      '| Before | After |',
      '| --- | --- |',
      `| ${image(change.before, `${change.name}, before`)} | ${image(change.after, `${change.name}, after`)} |`,
      '',
      '</details>',
    ].join('\n')),
  ].join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { base: { type: 'string' }, pr: { type: 'string' }, out: { type: 'string', default: '.demo/screenshots' } } });
  if (values.pr !== undefined && !/^\d+$/.test(values.pr)) throw new Error('Usage: node scripts/screenshot-diff.ts [--base <ref>] [--pr <number>]');
  const base = values.base ?? git('merge-base', 'origin/main', 'HEAD').trim();
  rmSync(values.out, { recursive: true, force: true });
  mkdirSync(values.out, { recursive: true });
  const found = changes(base, values.out);
  const files = found.flatMap((change) => [change.before, change.after].filter((file): file is string => !!file));
  const urls = new Map<string, string>();
  if (values.pr && files.length > 0) publish(values.pr, files).forEach((url, index) => urls.set(files[index], url));
  console.log(section(found, (file) => urls.get(file) ?? file));
}
