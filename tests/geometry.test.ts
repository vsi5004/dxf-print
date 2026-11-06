import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arc, bulgeSegment, boundsOf, multiply, transform, type Shape } from '../src/geometry';
const near = (actual: number, expected: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
test('positive and negative bulges retain the correct side and exact extrema', () => {
  for (const sign of [1, -1]) {
    const shape: Shape = {
      layer: '0',
      commands: [
        { op: 'M', points: [{ x: 10, y: 0 }] },
        ...bulgeSegment({ x: 10, y: 0 }, { x: -10, y: 0 }, sign),
      ],
    };
    const bounds = boundsOf([shape]);
    near(bounds.minX, -10);
    near(bounds.maxX, 10);
    near(sign === 1 ? bounds.maxY : bounds.minY, sign * 10);
  }
});
test('cubic circle approximation stays within 0.001 mm for a 1m radius', () => {
  const commands = arc({ x: 0, y: 0 }, 1000, 1000, 0, 0, 2 * Math.PI);
  let previous = commands[0].points[0];
  for (const command of commands.slice(1)) {
    const [b, c, d] = command.points;
    for (let i = 0; i <= 20; i++) {
      const t = i / 20,
        u = 1 - t;
      const x =
          u * u * u * previous.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        y = u * u * u * previous.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y;
      near(Math.hypot(x, y), 1000, 0.001);
    }
    previous = d;
  }
});
test('nested affine transforms preserve translation and nonuniform scale', () => {
  const shape: Shape = {
    layer: '0',
    commands: [
      { op: 'M', points: [{ x: 0, y: 0 }] },
      { op: 'L', points: [{ x: 10, y: 5 }] },
    ],
  };
  const bounds = boundsOf([transform(shape, multiply([1, 0, 0, 1, 20, 30], [2, 0, 0, 3, 0, 0]))]);
  assert.deepEqual(bounds, { minX: 20, minY: 30, maxX: 40, maxY: 45 });
});
test('cubic bounds use derivative extrema, not the control-point box', () => {
  const bounds = boundsOf([
    {
      layer: '0',
      commands: [
        { op: 'M', points: [{ x: 0, y: 0 }] },
        {
          op: 'C',
          points: [
            { x: 0, y: 100 },
            { x: 100, y: 100 },
            { x: 100, y: 0 },
          ],
        },
      ],
    },
  ]);
  near(bounds.maxY, 75);
});
