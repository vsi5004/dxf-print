import { MaxRectsNester } from './maxrects-nester';
import type { NestingRequest, NestingResponse } from './services/nesting-service';

self.onmessage = (event: MessageEvent<NestingRequest>) => {
  try {
    const { parts, settings, gap, allowRotation } = event.data;
    const response: NestingResponse = {
      result: new MaxRectsNester().nest(parts, settings, gap, allowRotation),
    };
    self.postMessage(response);
  } catch (error) {
    const response: NestingResponse = {
      error: error instanceof Error ? error.message : 'Unable to arrange the drawings.',
    };
    self.postMessage(response);
  }
};
