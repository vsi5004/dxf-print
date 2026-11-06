import { MaxRectsBin, PACKING_LOGIC, Rectangle } from 'maxrects-packer';
import { boundsOf, transform, type Bounds, type Shape } from './geometry';
import { plan, type Layout, type Settings } from './layout';
import {
  RectangleNester,
  type NestedDrawing,
  type NestingStrategy,
  type Part,
  type Placement,
} from './nesting';

type SizedPart = Part & { width: number; height: number; normal: Shape[]; turned: Shape[] };
type PositionedPart = { part: SizedPart; x: number; y: number; rotation: 0 | 90 };
type Quality = { sheets: number; area: number; longestSide: number };
type Canvas = { width: number; height: number; pages: number };

function quality(bounds: Bounds, sheets: number): Quality {
  const width = bounds.maxX - bounds.minX,
    height = bounds.maxY - bounds.minY;
  return { sheets, area: width * height, longestSide: Math.max(width, height) };
}

function isBetter(a: Quality, b: Quality): boolean {
  if (a.sheets !== b.sheets) return a.sheets < b.sheets;
  if (Math.abs(a.area - b.area) > 1e-6) return a.area < b.area;
  return a.longestSide < b.longestSide - 1e-6;
}

function normalize(shapes: Shape[]): Shape[] {
  const bounds = boundsOf(shapes);
  return shapes.map((shape) => transform(shape, [1, 0, 0, 1, -bounds.minX, -bounds.minY]));
}

/** Searches page-sized canvases with multiple MaxRects rules and insertion orders.
 * The existing shelf result is always a candidate: sheet count cannot regress.
 * Rectangles include the requested clearance, and only rigid transforms reach the PDF.
 */
export class MaxRectsNester implements NestingStrategy {
  public constructor(private readonly fallback: NestingStrategy = new RectangleNester()) {}

  public nest(
    parts: Part[],
    settings: Settings,
    gap: number,
    allowRotation: boolean,
  ): NestedDrawing {
    // The baseline also validates part count, gap, paper settings and limits.
    const baseline = this.fallback.nest(parts, settings, gap, allowRotation);
    const baselineLayout = plan(boundsOf(baseline.shapes), settings, baseline.shapes);
    let best = baseline;
    let bestQuality = quality(baselineLayout.bounds, baselineLayout.tiles.length);
    let algorithm: 'shelf' | 'maxrects' = 'shelf';
    let candidates = 1;
    if (parts.length > 1) {
      const sized = parts.map((part) => {
        const bounds = boundsOf(part.shapes);
        return {
          ...part,
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
          normal: normalize(part.shapes),
          turned: allowRotation
            ? normalize(part.shapes.map((shape) => transform(shape, [0, 1, -1, 0, 0, 0])))
            : [],
        };
      });
      const orders = this.orders(sized);
      const seen = new Set<string>();
      for (const canvas of this.canvases(sized, baselineLayout, gap, allowRotation)) {
        for (const logic of [
          PACKING_LOGIC.MAX_AREA,
          PACKING_LOGIC.MAX_EDGE,
          PACKING_LOGIC.FILL_WIDTH,
        ]) {
          for (const order of orders) {
            const positioned = this.pack(order, canvas, gap, allowRotation, logic);
            if (!positioned) continue;
            const key = positioned
              .map((p) => `${p.part.id}:${p.x.toFixed(7)},${p.y.toFixed(7)},${p.rotation}`)
              .sort()
              .join(';');
            if (seen.has(key)) continue;
            seen.add(key);
            candidates++;
            const bounds = this.positionedBounds(positioned);
            // Avoid transforming complex vectors for candidates that cannot improve the result.
            if (!settings.skipEmpty) {
              const preliminary = plan(bounds, settings);
              if (!isBetter(quality(bounds, preliminary.tiles.length), bestQuality)) continue;
            }
            const drawing = this.materialize(positioned);
            const layout = plan(boundsOf(drawing.shapes), settings, drawing.shapes);
            const score = quality(layout.bounds, layout.tiles.length);
            if (isBetter(score, bestQuality)) {
              best = drawing;
              bestQuality = score;
              algorithm = 'maxrects';
            }
          }
        }
      }
    }
    return {
      ...best,
      report: {
        algorithm,
        baselineSheets: baselineLayout.tiles.length,
        sheets: bestQuality.sheets,
        candidates,
      },
    };
  }

  private orders(parts: SizedPart[]): SizedPart[][] {
    const comparisons = [
      (a: SizedPart, b: SizedPart) => b.width * b.height - a.width * a.height,
      (a: SizedPart, b: SizedPart) => Math.max(b.width, b.height) - Math.max(a.width, a.height),
      (a: SizedPart, b: SizedPart) => b.width - a.width,
      (a: SizedPart, b: SizedPart) => b.height - a.height,
    ];
    // Stable, deterministic tie breaking also makes regression benchmarks reproducible.
    return comparisons.map((compare) =>
      [...parts].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id)),
    );
  }

  private canvases(parts: SizedPart[], baseline: Layout, gap: number, rotation: boolean): Canvas[] {
    const canvases: Canvas[] = [];
    const inflatedArea = parts.reduce((sum, p) => sum + (p.width + gap) * (p.height + gap), 0);
    // Search every grid no larger than the baseline grid, rather than assuming a square bin.
    // The limit of 400 positions is inherited from the page planner.
    for (let cols = 1; cols <= baseline.allTiles.length; cols++) {
      for (let rows = 1; cols * rows <= baseline.allTiles.length; rows++) {
        // Leave the same 1 mm stroke padding used by the page planner on each outer edge.
        const width = baseline.usableWidth + (cols - 1) * baseline.stepX - 2;
        const height = baseline.usableHeight + (rows - 1) * baseline.stepY - 2;
        if ((width + gap) * (height + gap) + 1e-7 < inflatedArea) continue;
        if (
          parts.some(
            (p) =>
              !(
                (p.width <= width + 1e-7 && p.height <= height + 1e-7) ||
                (rotation && p.height <= width + 1e-7 && p.width <= height + 1e-7)
              ),
          )
        )
          continue;
        canvases.push({ width, height, pages: cols * rows });
      }
    }
    return canvases.sort(
      (a, b) => a.pages - b.pages || a.width * a.height - b.width * b.height || a.width - b.width,
    );
  }

  private pack(
    parts: SizedPart[],
    canvas: Canvas,
    gap: number,
    rotation: boolean,
    logic: PACKING_LOGIC,
  ): PositionedPart[] | null {
    // Explicit inflated rectangles make clearance independent of library padding semantics.
    // The final external gap is not needed, so the bin is enlarged by one gap as well.
    const bin = new MaxRectsBin(canvas.width + gap, canvas.height + gap, 0, {
      smart: false,
      pot: false,
      square: false,
      border: 0,
      allowRotation: rotation,
      logic,
    });
    const result: PositionedPart[] = [];
    for (const part of parts) {
      const rectangle = new Rectangle(part.width + gap, part.height + gap);
      if (!bin.add(rectangle)) return null;
      result.push({ part, x: rectangle.x, y: rectangle.y, rotation: rectangle.rot ? 90 : 0 });
    }
    return result;
  }

  private positionedBounds(parts: PositionedPart[]): Bounds {
    return {
      minX: Math.min(...parts.map((p) => p.x)),
      minY: Math.min(...parts.map((p) => p.y)),
      maxX: Math.max(...parts.map((p) => p.x + (p.rotation === 0 ? p.part.width : p.part.height))),
      maxY: Math.max(...parts.map((p) => p.y + (p.rotation === 0 ? p.part.height : p.part.width))),
    };
  }

  private materialize(parts: PositionedPart[]): NestedDrawing {
    const shapes: Shape[] = [],
      placements: Placement[] = [];
    for (const p of parts) {
      const source = p.rotation === 0 ? p.part.normal : p.part.turned;
      const placed = source.map((shape) => transform(shape, [1, 0, 0, 1, p.x, p.y]));
      shapes.push(...placed);
      placements.push({
        partId: p.part.id,
        name: p.part.name,
        rotation: p.rotation,
        bounds: boundsOf(placed),
      });
    }
    return { shapes, placements };
  }
}
