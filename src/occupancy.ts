import type { Bounds, Point, Shape } from './geometry';
export type Segment = readonly [Point, Point];
function distanceToLine(p: Point, a: Point, b: Point): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length === 0
    ? Math.hypot(p.x - a.x, p.y - a.y)
    : Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / length;
}
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Adaptive flattening is only used to detect ink. PDF and preview retain cubic curves. */
export function segmentsOf(shapes: Shape[]): Segment[] {
  const result: Segment[] = [];
  function flatten(a: Point, b: Point, c: Point, d: Point, depth = 0) {
    if (depth >= 16 || Math.max(distanceToLine(b, a, d), distanceToLine(c, a, d)) <= 0.01) {
      result.push([a, d]);
      return;
    }
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      cd = midpoint(c, d),
      abc = midpoint(ab, bc),
      bcd = midpoint(bc, cd),
      middle = midpoint(abc, bcd);
    flatten(a, ab, abc, middle, depth + 1);
    flatten(middle, bcd, cd, d, depth + 1);
  }
  for (const shape of shapes) {
    let current: Point = { x: 0, y: 0 },
      first = current;
    for (const command of shape.commands) {
      if (command.op === 'M') {
        current = command.points[0];
        first = current;
      } else if (command.op === 'L') {
        result.push([current, command.points[0]]);
        current = command.points[0];
      } else if (command.op === 'C') {
        flatten(current, command.points[0], command.points[1], command.points[2]);
        current = command.points[2];
      } else {
        result.push([current, first]);
        current = first;
      }
    }
  }
  return result;
}
/** Liang–Barsky clipping catches lines crossing a sheet even if both endpoints are outside. */
export function segmentIntersects([a, b]: Segment, rect: Bounds): boolean {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let low = 0,
    high = 1;
  const p = [-dx, dx, -dy, dy],
    q = [a.x - rect.minX, rect.maxX - a.x, a.y - rect.minY, rect.maxY - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-14) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) low = Math.max(low, t);
      else high = Math.min(high, t);
      if (low > high) return false;
    }
  }
  return true;
}
