import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MaxRectsNester } from '../src/maxrects-nester';
import { RectangleNester, type NestedDrawing, type Part } from '../src/nesting';
import { boundsOf, type Shape } from '../src/geometry';
import { defaults, plan, type Settings } from '../src/layout';

function parts(sizes: number[][]): Part[] {
  return sizes.map(([width, height], index) => ({
    id: String(index),
    name: `part-${index}`,
    shapes: [
      {
        layer: '0',
        commands: [
          { op: 'M', points: [{ x: 0, y: 0 }] },
          { op: 'L', points: [{ x: width, y: 0 }] },
          { op: 'L', points: [{ x: width, y: height }] },
          { op: 'L', points: [{ x: 0, y: height }] },
          { op: 'Z', points: [] },
        ],
      } as Shape,
    ],
  }));
}
const sheets = (drawing: NestedDrawing, settings: Settings = defaults) =>
  plan(boundsOf(drawing.shapes), settings, drawing.shapes).tiles.length;
function assertClearance(drawing: NestedDrawing, gap: number): void {
  for (let i = 0; i < drawing.placements.length; i++)
    for (let j = i + 1; j < drawing.placements.length; j++) {
      const a = drawing.placements[i].bounds,
        b = drawing.placements[j].bounds;
      assert.ok(
        a.maxX + gap <= b.minX + 1e-7 ||
          b.maxX + gap <= a.minX + 1e-7 ||
          a.maxY + gap <= b.minY + 1e-7 ||
          b.maxY + gap <= a.minY + 1e-7,
        `parts ${i} and ${j} violate clearance`,
      );
    }
}

// These heterogeneous parts expose gaps the previous shelf heuristic cannot fill well.
export const mixedSizes = [
  [189, 66],
  [49, 40],
  [51, 74],
  [20, 109],
  [114, 43],
  [158, 49],
  [127, 106],
  [195, 107],
  [82, 40],
  [177, 119],
  [63, 69],
  [37, 57],
];
test('mixed-size regression uses three Letter sheets instead of four', () => {
  const input = parts(mixedSizes),
    before = JSON.stringify(input),
    baseline = new RectangleNester().nest(input, defaults, 5, true),
    optimized = new MaxRectsNester().nest(input, defaults, 5, true);
  assert.equal(sheets(baseline), 4);
  assert.equal(sheets(optimized), 3);
  assert.equal(optimized.report?.baselineSheets, 4);
  assert.equal(optimized.report?.sheets, 3);
  assert.equal(optimized.report?.algorithm, 'maxrects');
  assertClearance(optimized, 5);
  assert.equal(optimized.placements.length, input.length);
  assert.equal(new Set(optimized.placements.map((p) => p.partId)).size, input.length);
  assert.equal(JSON.stringify(input), before);
});
test('parts rotate independently when enabled, and never rotate when disabled', () => {
  const input = parts([
      [110, 160],
      [110, 160],
    ]),
    nester = new MaxRectsNester();
  const fixed = nester.nest(input, defaults, 5, false),
    rotated = nester.nest(input, defaults, 5, true);
  assert.equal(sheets(fixed), 2);
  assert.equal(sheets(rotated), 1);
  assert.ok(fixed.placements.every((p) => p.rotation === 0));
  assert.ok(rotated.placements.some((p) => p.rotation === 90));
  for (const placement of rotated.placements) {
    const width = placement.bounds.maxX - placement.bounds.minX,
      height = placement.bounds.maxY - placement.bounds.minY;
    assert.ok(Math.abs(width - (placement.rotation === 90 ? 160 : 110)) < 1e-7);
    assert.ok(Math.abs(height - (placement.rotation === 90 ? 110 : 160)) < 1e-7);
  }
  assertClearance(rotated, 5);
});
test('deterministic mixed-size fixtures never increase actual sheet count or violate spacing', () => {
  let seed = 73021;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let run = 0; run < 16; run++) {
    const input = parts(
      Array.from({ length: 5 + Math.floor(random() * 10) }, () => [
        20 + Math.floor(random() * 200),
        20 + Math.floor(random() * 200),
      ]),
    );
    const settings = {
        ...defaults,
        orientation: run % 2 ? 'landscape' : 'portrait',
        skipEmpty: run % 4 === 0,
      } as Settings,
      gap = run % 2 ? 7.5 : 5,
      rotate = run % 3 !== 0;
    const baseline = new RectangleNester().nest(input, settings, gap, rotate),
      optimized = new MaxRectsNester().nest(input, settings, gap, rotate);
    assert.ok(sheets(optimized, settings) <= sheets(baseline, settings));
    assertClearance(optimized, gap);
    assert.equal(optimized.report?.sheets, sheets(optimized, settings));
    if (!rotate) assert.ok(optimized.placements.every((p) => p.rotation === 0));
  }
});
test('the same input produces identical placements and retains single-part scale and origin', () => {
  const input = parts(mixedSizes),
    nester = new MaxRectsNester();
  assert.deepEqual(nester.nest(input, defaults, 5, true), nester.nest(input, defaults, 5, true));
  const single = parts([[123.4, 56.7]]);
  assert.deepEqual(nester.nest(single, defaults, 5, true).shapes, single[0].shapes);
});
