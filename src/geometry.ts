export type Point = { x: number; y: number };
export type Command = { op: 'M' | 'L' | 'C' | 'Z'; points: Point[] };
export type Shape = { commands: Command[]; layer: string };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Matrix = [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export const apply = (p: Point, m: Matrix): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transform(shape: Shape, m: Matrix): Shape {
  return {
    ...shape,
    commands: shape.commands.map((c) => ({ ...c, points: c.points.map((p) => apply(p, m)) })),
  };
}
// Short cubic arcs preserve vector output with negligible radial error at template sizes.
export function arc(
  center: Point,
  rx: number,
  ry: number,
  rotation: number,
  start: number,
  sweep: number,
): Command[] {
  if (
    ![center.x, center.y, rx, ry, rotation, start, sweep].every(Number.isFinite) ||
    Math.abs(sweep) > 2 * Math.PI + 1e-8
  )
    throw new Error('Invalid or excessive arc coordinates.');
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 8)));
  const point = (t: number): Point => ({
    x: center.x + rx * Math.cos(t) * Math.cos(rotation) - ry * Math.sin(t) * Math.sin(rotation),
    y: center.y + rx * Math.cos(t) * Math.sin(rotation) + ry * Math.sin(t) * Math.cos(rotation),
  });
  const derivative = (t: number): Point => ({
    x: -rx * Math.sin(t) * Math.cos(rotation) - ry * Math.cos(t) * Math.sin(rotation),
    y: -rx * Math.sin(t) * Math.sin(rotation) + ry * Math.cos(t) * Math.cos(rotation),
  });
  const result: Command[] = [{ op: 'M', points: [point(start)] }];
  for (let i = 0; i < n; i++) {
    const a = start + (sweep * i) / n,
      b = start + (sweep * (i + 1)) / n,
      k = (4 / 3) * Math.tan((b - a) / 4);
    const p = point(a),
      q = point(b),
      d = derivative(a),
      e = derivative(b);
    result.push({
      op: 'C',
      points: [{ x: p.x + k * d.x, y: p.y + k * d.y }, { x: q.x - k * e.x, y: q.y - k * e.y }, q],
    });
  }
  return result;
}
export function bulgeSegment(a: Point, b: Point, bulge: number): Command[] {
  if (![a.x, a.y, b.x, b.y, bulge].every(Number.isFinite))
    throw new Error('Invalid polyline coordinates.');
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  if (Math.abs(bulge) < 1e-12 || length < 1e-12) return [{ op: 'L', points: [b] }];
  const center = {
    x: (a.x + b.x) / 2 - (dy * (1 - bulge * bulge)) / (4 * bulge),
    y: (a.y + b.y) / 2 + (dx * (1 - bulge * bulge)) / (4 * bulge),
  };
  const r = (length * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  return arc(
    center,
    r,
    r,
    0,
    Math.atan2(a.y - center.y, a.x - center.x),
    4 * Math.atan(bulge),
  ).slice(1);
}
function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}
function extrema(a: number, b: number, c: number, d: number): number[] {
  const A = -a + 3 * b - 3 * c + d,
    B = 2 * (a - 2 * b + c),
    C = b - a;
  if (Math.abs(A) < 1e-12) return Math.abs(B) < 1e-12 ? [] : [-C / B].filter((t) => t > 0 && t < 1);
  const disc = B * B - 4 * A * C;
  return disc < 0
    ? []
    : [(-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)].filter(
        (t) => t > 0 && t < 1,
      );
}
export function boundsOf(shapes: Shape[]): Bounds {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw new Error('Drawing contains invalid coordinates.');
    bounds.minX = Math.min(bounds.minX, p.x);
    bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minY = Math.min(bounds.minY, p.y);
    bounds.maxY = Math.max(bounds.maxY, p.y);
  };
  for (const shape of shapes) {
    let current: Point = { x: 0, y: 0 };
    for (const cmd of shape.commands) {
      if (cmd.op === 'C') {
        const [b, c, d] = cmd.points,
          a = current;
        for (const t of [...extrema(a.x, b.x, c.x, d.x), ...extrema(a.y, b.y, c.y, d.y)])
          add({ x: cubicAt(a.x, b.x, c.x, d.x, t), y: cubicAt(a.y, b.y, c.y, d.y, t) });
        add(d);
        current = d;
      } else if (cmd.points.length) {
        current = cmd.points[0];
        add(current);
      }
    }
  }
  if (!Number.isFinite(bounds.minX)) throw new Error('No supported, visible 2D geometry found.');
  return bounds;
}
export function svgPath(shape: Shape): string {
  return shape.commands
    .map((c) => c.op + ' ' + c.points.map((p) => `${p.x},${p.y}`).join(' '))
    .join(' ');
}
