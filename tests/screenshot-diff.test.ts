// scripts/screenshot-diff.ts: where two screenshots differ, boxed in red, and when boxes would not help.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { differences, framed } from '../scripts/screenshot-diff.ts';

/** A white image, with black rectangles. */
function image(width: number, height: number, ...rectangles: [number, number, number, number][]): PNG {
  const png = new PNG({ width, height });
  png.data.fill(255);
  for (const [x, y, w, h] of rectangles) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) png.data.set([0, 0, 0, 255], (j * width + i) * 4);
  }
  return png;
}

test('the same picture: no differences', () => {
  assert.deepEqual(differences(image(400, 300, [10, 10, 50, 20]), image(400, 300, [10, 10, 50, 20])), []);
});

test('one part changed: one box around it, with room', () => {
  assert.deepEqual(differences(image(400, 300), image(400, 300, [100, 50, 40, 10])), [{ x: 94, y: 44, width: 52, height: 22 }]);
});

test('parts far apart: a box each, top to bottom', () => {
  const boxes = differences(image(400, 300), image(400, 300, [300, 200, 20, 20], [20, 20, 20, 20]));
  assert.deepEqual(boxes?.map(({ x, y }) => [x, y]), [[14, 14], [294, 194]]);
});

test('parts close together: one box', () => {
  assert.equal(differences(image(400, 300), image(400, 300, [20, 20, 20, 10], [50, 20, 20, 10]))?.length, 1);
});

test('changed throughout: no boxes, they would not help', () => {
  assert.equal(differences(image(400, 300), image(400, 300, [0, 0, 400, 200])), undefined);
  const scattered = Array.from({ length: 12 }, (_, i) => [(i % 4) * 100 + 10, Math.floor(i / 4) * 100 + 10, 5, 5] as [number, number, number, number]);
  assert.equal(differences(image(400, 300), image(400, 300, ...scattered)), undefined);
});

test('a frame is red, around the box, and the image is otherwise the same', () => {
  const before = image(100, 100);
  const after = framed(before, [{ x: 10, y: 10, width: 30, height: 20 }]);
  const pixel = (png: PNG, x: number, y: number) => [...png.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)];
  assert.deepEqual(pixel(after, 10, 10), [229, 72, 77, 255]);
  assert.deepEqual(pixel(after, 39, 29), [229, 72, 77, 255]);
  assert.deepEqual(pixel(after, 20, 20), [255, 255, 255, 255]);
  assert.deepEqual(pixel(before, 10, 10), [255, 255, 255, 255], 'the original is untouched');
});
