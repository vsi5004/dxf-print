import { parseDxf } from './dxf';
self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ drawing: parseDxf(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to read the DXF.' });
  }
};
