import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, plan, columnName } from '../src/layout';
const bounds = { minX: 0, minY: 0, maxX: 431.8, maxY: 825.5 };
test('every shared edge has a reciprocal neighbor and identical seam ID', () => {
  const l = plan(bounds, defaults),
    opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
  for (const tile of l.tiles)
    for (const side of Object.keys(opposite) as (keyof typeof opposite)[]) {
      const edge = tile.edges[side];
      if (!edge) continue;
      const neighbor = l.tiles.find((t) => t.id === edge.neighbor)!;
      assert.equal(neighbor.edges[opposite[side]]?.neighbor, tile.id);
      assert.equal(neighbor.edges[opposite[side]]?.seam, edge.seam);
    }
});
test('shared trim lines and crosses coincide in drawing space', () => {
  const l = plan(bounds, defaults),
    o = defaults.overlap;
  for (const tile of l.tiles) {
    if (tile.edges.right) {
      const next = l.tiles.find((t) => t.id === tile.edges.right!.neighbor)!;
      assert.ok(Math.abs(tile.x + l.usableWidth - o / 2 - (next.x + o / 2)) < 1e-8);
      assert.equal(tile.y, next.y);
    }
    if (tile.edges.bottom) {
      const next = l.tiles.find((t) => t.id === tile.edges.bottom!.neighbor)!;
      assert.ok(Math.abs(tile.y - l.usableHeight + o / 2 - (next.y - o / 2)) < 1e-8);
      assert.equal(tile.x, next.x);
    }
  }
});
test('tile union encloses all geometry and a stroke padding', () => {
  const l = plan(bounds, defaults),
    first = l.tiles[0],
    last = l.tiles.at(-1)!;
  assert.ok(first.x <= bounds.minX - 1);
  assert.ok(first.y >= bounds.maxY + 1);
  assert.ok(last.x + l.usableWidth >= bounds.maxX + 1);
  assert.ok(last.y - l.usableHeight <= bounds.minY - 1);
});
test('landscape changes paper, never drawing scale', () => {
  const p = plan(bounds, defaults),
    l = plan(bounds, { ...defaults, orientation: 'landscape' });
  assert.equal(p.width, l.height);
  assert.deepEqual(l.bounds, bounds);
});
test('column names work beyond Z', () => {
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(701), 'ZZ');
});
test('invalid margins, overlaps, NaNs and excessive page counts fail clearly', () => {
  assert.throws(() => plan(bounds, { ...defaults, overlap: NaN }), /numeric/);
  assert.throws(() => plan(bounds, { ...defaults, margin: -1 }), /margins/);
  assert.throws(() => plan(bounds, { ...defaults, overlap: 100 }), /Overlap/);
  assert.throws(() => plan({ ...bounds, maxX: 100000, maxY: 100000 }, defaults), /400/);
});
