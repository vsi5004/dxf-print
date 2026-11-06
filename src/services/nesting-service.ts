import type { Settings } from '../layout';
import type { NestedDrawing, Part } from '../nesting';

export type NestingRequest = {
  parts: Part[];
  settings: Settings;
  gap: number;
  allowRotation: boolean;
};
export type NestingResponse =
  { result: NestedDrawing; error?: never } | { result?: never; error: string };
export interface NestingService {
  nest(request: NestingRequest): Promise<NestedDrawing>;
  cancel(): void;
}

/** Searches away from the UI thread. New settings cancel obsolete work rather than queue it. */
export class WorkerNestingService implements NestingService {
  private cancelPending: (() => void) | undefined;

  public nest(request: NestingRequest): Promise<NestedDrawing> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../nest.worker.ts', import.meta.url), { type: 'module' });
      const finish = () => {
        clearTimeout(timer);
        worker.terminate();
        this.cancelPending = undefined;
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error('Nesting timed out. Try fewer drawings or disable empty-sheet skipping.'));
      }, 30000);
      this.cancelPending = () => {
        finish();
        reject(new Error('Nesting cancelled.'));
      };
      worker.onmessage = (event: MessageEvent<NestingResponse>) => {
        finish();
        if (event.data.error !== undefined) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.onerror = () => {
        finish();
        reject(new Error('Unable to optimize the layout. Try fewer drawings.'));
      };
      worker.postMessage(request);
    });
  }

  public cancel(): void {
    this.cancelPending?.();
  }
}
