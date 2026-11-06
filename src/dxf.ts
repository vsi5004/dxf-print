import DxfParser, {
  type IEntity,
  type IPoint,
  type IInsertEntity,
  type ILineEntity,
  type ILwpolylineEntity,
  type IPolylineEntity,
  type ICircleEntity,
  type IArcEntity,
  type IEllipseEntity,
} from 'dxf-parser';
import {
  arc,
  bulgeSegment,
  boundsOf,
  identity,
  multiply,
  transform,
  type Command,
  type Matrix,
  type Shape,
} from './geometry';
export type Unit = 'mm' | 'cm' | 'in' | 'ft' | 'm';
export const unitFactors: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4, ft: 304.8, m: 1000 };
export type Drawing = {
  shapes: Shape[];
  detectedUnit: Unit | null;
  warnings: string[];
  layers: string[];
};
// DXF entities have different schemas; confine the parser's dynamic records to this adapter.
type Named<T, Name extends string> = Omit<T, 'type'> & { type: Name };
type SupportedEntity =
  | Named<IInsertEntity, 'INSERT'>
  | Named<ILineEntity, 'LINE'>
  | Named<ILwpolylineEntity, 'LWPOLYLINE'>
  | Named<IPolylineEntity, 'POLYLINE'>
  | Named<ICircleEntity, 'CIRCLE'>
  | Named<IArcEntity, 'ARC'>
  | Named<IEllipseEntity, 'ELLIPSE'>;
type Plane = Partial<{
  extrusionDirectionX: number;
  extrusionDirectionY: number;
  extrusionDirectionZ: number;
  extrusionDirection: IPoint;
}>;
const supported = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'INSERT']);
export function parseDxf(source: string): Drawing {
  if (source.length > 10 * 1024 * 1024) throw new Error('DXF files must be 10 MB or smaller.');
  if (source.startsWith('AutoCAD Binary DXF') || source.includes('\0'))
    throw new Error('Binary DXF is not supported. Save as ASCII DXF in your CAD program.');
  if (!/(?:^|\n)\s*SECTION\s*(?:\r?\n)/.test(source) || !/(?:^|\n)\s*EOF\s*$/.test(source))
    throw new Error('This does not appear to be a complete ASCII DXF file.');
  const parsed = new DxfParser().parseSync(source);
  if (!parsed) throw new Error('Unable to read this DXF file.');
  const doc = parsed;
  const warnings = new Set<string>(),
    shapes: Shape[] = [];
  const raw = source.split(/\r?\n/),
    unsupported = new Set<string>();
  // Detect even entities the upstream parser does not return (e.g. HATCH).
  let section = '',
    sectionPending = false;
  for (let i = 0; i < raw.length - 1; i += 2) {
    const code = raw[i].trim(),
      value = raw[i + 1].trim();
    if (code === '0' && value === 'SECTION') sectionPending = true;
    else if (sectionPending && code === '2') {
      section = value;
      sectionPending = false;
    } else if (code === '0' && value === 'ENDSEC') section = '';
    else if (
      code === '0' &&
      ['ENTITIES', 'BLOCKS'].includes(section) &&
      !supported.has(value) &&
      !['BLOCK', 'ENDBLK', 'VERTEX', 'SEQEND'].includes(value)
    )
      unsupported.add(value);
  }
  for (const type of unsupported)
    warnings.add(`${type} entities are omitted. Export them as outlines/polylines if needed.`);
  let count = 0,
    commandCount = 0;
  function visit(entities: IEntity[], matrix: Matrix, stack: string[] = [], parentLayer = '0') {
    for (const entity of entities) {
      if (!supported.has(entity.type)) continue;
      const e = entity as SupportedEntity;
      if (++count > 50000) throw new Error('Drawing exceeds the 50,000 entity processing limit.');
      const layer = e.layer === '0' ? parentLayer : (e.layer ?? parentLayer),
        layerInfo = doc.tables?.layer?.layers?.[layer];
      if (
        e.visible === false ||
        e.inPaperSpace ||
        e.colorIndex < 0 ||
        layerInfo?.visible === false ||
        layerInfo?.frozen
      )
        continue;
      const plane = e as Plane;
      const nx = plane.extrusionDirectionX ?? plane.extrusionDirection?.x ?? 0,
        ny = plane.extrusionDirectionY ?? plane.extrusionDirection?.y ?? 0,
        nz = plane.extrusionDirectionZ ?? plane.extrusionDirection?.z ?? 1;
      if (
        Math.abs(nx) > 1e-8 ||
        Math.abs(ny) > 1e-8 ||
        Math.abs(nz - 1) > 1e-8 ||
        (e.type === 'POLYLINE' && (e.is3dPolyline || e.is3dPolygonMesh || e.isPolyfaceMesh))
      ) {
        warnings.add('Non-XY / 3D entities are omitted. Export a flat XY drawing.');
        continue;
      }
      if (e.type === 'INSERT') {
        if ((e.columnCount ?? 1) > 1 || (e.rowCount ?? 1) > 1) {
          warnings.add('Array block inserts are omitted. Explode arrays before export.');
          continue;
        }
        const block = doc.blocks?.[e.name];
        if (!block) {
          warnings.add(`Missing block: ${e.name}.`);
          continue;
        }
        if (stack.includes(e.name) || stack.length >= 16)
          throw new Error('Recursive or excessively nested DXF blocks are not supported.');
        const r = ((e.rotation ?? 0) * Math.PI) / 180,
          c = Math.cos(r),
          s = Math.sin(r),
          sx = e.xScale ?? 1,
          sy = e.yScale ?? 1,
          b = block.position ?? { x: 0, y: 0 },
          p = e.position;
        const local: Matrix = [
          c * sx,
          s * sx,
          -s * sy,
          c * sy,
          p.x - c * sx * b.x + s * sy * b.y,
          p.y - s * sx * b.x - c * sy * b.y,
        ];
        visit(block.entities ?? [], multiply(matrix, local), [...stack, e.name], layer);
        continue;
      }
      let commands: Command[];
      if (e.type === 'LINE') {
        if (e.vertices.some((p: IPoint) => Math.abs((p.z ?? 0) - (e.vertices[0].z ?? 0)) > 1e-8)) {
          warnings.add('Sloped 3D lines are omitted.');
          continue;
        }
        commands = e.vertices.map((p: IPoint, i: number) => ({
          op: i === 0 ? 'M' : 'L',
          points: [{ x: p.x, y: p.y }],
        }));
      } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const vertices = e.vertices;
        if (!vertices?.length) continue;
        if (vertices.some((p) => Math.abs((p.z ?? 0) - (vertices[0].z ?? 0)) > 1e-8)) {
          warnings.add('Nonplanar polylines are omitted.');
          continue;
        }
        commands = [{ op: 'M', points: [{ x: vertices[0].x, y: vertices[0].y }] }];
        for (let i = 0; i < vertices.length - (e.shape ? 0 : 1); i++) {
          const a = vertices[i],
            b = vertices[(i + 1) % vertices.length];
          commands.push(...bulgeSegment(a, b, a.bulge ?? 0));
        }
        if (e.shape) commands.push({ op: 'Z', points: [] });
      } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
        if (!(e.radius > 0))
          throw new Error('Drawing contains a circle or arc with an invalid radius.');
        const start = e.type === 'CIRCLE' ? 0 : e.startAngle;
        const sweep =
          e.type === 'CIRCLE'
            ? 2 * Math.PI
            : (((e.endAngle - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (e.type === 'ARC' && sweep === 0) continue;
        commands = arc(e.center, e.radius, e.radius, 0, start, sweep);
        if (e.type === 'CIRCLE') commands.push({ op: 'Z', points: [] });
      } else if (e.type === 'ELLIPSE') {
        const major = e.majorAxisEndPoint,
          rx = Math.hypot(major.x, major.y),
          ry = rx * e.axisRatio;
        if (!(rx > 0 && ry > 0)) throw new Error('Drawing contains an invalid ellipse.');
        const start = e.startAngle ?? 0,
          end = e.endAngle ?? 2 * Math.PI;
        let sweep = end - start;
        while (sweep < 0) sweep += 2 * Math.PI;
        if (sweep > 2 * Math.PI + 1e-8) throw new Error('Invalid ellipse angle.');
        commands = arc(e.center, rx, ry, Math.atan2(major.y, major.x), start, sweep);
      } else continue;
      commandCount += commands.length;
      if (commandCount > 250000)
        throw new Error(
          'Drawing exceeds the vector complexity limit. Simplify it before importing.',
        );
      shapes.push(transform({ commands, layer }, matrix));
    }
  }
  visit(doc.entities ?? [], identity);
  boundsOf(shapes);
  const units: Record<number, Unit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
  const detectedUnit = units[Number(doc.header?.$INSUNITS)] ?? null;
  if (!detectedUnit)
    warnings.add(
      'Units are missing or unsupported. Choose the drawing units and confirm dimensions before exporting.',
    );
  return {
    shapes,
    detectedUnit,
    warnings: [...warnings],
    layers: [...new Set(shapes.map((s) => s.layer))].sort(),
  };
}
export function inMillimeters(drawing: Drawing, unit: Unit, layers: Set<string>): Shape[] {
  const factor = unitFactors[unit];
  return drawing.shapes
    .filter((s) => layers.has(s.layer))
    .map((s) => transform(s, [factor, 0, 0, factor, 0, 0]));
}
