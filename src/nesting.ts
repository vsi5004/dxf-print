import { boundsOf, transform, type Bounds, type Shape, type Matrix } from './geometry';
import { plan, type Settings } from './layout';
export type Part = { id: string; name: string; shapes: Shape[] };
export type Placement = { partId: string; name: string; bounds: Bounds; rotation: 0 | 90 };
export type NestedDrawing = { shapes: Shape[]; placements: Placement[] };
export interface NestingStrategy {
  nest(parts: Part[], settings: Settings, gap: number, allowRotation: boolean): NestedDrawing;
}
type SizedPart = Part & { bounds: Bounds; width: number; height: number };
type Shelf = { x: number; y: number; height: number };

/** Deterministic, conservative packing. Each DXF is one rigid part, bounded by a rectangle.
 * A future contour-based nester can implement NestingStrategy without changing the UI or PDF code.
 */
export class RectangleNester implements NestingStrategy {
  public nest(
    parts: Part[],
    settings: Settings,
    gap: number,
    allowRotation: boolean,
  ): NestedDrawing {
    if (!Number.isFinite(gap) || gap < 1 || gap > 100)
      throw new Error('Part spacing must be between 1 and 100 mm.');
    if (parts.length === 0) throw new Error('Select at least one visible part.');
    if (parts.length > 20) throw new Error('Nest up to 20 DXF drawings at a time.');
    if (parts.length === 1)
      return {
        shapes: parts[0].shapes,
        placements: [
          {
            partId: parts[0].id,
            name: parts[0].name,
            bounds: boundsOf(parts[0].shapes),
            rotation: 0,
          },
        ],
      };
    const sized: SizedPart[] = parts.map((part) => {
      const bounds = boundsOf(part.shapes);
      return {
        ...part,
        bounds,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
      };
    });
    // Validate paper settings and derive useful candidate canvas widths from sheet pitch.
    const base = plan({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { ...settings, skipEmpty: false });
    const minWidth = Math.max(
      ...sized.map((p) => (allowRotation ? Math.min(p.width, p.height) : p.width)),
    );
    const maxWidth = sized.reduce((sum, p) => sum + Math.max(p.width, p.height) + gap, 0);
    const widths = new Set<number>([minWidth, maxWidth]);
    for (let n = 1; n <= Math.min(20, parts.length * 2); n++)
      widths.add(Math.max(minWidth, base.usableWidth + (n - 1) * base.stepX - 2));
    for (const p of sized) {
      widths.add(Math.max(minWidth, p.width));
      if (allowRotation) widths.add(Math.max(minWidth, p.height));
    }
    let best: NestedDrawing | undefined,
      bestScore = Infinity;
    for (const width of widths)
      for (const sort of ['height', 'area'] as const) {
        const order = [...sized].sort((a, b) =>
          sort === 'height'
            ? Math.max(b.height, b.width) - Math.max(a.height, a.width)
            : b.width * b.height - a.width * a.height,
        );
        const candidate = this.pack(order, width, gap, allowRotation);
        if (!candidate) continue;
        const bounds = boundsOf(candidate.shapes);
        try {
          const layout = plan(bounds, settings, candidate.shapes);
          const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
          const score = layout.tiles.length * 1e12 + area;
          if (score < bestScore) {
            best = candidate;
            bestScore = score;
          }
        } catch {
          /* A candidate above the page limit may have a better alternative. */
        }
      }
    if (!best) throw new Error('No arrangement fits the 400-sheet limit. Check drawing units.');
    return best;
  }
  private pack(
    parts: SizedPart[],
    canvasWidth: number,
    gap: number,
    allowRotation: boolean,
  ): NestedDrawing | null {
    const shelves: Shelf[] = [],
      shapes: Shape[] = [],
      placements: Placement[] = [];
    for (const part of parts) {
      const options = (allowRotation ? [0, 90] : [0]) as (0 | 90)[];
      let choice:
        | { shelf: Shelf; rotation: 0 | 90; width: number; height: number; score: number }
        | undefined;
      for (const rotation of options) {
        const width = rotation === 0 ? part.width : part.height,
          height = rotation === 0 ? part.height : part.width;
        if (width > canvasWidth + 1e-7) continue;
        for (const shelf of shelves)
          if (shelf.x + width <= canvasWidth + 1e-7 && height <= shelf.height + 1e-7) {
            const score = shelf.height - height + (canvasWidth - shelf.x - width) * 0.001;
            if (!choice || score < choice.score) choice = { shelf, rotation, width, height, score };
          }
      }
      if (!choice) {
        const candidates = options
          .map((rotation) => ({
            rotation,
            width: rotation === 0 ? part.width : part.height,
            height: rotation === 0 ? part.height : part.width,
          }))
          .filter((o) => o.width <= canvasWidth + 1e-7)
          .sort((a, b) => a.height - b.height);
        const orientation = candidates[0];
        if (!orientation) return null;
        const shelf: Shelf = {
          x: 0,
          y: shelves.length ? shelves.at(-1)!.y + shelves.at(-1)!.height + gap : 0,
          height: orientation.height,
        };
        shelves.push(shelf);
        choice = { ...orientation, shelf, score: 0 };
      }
      const rotation: Matrix = choice.rotation === 0 ? [1, 0, 0, 1, 0, 0] : [0, 1, -1, 0, 0, 0];
      const rotated = part.shapes.map((s) => transform(s, rotation)),
        bounds = boundsOf(rotated),
        x = choice.shelf.x,
        y = choice.shelf.y;
      const placed = rotated.map((s) =>
        transform(s, [1, 0, 0, 1, x - bounds.minX, y - bounds.minY]),
      );
      shapes.push(...placed);
      placements.push({
        partId: part.id,
        name: part.name,
        bounds: boundsOf(placed),
        rotation: choice.rotation,
      });
      choice.shelf.x += choice.width + gap;
    }
    return { shapes, placements };
  }
}
