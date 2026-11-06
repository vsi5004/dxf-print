import { jsPDF } from 'jspdf';
import type { Shape, Point } from './geometry';
import { contentMargin, displayId, type Layout, type Tile } from './layout';

function drawShapes(doc: jsPDF, shapes: Shape[], map: (p: Point) => Point) {
  for (const shape of shapes) {
    for (const cmd of shape.commands) {
      const p = cmd.points.map(map);
      if (cmd.op === 'M') doc.moveTo(p[0].x, p[0].y);
      if (cmd.op === 'L') doc.lineTo(p[0].x, p[0].y);
      if (cmd.op === 'C') doc.curveTo(p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y);
      if (cmd.op === 'Z') doc.close();
    }
    doc.stroke();
  }
}
function cross(doc: jsPDF, x: number, y: number) {
  doc.line(x - 2, y, x + 2, y);
  doc.line(x, y - 2, x, y + 2);
}
function ascii(text: string) {
  return text.replace(/[^\x20-\x7E]/g, '_');
}
function assemblyPage(doc: jsPDF, shapes: Shape[], layout: Layout, name: string) {
  const {
    width: w,
    height: h,
    cols,
    rows,
    tiles,
    usableWidth: uw,
    usableHeight: uh,
    stepX,
    stepY,
  } = layout;
  const inset = layout.settings.margin + 2,
    availableWidth = w - 2 * inset;
  doc.setTextColor(25);
  doc.setFontSize(16);
  doc.text('DXF Print / Assembly map', inset, inset + 6);
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(ascii(name), availableWidth)[0], inset, inset + 12);
  const instructions = [
    'Print template sheets at Actual size / 100%. Disable Fit and Shrink.',
    'Measure the 50 mm scale bar before cutting. The map below is NOT full scale.',
    'Rows run top to bottom; columns run left to right. Keep every sheet upright.',
    'Trim TOP and LEFT shared edges on the dashed line. Keep the other tabs.',
    'Match seam IDs and crosses; overlap and tape each trimmed edge to its mate.',
    `Overlap: ${layout.settings.overlap} mm. Full-scale sheets: ${tiles.length}.`,
  ];
  let cursor = inset + 21;
  for (const instruction of instructions) {
    const lines = doc.splitTextToSize(instruction, availableWidth) as string[];
    for (const line of lines) {
      doc.text(line, inset, cursor);
      cursor += 4;
    }
  }
  const spanX = uw + (cols - 1) * stepX,
    spanY = uh + (rows - 1) * stepY;
  const k = Math.min(availableWidth / spanX, (h - inset - cursor - 18) / spanY),
    ox = (w - spanX * k) / 2,
    oy = cursor + 6;
  doc.setDrawColor(30);
  doc.setLineWidth(0.15);
  const origin = layout.allTiles[0];
  drawShapes(doc, shapes, (p) => ({ x: ox + (p.x - origin.x) * k, y: oy + (origin.y - p.y) * k }));
  for (const tile of layout.allTiles) {
    const x = ox + tile.col * stepX * k,
      y = oy + tile.row * stepY * k;
    doc.setDrawColor(130);
    doc.setLineWidth(0.2);
    doc.rect(x, y, uw * k, uh * k);
    if (layout.settings.labels !== 'none') {
      const label = layout.skipped.includes(tile) ? `${tile.id} (skip)` : displayId(tile, layout);
      doc.setFontSize(9);
      doc.setFillColor('#ffffff');
      doc.rect(x + 1, y + 1, doc.getTextWidth(label) + 4, 6, 'F');
      doc.setTextColor(20);
      doc.text(label, x + 3, y + 5);
    }
  }
  doc.setTextColor(70);
  doc.setFontSize(8);
  doc.text('ASSEMBLY REFERENCE ONLY - template sheets follow', w / 2, h - inset - 2, {
    align: 'center',
  });
}
function tilePage(doc: jsPDF, shapes: Shape[], layout: Layout, tile: Tile, name: string) {
  const { paperWidth: w, paperHeight: h, usableWidth: uw, usableHeight: uh } = tile;
  const s = layout.settings,
    m = contentMargin(s),
    o = s.overlap;
  doc.saveGraphicsState();
  doc.rect(m, m, uw, uh, null);
  doc.clip();
  doc.discardPath();
  doc.setDrawColor('#000000');
  doc.setLineWidth(s.lineWidth);
  drawShapes(doc, shapes, (p) => ({ x: m + p.x - tile.x, y: m + tile.y - p.y }));
  doc.restoreGraphicsState();
  doc.setLineWidth(0.15);
  doc.setDrawColor(130);
  doc.setTextColor(70);
  doc.setFontSize(7);
  const edgeEntries = Object.entries(tile.edges) as [
    keyof Tile['edges'],
    NonNullable<Tile['edges']['left']>,
  ][];
  for (const [side, edge] of edgeEntries) {
    const vertical = side === 'left' || side === 'right',
      trim = side === 'left' || side === 'top';
    const coordinate =
      side === 'left'
        ? m + o / 2
        : side === 'right'
          ? m + uw - o / 2
          : side === 'top'
            ? m + o / 2
            : m + uh - o / 2;
    if (s.cutLines) {
      doc.setLineDashPattern([2, 1], 0);
      if (vertical) doc.line(coordinate, m, coordinate, m + uh);
      else doc.line(m, coordinate, m + uw, coordinate);
      doc.setLineDashPattern([], 0);
    }
    if (s.registration) {
      doc.setDrawColor(60);
      if (vertical) {
        cross(doc, coordinate, m + uh * 0.25);
        cross(doc, coordinate, m + uh * 0.75);
      } else {
        cross(doc, m + uw * 0.25, coordinate);
        cross(doc, m + uw * 0.75, coordinate);
      }
      doc.setDrawColor(130);
    }
    if (s.edgeLabels) {
      const neighbor = layout.tiles.find((t) => t.id === edge.neighbor)!;
      const label = `${edge.seam} / ${trim ? 'TRIM' : 'JOIN'} / to ${displayId(neighbor, layout)}`;
      if (vertical) {
        doc.text(label, side === 'left' ? m - 2 : w - m + 3, h / 2 + doc.getTextWidth(label) / 2, {
          angle: 90,
        });
      } else doc.text(label, w / 2, side === 'top' ? m - 2 : h - m + 4, { align: 'center' });
    }
  }
  if (s.labels !== 'none') {
    doc.setTextColor(0);
    doc.setFontSize(8);
    doc.text(
      `Sheet ${displayId(tile, layout)} / ${tile.number} of ${layout.tiles.length} / TOP`,
      m,
      s.margin + 3,
    );
  }
  doc.setFontSize(6);
  doc.setTextColor(80);
  doc.text(ascii(name).slice(0, 60), w - m, s.margin + 3, { align: 'right' });
  // A calibration bar on every tile stays outside the template geometry.
  const by = h - s.margin - 2;
  doc.setLineWidth(0.2);
  doc.setDrawColor(0);
  doc.line(m, by, m + 50, by);
  doc.line(m, by - 1, m, by + 1);
  doc.line(m + 50, by - 1, m + 50, by + 1);
  doc.setFontSize(6);
  doc.text('50 mm', m + 25, by - 1, { align: 'center' });
  doc.text('1:1 / PRINT AT 100% / NO FIT', w - m, by, { align: 'right' });
}
export function createPdf(shapes: Shape[], layout: Layout, name: string): jsPDF {
  const doc = new jsPDF({
    unit: 'mm',
    format: [layout.width, layout.height],
    orientation: layout.width > layout.height ? 'landscape' : 'portrait',
    compress: true,
    precision: 6,
  });
  doc.setProperties({
    title: `${ascii(name)} - full-scale tiled template`,
    subject: 'Print at Actual size / 100%. Match seam IDs to assemble.',
    creator: 'DXF Print',
  });
  if (layout.settings.overview) assemblyPage(doc, shapes, layout, name);
  layout.tiles.forEach((tile, index) => {
    if (layout.settings.overview || index > 0)
      doc.addPage(
        [tile.paperWidth, tile.paperHeight],
        tile.paperWidth > tile.paperHeight ? 'landscape' : 'portrait',
      );
    tilePage(doc, shapes, layout, tile, name);
  });
  return doc;
}
