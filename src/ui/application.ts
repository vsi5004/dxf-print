import { el, input, select, escapeHtml } from './dom';
import { PreviewRenderer } from './preview';
import { DxfImportService } from '../services/dxf-import-service';
import { inMillimeters, type Drawing, type Unit } from '../dxf';
import { boundsOf, type Shape } from '../geometry';
import { defaults, plan, type Layout, type Settings } from '../layout';
import { WorkerNestingService, type NestingService } from '../services/nesting-service';
import { demoDxf } from '../demo';

interface ImportedPart {
  id: string;
  name: string;
  drawing: Drawing;
  unit: Unit;
}
interface SourceFile {
  name: string;
  source: string;
}
const paperSizes: Record<string, [number, number]> = {
  letter: [215.9, 279.4],
  a4: [210, 297],
  a3: [297, 420],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
};

/** Coordinates UI state. Geometry, parsing, nesting and PDF code have no DOM dependencies. */
export class Application {
  private readonly preview = new PreviewRenderer();
  private readonly importer = new DxfImportService();
  private readonly nester: NestingService;
  private layoutRevision = 0;
  private computing = false;
  private readonly events = new AbortController();
  private parts: ImportedPart[] = [];
  private shapes: Shape[] = [];
  private layout: Layout | null = null;
  private filename = '';
  private selected = 0;
  private view: 'map' | 'sheet' = 'map';
  private busy = false;
  private enabledLayers = new Set<string>();

  public constructor(nester: NestingService = new WorkerNestingService()) {
    this.nester = nester;
  }
  private get warnings(): string[] {
    return this.parts.flatMap((part) =>
      part.drawing.warnings.map((warning) => `${part.name}: ${warning}`),
    );
  }
  private readSettings(): Settings {
    const paper = paperSizes[select('paper').value] ?? [
      Number(input('paper-width').value),
      Number(input('paper-height').value),
    ];
    return {
      ...defaults,
      paperWidth: paper[0],
      paperHeight: paper[1],
      orientation: select('orientation').value as Settings['orientation'],
      margin: Number(input('margin').value),
      overlap: Number(input('overlap').value),
      labels: select('labels').value as Settings['labels'],
      edgeLabels: input('edge-labels').checked,
      cutLines: input('cut-lines').checked,
      registration: input('registration').checked,
      overview: input('overview').checked,
      lineWidth: Number(select('line-width').value),
      skipEmpty: input('skip-empty').checked,
    };
  }
  private availability(): void {
    el<HTMLButtonElement>('download').disabled =
      this.busy ||
      this.computing ||
      !this.layout ||
      !input('confirm').checked ||
      Boolean(this.warnings.length && !input('warning-confirm').checked);
  }
  private setStatus(message: string): void {
    el('status').textContent = message;
  }
  private setBusy(value: boolean): void {
    this.busy = value;
    el<HTMLButtonElement>('demo').disabled = value;
    input('file').disabled = value;
    el('controls').setAttribute('aria-busy', String(value || this.computing));
    this.availability();
  }
  private async refresh(): Promise<void> {
    const revision = ++this.layoutRevision;
    this.nester.cancel();
    this.computing = false;
    input('confirm').disabled = false;
    el('controls').setAttribute('aria-busy', String(this.busy));
    el('custom-paper').hidden = select('paper').value !== 'custom';
    if (!this.parts.length) {
      this.layout = null;
      this.shapes = [];
      el('empty').hidden = false;
      el('preview').toggleAttribute('hidden', true);
      el('sheet-details').hidden = true;
      el('stat-size').textContent = '—';
      el('stat-sheets').textContent = '—';
      this.setStatus('');
      this.availability();
      return;
    }
    try {
      this.computing = true;
      this.layout = null;
      input('confirm').disabled = true;
      el('controls').setAttribute('aria-busy', 'true');
      this.availability();
      this.setStatus(this.parts.length > 1 ? 'Comparing part layouts…' : 'Preparing print layout…');
      const settings = this.readSettings();
      const parts = this.parts
        .map((part) => ({
          id: part.id,
          name: part.name,
          shapes: inMillimeters(
            part.drawing,
            part.unit,
            new Set(
              part.drawing.layers.filter((layer) => this.enabledLayers.has(`${part.id}:${layer}`)),
            ),
          ),
        }))
        .filter((part) => part.shapes.length);
      if (!parts.length) throw new Error('Choose at least one visible layer.');
      const commandCount = parts.reduce(
        (sum, part) => sum + part.shapes.reduce((n, shape) => n + shape.commands.length, 0),
        0,
      );
      if (commandCount > 250000)
        throw new Error(
          'Combined drawings exceed the vector complexity limit. Import fewer drawings.',
        );
      const nested = await this.nester.nest({
        parts,
        settings,
        gap: Number(input('part-gap').value),
        allowRotation: input('rotate-parts').checked,
      });
      if (revision !== this.layoutRevision) return;
      this.shapes = nested.shapes;
      const bounds = boundsOf(this.shapes);
      this.layout = plan(bounds, settings, this.shapes);
      this.selected = Math.min(this.selected, this.layout.tiles.length - 1);
      const width = bounds.maxX - bounds.minX,
        height = bounds.maxY - bounds.minY;
      el('stat-size').textContent = `${width.toFixed(1)} × ${height.toFixed(1)} mm`;
      el('stat-size').title = `${(width / 25.4).toFixed(3)} × ${(height / 25.4).toFixed(3)} inches`;
      el('stat-sheets').textContent =
        `${this.layout.tiles.length} (${this.layout.cols} × ${this.layout.rows})`;
      const savedSheets = nested.report ? nested.report.baselineSheets - nested.report.sheets : 0;
      const nestingSummary =
        savedSheets > 0
          ? `${savedSheets} fewer ${savedSheets === 1 ? 'sheet' : 'sheets'} than the previous packer.`
          : 'Best layout found; minimum not guaranteed.';
      el('nest-info').textContent =
        parts.length > 1
          ? `${parts.length} drawings · ${nested.placements.filter((p) => p.rotation === 90).length} rotated · ${input('part-gap').value} mm minimum spacing. ${nestingSummary}`
          : '';
      el('export-note').textContent =
        `PDF: ${this.layout.tiles.length + (settings.overview ? 1 : 0)} pages${settings.overview ? ' including assembly map' : ''}. ${this.layout.skipped.length} empty sheets skipped. Print at 100%; check the 50 mm bar.`;
      this.setStatus('');
      this.renderPreview();
    } catch (error) {
      if (revision !== this.layoutRevision) return;
      this.layout = null;
      el('preview').toggleAttribute('hidden', true);
      el('empty').hidden = false;
      el('sheet-details').hidden = true;
      el('stat-size').textContent = '—';
      el('stat-sheets').textContent = '—';
      this.setStatus(error instanceof Error ? error.message : 'Unable to plan sheets.');
    } finally {
      if (revision === this.layoutRevision) {
        this.computing = false;
        input('confirm').disabled = false;
        el('controls').setAttribute('aria-busy', String(this.busy));
        this.availability();
      }
    }
  }
  private renderPreview(): void {
    this.preview.render(this.layout, this.shapes, this.selected, this.view, (index) => {
      this.selected = index;
      this.renderPreview();
    });
  }
  private renderImportControls(): void {
    const multi = this.parts.length > 1,
      first = this.parts[0];
    el('parts-panel').hidden = !multi;
    el('nest-settings').hidden = !multi;
    el('units-field').hidden = multi;
    el('units-note').hidden = multi;
    el('filename').textContent = multi
      ? `${this.parts.length} DXF drawings`
      : (first?.name ?? 'No file selected');
    el('parts-list').innerHTML = this.parts
      .map(
        (part) =>
          `<div class="part-row"><span title="${escapeHtml(part.name)}">${escapeHtml(part.name)}</span><label>Units<select aria-label="Units for ${escapeHtml(part.name)}" data-part-unit="${part.id}">${(['mm', 'cm', 'in', 'ft', 'm'] as Unit[]).map((unit) => `<option value="${unit}" ${part.unit === unit ? 'selected' : ''}>${unit}</option>`).join('')}</select></label><button type="button" data-remove-part="${part.id}" aria-label="Remove ${escapeHtml(part.name)}">×</button></div>`,
      )
      .join('');
    if (first) {
      select('units').value = first.unit;
      el('units-note').textContent = first.drawing.detectedUnit
        ? `Detected from file: ${first.drawing.detectedUnit}. Verify the dimensions.`
        : 'No recognized units in file. Select the correct drawing units.';
    }
    const warnings = this.warnings;
    el('warnings').hidden = !warnings.length;
    el('warning-confirm-row').hidden = !warnings.length;
    el('warnings').innerHTML = warnings.map((w) => `<p>${escapeHtml(w)}</p>`).join('');
    const layers = this.parts.flatMap((part) =>
      part.drawing.layers.map((layer) => ({
        key: `${part.id}:${layer}`,
        label: multi ? `${part.name} / ${layer}` : layer,
      })),
    );
    el('layers-panel').hidden = !layers.length;
    el('layer-count').textContent = `(${layers.length})`;
    el('layers').innerHTML = layers
      .map(
        (layer) =>
          `<label class="check"><input type="checkbox" data-layer="${escapeHtml(layer.key)}" ${this.enabledLayers.has(layer.key) ? 'checked' : ''}><span>${escapeHtml(layer.label)}</span></label>`,
      )
      .join('');
  }
  private async loadSources(sources: SourceFile[]): Promise<void> {
    if (this.busy) return;
    if (sources.length > 20) {
      this.setStatus('Import up to 20 drawings at a time.');
      return;
    }
    this.setBusy(true);
    this.setStatus('Reading DXF drawings…');
    input('confirm').checked = false;
    input('warning-confirm').checked = false;
    try {
      const parsed: ImportedPart[] = [];
      for (const [index, source] of sources.entries()) {
        const drawing = await this.importer.parse(source.source);
        parsed.push({
          id: String(index),
          name: source.name,
          drawing,
          unit: drawing.detectedUnit ?? 'mm',
        });
      }
      // Commit the complete batch only after every file parsed successfully.
      this.parts = parsed;
      this.enabledLayers = new Set(
        parsed.flatMap((part) => part.drawing.layers.map((layer) => `${part.id}:${layer}`)),
      );
      this.filename = parsed.length === 1 ? parsed[0].name : 'nested-drawings.dxf';
      this.selected = 0;
      this.renderImportControls();
      this.refresh();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to read drawings.');
    } finally {
      this.setBusy(false);
    }
  }
  private async openFiles(files: File[]): Promise<void> {
    if (this.busy || files.length === 0) return;
    if (files.some((file) => !file.name.toLowerCase().endsWith('.dxf'))) {
      this.setStatus('Choose only .dxf files.');
      return;
    }
    if (
      files.length > 20 ||
      files.some((file) => file.size > 10 * 1024 * 1024) ||
      files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024
    ) {
      this.setStatus('Use up to 20 DXFs, at most 10 MB each and 20 MB combined.');
      return;
    }
    try {
      await this.loadSources(
        await Promise.all(
          files.map(async (file) => ({ name: file.name, source: await file.text() })),
        ),
      );
    } catch {
      this.setStatus('Unable to read those files.');
    }
  }
  private handleInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (['confirm', 'warning-confirm'].includes(target.id)) {
      this.availability();
      return;
    }
    if (target.id === 'file') return;
    if (target.dataset.partUnit) {
      const part = this.parts.find((part) => part.id === target.dataset.partUnit);
      if (part) part.unit = target.value as Unit;
    } else if (target.dataset.layer) {
      if (target.checked) this.enabledLayers.add(target.dataset.layer);
      else this.enabledLayers.delete(target.dataset.layer);
    } else if (target.id === 'units' && this.parts[0]) this.parts[0].unit = target.value as Unit;
    if (!['confirm', 'warning-confirm'].includes(target.id)) input('confirm').checked = false;
    this.refresh();
  }
  private async download(): Promise<void> {
    if (!this.layout || this.busy || el<HTMLButtonElement>('download').disabled) return;
    const layout = this.layout,
      shapes = this.shapes,
      name = this.filename;
    this.setBusy(true);
    this.setStatus('Building vector PDF…');
    try {
      const { createPdf } = await import('../pdf');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      createPdf(shapes, layout, name).save(name.replace(/\.dxf$/i, '') + '-tiled.pdf');
      this.setStatus('PDF downloaded. Print at Actual size / 100%, then measure the 50 mm bar.');
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to create PDF.');
    } finally {
      this.setBusy(false);
    }
  }
  public mount(): void {
    const signal = this.events.signal;
    input('file').addEventListener(
      'change',
      () => {
        const files = Array.from(input('file').files ?? []);
        void this.openFiles(files);
        input('file').value = '';
      },
      { signal },
    );
    el('demo').addEventListener(
      'click',
      () => void this.loadSources([{ source: demoDxf, name: 'workshop-example.dxf' }]),
      { signal },
    );
    const zone = el('dropzone');
    zone.addEventListener(
      'dragover',
      (event) => {
        event.preventDefault();
        zone.classList.add('dragover');
      },
      { signal },
    );
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'), { signal });
    zone.addEventListener(
      'drop',
      (event) => {
        event.preventDefault();
        zone.classList.remove('dragover');
        void this.openFiles(Array.from(event.dataTransfer?.files ?? []));
      },
      { signal },
    );
    el('controls').addEventListener('input', (event) => this.handleInput(event), { signal });
    el('parts-list').addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-remove-part]',
        );
        if (!button || this.busy) return;
        this.parts = this.parts.filter((part) => part.id !== button.dataset.removePart);
        this.filename = this.parts.length === 1 ? this.parts[0].name : 'nested-drawings.dxf';
        input('confirm').checked = false;
        this.renderImportControls();
        this.refresh();
      },
      { signal },
    );
    select('sheet-select').addEventListener(
      'change',
      () => {
        this.selected = Number(select('sheet-select').value);
        this.renderPreview();
      },
      { signal },
    );
    for (const mode of ['map', 'sheet'] as const)
      el(`view-${mode}`).addEventListener(
        'click',
        () => {
          this.view = mode;
          for (const value of ['map', 'sheet']) {
            el(`view-${value}`).classList.toggle('active', value === mode);
            el(`view-${value}`).setAttribute('aria-pressed', String(value === mode));
          }
          this.renderPreview();
        },
        { signal },
      );
    el('controls').addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        void this.download();
      },
      { signal },
    );
    this.refresh();
  }
  public dispose(): void {
    this.layoutRevision++;
    this.events.abort();
    this.importer.dispose();
    this.nester.cancel();
  }
}
