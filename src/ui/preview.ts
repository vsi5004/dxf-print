import { el, select } from './dom';
import { svgPath, type Shape } from '../geometry';
import { contentMargin, displayId, type Layout } from '../layout';
/** SVG view of the same millimeter layout used by the PDF exporter. */
export class PreviewRenderer {
  public render(
    layout: Layout | null,
    shapes: Shape[],
    selected: number,
    view: 'map' | 'sheet',
    onSelect: (index: number) => void,
  ) {
    if (!layout) return;
    const l = layout,
      tile = l.tiles[selected],
      m = contentMargin(l.settings);
    el('empty').hidden = true;
    el('preview').toggleAttribute('hidden', false);
    el('sheet-details').hidden = false;
    const svg = el<SVGElement & HTMLElement>('preview');
    let content = '';
    if (view === 'map') {
      const first = l.allTiles[0],
        sx = l.usableWidth + (l.cols - 1) * l.stepX,
        sy = l.usableHeight + (l.rows - 1) * l.stepY;
      const pad = Math.max(sx, sy) * 0.035;
      svg.setAttribute(
        'viewBox',
        `${first.x - pad} ${-first.y - pad} ${sx + 2 * pad} ${sy + 2 * pad}`,
      );
      const font = Math.min(l.usableWidth, l.usableHeight) * 0.075;
      content += `<g transform="scale(1,-1)" fill="none" stroke="#d7e3f2">${shapes.map((s) => `<path d="${svgPath(s)}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`).join('')}</g>`;
      content += l.allTiles
        .map((t) => {
          const i = l.tiles.indexOf(t),
            skip = i < 0;
          return `<g><rect class="${skip ? 'skipped-tile' : 'tile-target'}" ${skip ? '' : `tabindex="0" role="button" aria-label="Select sheet ${displayId(t, l)}" data-tile="${i}"`} x="${t.x}" y="${-t.y}" width="${t.usableWidth}" height="${t.usableHeight}" fill="${i === selected ? '#79b8ff' : '#162332'}" fill-opacity="${i === selected ? '.12' : '.025'}" stroke="${i === selected ? '#9dceff' : '#52657e'}" stroke-width="${i === selected ? 1.2 : 0.5}"/>${l.settings.labels === 'none' ? '' : `<rect x="${t.x + 3}" y="${-t.y + 3}" width="${font * 2.8}" height="${font * 1.6}" rx="2" fill="#172334"/><text x="${t.x + 6}" y="${-t.y + font * 1.35}" fill="#b7d9ff" font-size="${font}" font-family="system-ui" pointer-events="none">${skip ? `${t.id} (skip)` : displayId(t, l)}</text>`}</g>`;
        })
        .join('');
    } else {
      svg.setAttribute('viewBox', `-6 -6 ${tile.paperWidth + 12} ${tile.paperHeight + 12}`);
      content += `<defs><clipPath id="printable"><rect x="${m}" y="${m}" width="${tile.usableWidth}" height="${tile.usableHeight}"/></clipPath></defs><rect width="${tile.paperWidth}" height="${tile.paperHeight}" fill="#fafbfc" rx="1"/><rect x="${m}" y="${m}" width="${tile.usableWidth}" height="${tile.usableHeight}" fill="none" stroke="#c2ccd8" stroke-width=".2"/><g clip-path="url(#printable)"><g transform="translate(${m - tile.x},${m + tile.y}) scale(1,-1)" fill="none" stroke="#121820" stroke-width="${l.settings.lineWidth}">${shapes.map((s) => `<path d="${svgPath(s)}"/>`).join('')}</g></g>`;
      if (l.settings.labels !== 'none')
        content += `<text x="${m}" y="${l.settings.margin + 3}" font-size="3" fill="#222">Sheet ${displayId(tile, l)} / ${tile.number} of ${l.tiles.length} / TOP</text>`;
      for (const [side, edge] of Object.entries(tile.edges)) {
        const v = side === 'left' || side === 'right',
          o = l.settings.overlap,
          trim = side === 'left' || side === 'top';
        const p =
          side === 'left'
            ? m + o / 2
            : side === 'right'
              ? m + tile.usableWidth - o / 2
              : side === 'top'
                ? m + o / 2
                : m + tile.usableHeight - o / 2;
        if (l.settings.cutLines)
          content += v
            ? `<line x1="${p}" y1="${m}" x2="${p}" y2="${m + tile.usableHeight}" stroke="#6b7280" stroke-width=".2" stroke-dasharray="2 1"/>`
            : `<line x1="${m}" y1="${p}" x2="${m + tile.usableWidth}" y2="${p}" stroke="#6b7280" stroke-width=".2" stroke-dasharray="2 1"/>`;
        if (l.settings.registration)
          for (const f of [0.25, 0.75]) {
            const x = v ? p : m + tile.usableWidth * f,
              y = v ? m + tile.usableHeight * f : p;
            content += `<path d="M ${x - 2},${y} L ${x + 2},${y} M ${x},${y - 2} L ${x},${y + 2}" stroke="#475569" stroke-width=".25"/>`;
          }
        if (l.settings.edgeLabels) {
          const n = l.tiles.find((t) => t.id === edge.neighbor)!;
          const label = `${edge.seam} / ${trim ? 'TRIM' : 'JOIN'} / to ${displayId(n, l)}`;
          content += v
            ? `<text transform="translate(${side === 'left' ? m - 2 : tile.paperWidth - m + 3},${tile.paperHeight / 2}) rotate(-90)" text-anchor="middle" font-size="2.4" fill="#555">${label}</text>`
            : `<text x="${tile.paperWidth / 2}" y="${side === 'top' ? m - 2 : tile.paperHeight - m + 4}" text-anchor="middle" font-size="2.4" fill="#555">${label}</text>`;
        }
      }
      content += `<path d="M ${m},${tile.paperHeight - l.settings.margin - 2} h 50 m -50,-1 v 2 m 50,-2 v 2" stroke="#222" stroke-width=".2"/><text x="${m + 25}" y="${tile.paperHeight - l.settings.margin - 3}" text-anchor="middle" font-size="2.2" fill="#444">50 mm</text><text x="${tile.paperWidth - m}" y="${tile.paperHeight - l.settings.margin - 2}" text-anchor="end" font-size="2" fill="#444">1:1 / PRINT AT 100% / NO FIT</text>`;
    }
    svg.innerHTML = content;
    svg.querySelectorAll<SVGElement>('[data-tile]').forEach((target) => {
      const choose = () => {
        onSelect(Number(target.dataset.tile));
      };
      target.addEventListener('click', choose);
      target.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
    });
    el('selected-sheet').textContent =
      `${displayId(tile, l)} · row ${tile.row + 1}, column ${tile.col + 1}`;
    select('sheet-select').innerHTML = l.tiles
      .map(
        (t, i) =>
          `<option value="${i}" ${i === selected ? 'selected' : ''}>Sheet ${displayId(t, l)}</option>`,
      )
      .join('');
    el('neighbors').innerHTML = ['top', 'right', 'bottom', 'left']
      .map((side) => {
        const edge = tile.edges[side as keyof typeof tile.edges],
          neighbor = edge ? l.tiles.find((t) => t.id === edge.neighbor) : null;
        return `<div class="neighbor">${side.toUpperCase()}<br>${edge && neighbor ? `<strong>Sheet ${displayId(neighbor, l)}</strong> · <code>${edge.seam}</code>` : 'Outside edge · no join'}</div>`;
      })
      .join('');
  }
}
