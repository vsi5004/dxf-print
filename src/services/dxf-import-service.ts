import type { Drawing } from '../dxf';
type ImportResponse = { drawing: Drawing; error?: never } | { drawing?: never; error: string };

/** Owns the worker lifecycle so parsing can never leave the UI stuck indefinitely. */
export class DxfImportService {
  private cancelPending: (() => void) | undefined;

  public parse(source: string): Promise<Drawing> {
    this.dispose();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../parse.worker.ts', import.meta.url), { type: 'module' });
      const finish = () => {
        clearTimeout(timeout);
        worker.terminate();
        this.cancelPending = undefined;
      };
      const timeout = setTimeout(() => {
        finish();
        reject(new Error('DXF processing timed out. Simplify the drawing and try again.'));
      }, 15000);
      this.cancelPending = () => {
        finish();
        reject(new Error('Import cancelled.'));
      };
      worker.onmessage = (event: MessageEvent<ImportResponse>) => {
        finish();
        if (event.data.error !== undefined) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.drawing);
        }
      };
      worker.onerror = () => {
        finish();
        reject(new Error('Unable to process this DXF. Try exporting a simpler ASCII DXF.'));
      };
      worker.postMessage(source);
    });
  }

  public dispose(): void {
    this.cancelPending?.();
  }
}
