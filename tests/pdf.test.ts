import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseDxf } from '../src/dxf';
import { boundsOf } from '../src/geometry';
import { defaults, plan } from '../src/layout';
import { createPdf } from '../src/pdf';
import { square } from './helpers';
async function open(settings = { ...defaults, overview: false }) {
  const shapes = parseDxf(square()).shapes,
    layout = plan(boundsOf(shapes), settings),
    pdf = createPdf(shapes, layout, 'test.dxf');
  const task = getDocument({
    data: new Uint8Array(pdf.output('arraybuffer')),
    useSystemFonts: true,
  });
  return { layout, document: await task.promise, close: () => task.destroy() };
}
test('exported PDF has physical Letter dimensions and vector geometry', async () => {
  const { document, close } = await open();
  try {
    assert.equal(document.numPages, 1);
    const page = await document.getPage(1),
      viewport = page.getViewport({ scale: 1 });
    assert.ok(Math.abs(viewport.width - 612) < 0.001);
    assert.ok(Math.abs(viewport.height - 792) < 0.001);
    const ops = await page.getOperatorList();
    assert.ok(ops.fnArray.includes(OPS.constructPath));
    assert.ok(!ops.fnArray.includes(OPS.paintImageXObject));
    const strokeIndex = ops.fnArray.findIndex(
      (fn, index) => fn === OPS.constructPath && ops.argsArray[index][0] === OPS.stroke,
    );
    const pathBounds = ops.argsArray[strokeIndex][2] as Float32Array;
    assert.ok(
      Math.abs(((pathBounds[2] - pathBounds[0]) * 25.4) / 72 - 100) < 0.001,
      '100 mm drawing must remain 100 mm in PDF space',
    );
    const text = await page.getTextContent(),
      strings = text.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    assert.match(strings, /50 mm/);
    assert.match(strings, /Sheet A1/);
  } finally {
    await close();
  }
});
test('assembly map is an extra page, with full-scale sheets following', async () => {
  const { document, layout, close } = await open({ ...defaults, overview: true });
  try {
    assert.equal(document.numPages, layout.tiles.length + 1);
    const text = await (await document.getPage(1)).getTextContent();
    assert.match(text.items.map((i) => ('str' in i ? i.str : '')).join(' '), /NOT full scale/);
  } finally {
    await close();
  }
});
test('numeric sheet labels and optional guides are honored in the PDF', async () => {
  const { document, close } = await open({
    ...defaults,
    overview: false,
    labels: 'numbers',
    edgeLabels: false,
    registration: false,
    cutLines: false,
  });
  try {
    const text = await (await document.getPage(1)).getTextContent();
    assert.match(text.items.map((i) => ('str' in i ? i.str : '')).join(' '), /Sheet 1/);
  } finally {
    await close();
  }
});
