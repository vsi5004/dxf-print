import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RectangleNester, type Part } from '../src/nesting';
import { defaults, plan } from '../src/layout';
import { boundsOf, type Shape } from '../src/geometry';
function part(id: number, w: number, h: number): Part {
  const shape: Shape = {
    layer: '0',
    commands: [
      { op: 'M', points: [{ x: 0, y: 0 }] },
      { op: 'L', points: [{ x: w, y: 0 }] },
      { op: 'L', points: [{ x: w, y: h }] },
      { op: 'L', points: [{ x: 0, y: h }] },
      { op: 'Z', points: [] },
    ],
  };
  return { id: String(id), name: `part-${id}`, shapes: [shape] };
}
test('nesting never overlaps component rectangles and preserves requested clearance', () => {
  const parts = Array.from({ length: 12 }, (_, i) =>
    part(i, 30 + ((i * 37) % 170), 20 + ((i * 19) % 140)),
  );
  const result = new RectangleNester().nest(parts, defaults, 5, true);
  assert.equal(result.placements.length, parts.length);
  for (let i = 0; i < result.placements.length; i++)
    for (let j = i + 1; j < result.placements.length; j++) {
      const a = result.placements[i].bounds,
        b = result.placements[j].bounds;
      assert.ok(
        a.maxX + 5 <= b.minX + 1e-7 ||
          b.maxX + 5 <= a.minX + 1e-7 ||
          a.maxY + 5 <= b.minY + 1e-7 ||
          b.maxY + 5 <= a.minY + 1e-7,
      );
    }
});
test('small DXFs share a sheet instead of each consuming a page', () => {
  const result = new RectangleNester().nest(
    [part(1, 50, 50), part(2, 50, 50), part(3, 50, 50)],
    defaults,
    5,
    true,
  );
  assert.equal(plan(boundsOf(result.shapes), defaults, result.shapes).tiles.length, 1);
});
test('rotation can be disabled and packing is deterministic', () => {
  const parts = [part(1, 200, 30), part(2, 30, 150), part(3, 80, 70)],
    nester = new RectangleNester();
  const result = nester.nest(parts, defaults, 5, false);
  assert.ok(result.placements.every((p) => p.rotation === 0));
  assert.deepEqual(result, nester.nest(parts, defaults, 5, false));
});
test('invalid nesting parameters fail without changing the source drawings', () => {
  const parts = [part(1, 10, 20)],
    before = JSON.stringify(parts);
  assert.throws(() => new RectangleNester().nest(parts, defaults, 0, true), /spacing/);
  assert.equal(JSON.stringify(parts), before);
});
