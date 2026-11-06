import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf, inMillimeters } from '../src/dxf';
import { boundsOf } from '../src/geometry';
import { demoDxf } from '../src/demo';
import { fixture, square } from './helpers';
test('reads millimeter units, layers, circles and closed bulged outlines', () => {
  const d = parseDxf(demoDxf);
  assert.equal(d.detectedUnit, 'mm');
  assert.equal(d.shapes.length, 3);
  assert.equal(d.warnings.length, 0);
  const bounds = boundsOf(d.shapes);
  assert.ok(Math.abs(bounds.maxY - 360) < 1e-6);
  assert.ok(Math.abs(bounds.minY + 360) < 1e-6);
});
test('inch conversion produces a physical 25.4 mm square', () => {
  const d = parseDxf(square(1).replace('$INSUNITS\n70\n4', '$INSUNITS\n70\n1'));
  assert.equal(d.detectedUnit, 'in');
  const b = boundsOf(inMillimeters(d, 'in', new Set(d.layers)));
  assert.equal(b.maxX - b.minX, 25.4);
});
test('unrecognized entities warn instead of silently disappearing', () => {
  const d = parseDxf(
    fixture([
      '0',
      'LINE',
      '8',
      '0',
      '10',
      0,
      '20',
      0,
      '11',
      100,
      '21',
      100,
      '0',
      'TEXT',
      '8',
      '0',
      '10',
      0,
      '20',
      0,
      '40',
      10,
      '1',
      'Example',
    ]),
  );
  assert.ok(d.warnings.some((w) => w.includes('TEXT')));
});
test('unknown units require an explicit choice', () => {
  assert.equal(
    parseDxf(square().replace('$INSUNITS\n70\n4', '$INSUNITS\n70\n0')).detectedUnit,
    null,
  );
});
test('binary, truncated, and empty drawings are rejected', () => {
  assert.throws(() => parseDxf('AutoCAD Binary DXF\0'), /Binary/);
  assert.throws(() => parseDxf(square().replace('EOF', '')), /complete/);
  assert.throws(() => parseDxf(fixture([])), /No supported/);
});
test('layer selection does not mutate the imported geometry', () => {
  const d = parseDxf(demoDxf),
    original = JSON.stringify(d);
  assert.equal(inMillimeters(d, 'mm', new Set(['Holes'])).length, 2);
  assert.equal(JSON.stringify(d), original);
});
test('rotated block inserts respect the block base point', () => {
  const blocks = [
    '0',
    'SECTION',
    '2',
    'BLOCKS',
    '0',
    'BLOCK',
    '2',
    'TEST',
    '70',
    0,
    '10',
    10,
    '20',
    10,
    '30',
    0,
    '0',
    'LINE',
    '8',
    '0',
    '10',
    10,
    '20',
    10,
    '30',
    0,
    '11',
    20,
    '21',
    10,
    '31',
    0,
    '0',
    'ENDBLK',
    '0',
    'ENDSEC',
  ];
  const d = parseDxf(
    fixture(
      ['0', 'INSERT', '8', 'Parts', '2', 'TEST', '10', 100, '20', 100, '30', 0, '50', 90],
      4,
      blocks,
    ),
  );
  const b = boundsOf(d.shapes);
  assert.ok(Math.abs(b.minX - 100) < 1e-6);
  assert.ok(Math.abs(b.maxY - 110) < 1e-6);
  assert.equal(d.shapes[0].layer, 'Parts');
});
