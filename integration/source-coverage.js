const {point, roleFor} = require('./cad-inventory');

// Blueprint3D uses centimetres. Match the converter's 5 mm graph precision.
const EPS = 0.6;
const MAX_FACE_SPACING = 40;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y});
const cross = (a, b) => a.x * b.y - a.y * b.x;
function line(a, b, extra = {}) {
  const length = distance(a, b);
  return {a, b, length, u: {x: (b.x - a.x) / length, y: (b.y - a.y) / length}, ...extra};
}
function projection(p, segment) { return dot(sub(p, segment.a), segment.u); }
function offset(p, segment) { return cross(segment.u, sub(p, segment.a)); }
function range(segment, reference) {
  const a = projection(segment.a, reference), b = projection(segment.b, reference);
  return [Math.min(a, b), Math.max(a, b)];
}
function pointDistance(p, segment) {
  const t = Math.max(0, Math.min(segment.length, projection(p, segment)));
  return distance(p, {x: segment.a.x + t * segment.u.x, y: segment.a.y + t * segment.u.y});
}

function sourceSegments(data, roles, transform) {
  const segments = [], uncheckedCurves = [];
  let tinySegments = 0;
  const toNative = p => ({
    x: (p.x - transform.origin.x) * transform.scaleToCm,
    y: (p.y - transform.origin.y) * transform.scaleToCm * (transform.invertY === false ? 1 : -1),
  });
  for (const record of data.instances) {
    const role = roleFor(record.id, roles);
    if (!['wall_axis', 'wall_face'].includes(role)) continue;
    const entity = record.entity;
    if (['ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE'].includes(record.type)) {
      uncheckedCurves.push({entityId: record.id, type: record.type});
      continue;
    }
    if (!['LINE', 'LWPOLYLINE', 'POLYLINE'].includes(record.type)) continue;
    const original = entity.vertices || [];
    const vertices = record.worldVertices || original.map(p => point(record.matrix || [1, 0, 0, 1, 0, 0], p));
    const count = record.type === 'LINE' ? Math.min(1, vertices.length - 1) : vertices.length - (entity.shape ? 0 : 1);
    for (let index = 0; index < count; index++) {
      if (original[index]?.bulge) {
        uncheckedCurves.push({entityId: record.id, type: record.type, segmentIndex: index});
        continue;
      }
      const segment = line(toNative(vertices[index]), toNative(vertices[(index + 1) % vertices.length]), {entityId: record.id, segmentIndex: index, role});
      if (segment.length <= EPS) tinySegments++;
      else segments.push(segment);
    }
  }
  return {segments, uncheckedCurves, tinySegments};
}

function uncoveredIntervals(length, intervals, endpointAllowance) {
  const merged = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    const lo = Math.max(0, start), hi = Math.min(length, end);
    if (hi <= lo) continue;
    const previous = merged.at(-1);
    if (previous && lo <= previous[1] + EPS) previous[1] = Math.max(previous[1], hi);
    else merged.push([lo, hi]);
  }
  if (!merged.length) return [[0, length]];
  // Endpoints may move to the intersection of the two wall centre lines.
  if (merged[0][0] <= endpointAllowance) merged[0][0] = 0;
  if (length - merged.at(-1)[1] <= endpointAllowance) merged.at(-1)[1] = length;
  const missing = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start - cursor > EPS) missing.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (length - cursor > EPS) missing.push([cursor, length]);
  return missing;
}

/** Verify retained straight CAD structure independently of room triangulation. */
function checkSourceCoverage(result, data, roles) {
  const transform = result.report?.transform;
  if (!transform || !Number.isFinite(transform.scaleToCm) || transform.scaleToCm <= 0 ||
      ![transform.origin?.x, transform.origin?.y].every(Number.isFinite)) {
    return {valid: false, issues: ['Transformação CAD ausente ou inválida para conferir a cobertura estrutural.'], uncovered: []};
  }
  const {segments, uncheckedCurves, tinySegments} = sourceSegments(data, roles, transform);
  const floor = result.design.floorplan;
  const native = floor.walls.map(w => line(floor.corners[w.corner1], floor.corners[w.corner2]))
    .filter(w => Number.isFinite(w.length) && w.length > EPS);
  const thickness = Math.max(0, Number(result.report.thickness) || 0);
  const faceSpacing = Math.max(MAX_FACE_SPACING, thickness * 1.25);
  const coverage = segments.map(source => {
    if (![source.a.x, source.a.y, source.b.x, source.b.y].every(Number.isFinite)) return {source, missing: [[0, source.length]]};
    const intervals = [];
    const face = source.role === 'wall_face';
    // A face can correspond to itself (an unpaired source vector), or to the
    // midpoint of a real parallel CAD face. Proximity to an arbitrary wall alone
    // is insufficient evidence that a structural vector survived conversion.
    const candidates = [{offset: 0, range: [0, source.length]}];
    let localHalfWidth = thickness / 2;
    if (face) for (const other of segments) {
      if (other === source || other.role !== 'wall_face' || Math.abs(cross(source.u, other.u)) > 0.005) continue;
      const separation = offset(other.a, source);
      if (Math.abs(separation) < 1 || Math.abs(separation) > faceSpacing + EPS) continue;
      const overlap = range(other, source);
      if (overlap[1] < 0 || overlap[0] > source.length) continue;
      const halfWidth = Math.abs(separation) / 2;
      candidates.push({offset: separation / 2, range: [overlap[0] - halfWidth - EPS, overlap[1] + halfWidth + EPS]});
      localHalfWidth = Math.max(localHalfWidth, Math.abs(separation) / 2);
    }
    for (const wall of native) {
      if (Math.abs(cross(source.u, wall.u)) > 0.02) continue;
      const projected = range(wall, source);
      for (const candidate of candidates) {
        const start = Math.max(0, projected[0], candidate.range[0]);
        const end = Math.min(source.length, projected[1], candidate.range[1]);
        if (end <= start) continue;
        // Assess both ends of the overlap, so a crossing segment cannot stand
        // in for a missing parallel wall merely because their midpoints align.
        const wallOffsetAt = t => {
          const fraction = (t - projection(wall.a, source)) / dot(sub(wall.b, wall.a), source.u);
          return offset({x: wall.a.x + fraction * (wall.b.x - wall.a.x), y: wall.a.y + fraction * (wall.b.y - wall.a.y)}, source);
        };
        if ([start, end].every(t => Math.abs(wallOffsetAt(t) - candidate.offset) <= EPS)) intervals.push([start, end]);
      }
    }
    const allowance = face ? localHalfWidth + EPS : EPS;
    return {source, missing: uncoveredIntervals(source.length, intervals, allowance)};
  });
  let collapsedReturns = 0;
  const coveredFaces = coverage.filter(c => c.source.role === 'wall_face' && !c.missing.length).map(c => c.source);
  for (const record of coverage) {
    const source = record.source;
    if (!record.missing.length || source.role !== 'wall_face' || source.length > faceSpacing + EPS) continue;
    // A face closing the thickness at a jamb/corner is not a separate native
    // wall. Both ends must terminate on covered, perpendicular source faces.
    const atA = coveredFaces.filter(other => Math.abs(dot(source.u, other.u)) < 0.02 && pointDistance(source.a, other) <= EPS);
    const atB = coveredFaces.filter(other => Math.abs(dot(source.u, other.u)) < 0.02 && pointDistance(source.b, other) <= EPS);
    const insideWallFootprint = source.length <= thickness + EPS && [0,.25,.5,.75,1].every(t => {
      const p = {x:source.a.x+(source.b.x-source.a.x)*t,y:source.a.y+(source.b.y-source.a.y)*t};
      return native.some(w=>pointDistance(p,w)<=thickness/2+EPS);
    });
    if (atA.some(a => atB.some(b => a !== b)) || insideWallFootprint) {
      record.missing = [];
      collapsedReturns++;
    }
  }
  const uncovered = coverage.filter(c => c.missing.length).map(({source, missing}) => ({
    entityId: source.entityId,
    segmentIndex: source.segmentIndex,
    role: source.role,
    lengthCm: source.length,
    uncoveredCm: missing.reduce((sum, [a, b]) => sum + b - a, 0),
    intervalsCm: missing,
  }));
  return {
    valid: !uncovered.length,
    issues: uncovered.map(s => `Segmento estrutural ${s.entityId}:${s.segmentIndex} (${s.role}) sem cobertura nativa em ${s.uncoveredCm.toFixed(2)} cm.`),
    checkedSegments: segments.length,
    coveredSegments: segments.length - uncovered.length,
    collapsedReturns,
    tinySegments,
    uncovered,
    uncheckedCurves,
    limitations: uncheckedCurves.length ? ['Esta conferência de cobertura compara apenas segmentos retos; arcos, círculos e trechos com bulge exigem a validação específica de curvas.'] : [],
  };
}

module.exports = {checkSourceCoverage};
