import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentIntersects } from '../src/occupancy';
import { arc, boundsOf, type Shape } from '../src/geometry';
import { defaults, plan } from '../src/layout';
test('crossing lines are retained even when neither endpoint lies on the sheet', () => {
  assert.equal(
    segmentIntersects(
      [
        { x: -10, y: 50 },
        { x: 110, y: 50 },
      ],
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    ),
    true,
  );
  assert.equal(
    segmentIntersects(
      [
        { x: -10, y: 110 },
        { x: 110, y: 110 },
      ],
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    ),
    false,
  );
});
test('empty interiors of large outlines can be skipped without renumbering grid coordinates', () => {
  const shapes: Shape[] = [
    { layer: '0', commands: arc({ x: 0, y: 0 }, 500, 500, 0, 0, 2 * Math.PI) },
  ];
  const full = plan(boundsOf(shapes), defaults, shapes),
    sparse = plan(boundsOf(shapes), { ...defaults, skipEmpty: true }, shapes);
  assert.ok(sparse.skipped.length > 0);
  assert.equal(sparse.tiles.length + sparse.skipped.length, full.tiles.length);
  for (const tile of sparse.tiles) {
    assert.equal(tile.id, full.tiles.find((t) => t.row === tile.row && t.col === tile.col)!.id);
    for (const edge of Object.values(tile.edges))
      assert.ok(sparse.tiles.some((t) => t.id === edge.neighbor));
  }
  assert.deepEqual(
    sparse.tiles.map((t) => t.number),
    Array.from({ length: sparse.tiles.length }, (_, i) => i + 1),
  );
});
