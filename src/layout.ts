import type { Bounds, Shape } from './geometry';
import { segmentsOf, segmentIntersects } from './occupancy';
export type Settings = {
  paperWidth: number;
  paperHeight: number;
  margin: number;
  overlap: number;
  orientation: 'portrait' | 'landscape';
  labels: 'grid' | 'numbers' | 'none';
  edgeLabels: boolean;
  cutLines: boolean;
  registration: boolean;
  overview: boolean;
  lineWidth: number;
  skipEmpty: boolean;
};
export type Edge = { neighbor: string; seam: string };
export type Tile = {
  row: number;
  col: number;
  id: string;
  number: number;
  x: number;
  y: number;
  paperWidth: number;
  paperHeight: number;
  usableWidth: number;
  usableHeight: number;
  edges: Partial<Record<'left' | 'right' | 'top' | 'bottom', Edge>>;
};
/** Rows and per-sheet dimensions are explicit so renderers do not assume a global paper format. */
export type PageRow = {
  index: number;
  orientation: Settings['orientation'];
  paperWidth: number;
  paperHeight: number;
  y: number;
  tiles: Tile[];
};
export type Layout = {
  width: number;
  height: number;
  usableWidth: number;
  usableHeight: number;
  stepX: number;
  stepY: number;
  cols: number;
  rows: number;
  pageRows: PageRow[];
  tiles: Tile[];
  allTiles: Tile[];
  skipped: Tile[];
  bounds: Bounds;
  settings: Settings;
};
export const defaults: Settings = {
  paperWidth: 215.9,
  paperHeight: 279.4,
  margin: 10,
  overlap: 10,
  orientation: 'portrait',
  labels: 'grid',
  edgeLabels: true,
  cutLines: true,
  registration: true,
  overview: true,
  lineWidth: 0.2,
  skipEmpty: false,
};
export function columnName(index: number): string {
  let n = index + 1,
    s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
export const sheetId = (row: number, col: number) => `${columnName(col)}${row + 1}`;
export const ANNOTATION_GUTTER = 8;
export const contentMargin = (settings: Settings): number => settings.margin + ANNOTATION_GUTTER;
export function plan(bounds: Bounds, settings: Settings, shapes: Shape[] = []): Layout {
  const { margin, overlap } = settings;
  const w = Math.min(settings.paperWidth, settings.paperHeight),
    h = Math.max(settings.paperWidth, settings.paperHeight);
  const width = settings.orientation === 'portrait' ? w : h,
    height = settings.orientation === 'portrait' ? h : w;
  if (
    ![width, height, margin, overlap, settings.lineWidth, ...Object.values(bounds)].every(
      Number.isFinite,
    )
  )
    throw new Error('Enter valid numeric dimensions.');
  if (width < 75 || height < 75 || width > 2000 || height > 2000)
    throw new Error('Paper dimensions must be between 75 and 2,000 mm.');
  if (margin < 0 || margin > 50) throw new Error('Use printer margins between 0 and 50 mm.');
  if (width - 2 * margin < 60 || height - 2 * margin < 60)
    throw new Error(
      'The printable paper area must be at least 60 × 60 mm. Reduce margins or choose larger paper.',
    );
  if (settings.overview && Math.min(width - 2 * margin, height - 2 * margin) < 130)
    throw new Error('Disable the assembly map for printable paper areas smaller than 130 mm.');
  const usableWidth = width - 2 * contentMargin(settings),
    usableHeight = height - 2 * contentMargin(settings);
  if (overlap < 4 || overlap > 50 || overlap >= Math.min(usableWidth, usableHeight) / 2)
    throw new Error('Overlap must be 4–50 mm and less than half the printable area.');
  if (settings.lineWidth < 0.05 || settings.lineWidth > 1)
    throw new Error('Line width must be between 0.05 and 1 mm.');
  const stepX = usableWidth - overlap,
    stepY = usableHeight - overlap;
  const bw = bounds.maxX - bounds.minX,
    bh = bounds.maxY - bounds.minY;
  if (bw < 0 || bh < 0 || Math.max(bw, bh) > 1000000)
    throw new Error('Drawing dimensions are outside the supported range. Check the units.');
  // Padding prevents a stroke exactly on an outer boundary from being clipped.
  const pad = 1;
  const cols = Math.max(1, Math.ceil((bw + 2 * pad - overlap - 1e-8) / stepX)),
    rows = Math.max(1, Math.ceil((bh + 2 * pad - overlap - 1e-8) / stepY));
  if (cols * rows > 400)
    throw new Error(
      `This needs ${cols * rows} sheets. Limit is 400; check units or choose larger paper.`,
    );
  const spanX = usableWidth + (cols - 1) * stepX,
    spanY = usableHeight + (rows - 1) * stepY;
  const startX = bounds.minX - (spanX - bw) / 2,
    startY = bounds.maxY + (spanY - bh) / 2;
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const id = sheetId(row, col),
        edges: Tile['edges'] = {};
      if (col > 0)
        edges.left = { neighbor: sheetId(row, col - 1), seam: `${sheetId(row, col - 1)}:${id}` };
      if (col < cols - 1)
        edges.right = { neighbor: sheetId(row, col + 1), seam: `${id}:${sheetId(row, col + 1)}` };
      if (row > 0)
        edges.top = { neighbor: sheetId(row - 1, col), seam: `${sheetId(row - 1, col)}:${id}` };
      if (row < rows - 1)
        edges.bottom = { neighbor: sheetId(row + 1, col), seam: `${id}:${sheetId(row + 1, col)}` };
      tiles.push({
        row,
        col,
        id,
        number: tiles.length + 1,
        x: startX + col * stepX,
        y: startY - row * stepY,
        paperWidth: width,
        paperHeight: height,
        usableWidth,
        usableHeight,
        edges,
      });
    }
  let printable = tiles;
  if (settings.skipEmpty) {
    if (!shapes.length) throw new Error('Drawing geometry is required to detect empty sheets.');
    const segments = segmentsOf(shapes),
      padding = settings.lineWidth / 2 + 0.02;
    printable = tiles.filter((tile) =>
      segments.some((segment) =>
        segmentIntersects(segment, {
          minX: tile.x - padding,
          maxX: tile.x + tile.usableWidth + padding,
          minY: tile.y - tile.usableHeight - padding,
          maxY: tile.y + padding,
        }),
      ),
    );
  }
  if (!printable.length) throw new Error('No printable geometry found.');
  const retained = new Set(printable.map((tile) => tile.id)),
    skipped = tiles.filter((tile) => !retained.has(tile.id));
  printable.forEach((tile, i) => {
    tile.number = i + 1;
    for (const side of Object.keys(tile.edges) as (keyof Tile['edges'])[]) {
      if (!retained.has(tile.edges[side]!.neighbor)) delete tile.edges[side];
    }
  });
  const pageRows: PageRow[] = Array.from({ length: rows }, (_, index) => ({
    index,
    orientation: settings.orientation,
    paperWidth: width,
    paperHeight: height,
    y: startY - index * stepY,
    tiles: printable.filter((tile) => tile.row === index),
  }));
  return {
    width,
    height,
    usableWidth,
    usableHeight,
    stepX,
    stepY,
    cols,
    rows,
    pageRows,
    tiles: printable,
    allTiles: tiles,
    skipped,
    bounds,
    settings,
  };
}
export function displayId(tile: Tile, layout: Layout): string {
  return layout.settings.labels === 'numbers' ? `${tile.number}` : tile.id;
}
