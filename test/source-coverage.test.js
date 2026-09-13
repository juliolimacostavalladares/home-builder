const {test} = require('node:test');
const assert = require('node:assert/strict');
const {checkSourceCoverage} = require('../integration/source-coverage');

const point = ([x, y]) => ({x, y});
function fixture(sourceLines, nativeLines, role = 'wall_face') {
  const instances = sourceLines.map(([a, b], i) => ({id: `e${i}`, type: 'LINE', matrix: [1, 0, 0, 1, 0, 0], entity: {vertices: [point(a), point(b)]}}));
  const corners = {}, walls = nativeLines.map(([a, b], i) => {
    const corner1 = `a${i}`, corner2 = `b${i}`;
    corners[corner1] = point(a); corners[corner2] = point(b);
    return {corner1, corner2};
  });
  return {
    result: {design: {floorplan: {corners, walls}}, report: {thickness: 15, transform: {origin: {x: 0, y: 0}, scaleToCm: 1, invertY: false}}},
    data: {instances}, roles: new Map(instances.map(e => [e.id, role])),
  };
}
const check = ({result, data, roles}) => checkSourceCoverage(result, data, roles);
const perimeter = [[[0, 0], [400, 0]], [[400, 0], [400, 300]], [[400, 300], [0, 300]], [[0, 300], [0, 0]]];

test('An omitted internal wall fails even when the external floor contour is intact', () => {
  const input = fixture([...perimeter, [[200, 0], [200, 300]]], perimeter, 'wall_axis');
  const validation = check(input);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.uncovered.map(s => s.entityId), ['e4']);
  assert.equal(validation.uncovered[0].uncoveredCm, 300);
});

test('Missing interior spans cannot be hidden by endpoint tolerance or perpendicular walls', () => {
  const input = fixture([[[0, 0], [0, 300]]], [[[0, 0], [0, 120]], [[0, 180], [0, 300]], [[-100, 150], [100, 150]]], 'wall_axis');
  const validation = check(input);
  assert.equal(validation.valid, false);
  assert.equal(validation.uncovered[0].uncoveredCm, 60);
});

test('Paired rectangular faces are retained by their joined native centre lines', () => {
  const inner = [[[15, 15], [385, 15]], [[385, 15], [385, 285]], [[385, 285], [15, 285]], [[15, 285], [15, 15]]];
  const axes = [[[7.5, 7.5], [392.5, 7.5]], [[392.5, 7.5], [392.5, 292.5]], [[392.5, 292.5], [7.5, 292.5]], [[7.5, 292.5], [7.5, 7.5]]];
  const validation = check(fixture([...perimeter, ...inner], axes));
  assert.equal(validation.valid, true, JSON.stringify(validation.uncovered));
  assert.equal(validation.coveredSegments, 8);
});

test('Small wall returns and jamb caps collapse only between covered wall faces', () => {
  const source = [[[0, 0], [0, 120]], [[15, 0], [15, 120]], [[0, 0], [15, 0]], [[0, 120], [15, 120]]];
  const validation = check(fixture(source, [[[7.5, 0], [7.5, 120]]]));
  assert.equal(validation.valid, true, JSON.stringify(validation.uncovered));
  assert.equal(validation.collapsedReturns, 2);
  const missing = check(fixture([[[200, 200], [210, 200]], ...source], [[[7.5, 0], [7.5, 120]]]));
  assert.equal(missing.valid, false);
  assert.equal(missing.uncovered[0].entityId, 'e0');
});

test('Inherited roles and transformed nested polyline vertices use the native coordinate frame', () => {
  const input = fixture([], [[[0, 0], [0, -200]], [[0, -200], [-100, -200]]], 'wall_axis');
  input.result.report.transform = {origin: {x: 10, y: 20}, scaleToCm: 100, invertY: true};
  input.roles = new Map([['e0', 'wall_axis']]);
  input.data.instances = [{id: 'e0/b0', type: 'LWPOLYLINE', matrix: [0, 2, -2, 0, 10, 20], entity: {vertices: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 0.5}]}}];
  assert.equal(check(input).valid, true);
});

test('Curved source coverage is reported as unverified instead of claimed as checked', () => {
  const input = fixture(perimeter, perimeter, 'wall_axis');
  input.data.instances.push({id: 'e4', type: 'ARC', entity: {}});
  input.roles.set('e4', 'wall_axis');
  const validation = check(input);
  assert.equal(validation.checkedSegments, 4);
  assert.deepEqual(validation.uncheckedCurves, [{entityId: 'e4', type: 'ARC'}]);
  assert.equal(validation.limitations.length, 1);
});
