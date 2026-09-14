const contract = require('./contracts/cad-blueprint3d-v2.json');
const {roleFor} = require('./cad-inventory');
const {modelSize} = require('./openings');
const STRUCTURE = new Set(['wall_face','wall_axis','wall_detail','floor_boundary']);
const OPENINGS = new Set(['door','window']);
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e8;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function ensure(condition, message) { if (!condition) throw new Error('Contrato CAD → Blueprint3D: ' + message); }
function refs(ids, validIds) { return Array.isArray(ids) && ids.length > 0 && ids.every(id => validIds.has(id)) && new Set(ids).size === ids.length; }
function runtimeContract() {
  return {...contract, modelCatalog: [
    {kind:'door',item_type:7,model_url:'models/js/closed-door28x80_baked.js',dimensionsCm:modelSize('door')},
    {kind:'window',item_type:3,model_url:'models/js/whitewindow.js',dimensionsCm:modelSize('window')}
  ]};
}
// Check the model supplied by AI. This module never constructs, snaps, pairs,
// deduplicates, moves, scales or repairs any output vertex or wall.
function validateAiNative(value, data) {
  ensure(record(value) && value.contractVersion === contract.version, 'versão de resposta inválida.');
  const allowed = new Set(Object.keys(contract.response));
  ensure(Object.keys(value).every(key => allowed.has(key)), 'campo fora do contrato.');
  ensure(Object.hasOwn(contract.coordinates.unitScales,value.unit), 'unidade inválida.');
  ensure(typeof value.unitEvidence === 'string' && value.unitEvidence.trim(), 'evidência de unidade ausente.');
  const declared = {1:'in',2:'ft',4:'mm',5:'cm',6:'m'}[data.source.header?.$INSUNITS];
  ensure(!declared || value.unit === declared, 'unidade contradiz o cabeçalho CAD.');
  const t = value.transform;
  ensure(record(t) && record(t.origin) && [t.origin.x,t.origin.y].every(finite) && t.invertY === true && t.scaleToCm === contract.coordinates.unitScales[value.unit], 'transformação de unidade/eixos inválida.');
  const ids = new Set(data.instances.map(e => e.id)), roles = new Map();
  ensure(Array.isArray(value.assignments), 'classificação ausente.');
  for (const group of value.assignments) {
    ensure(record(group) && Object.hasOwn(contract.categories,group.role) && refs(group.ids,ids), 'categoria ou referências inválidas.');
    for (const id of group.ids) { ensure(!roles.has(id), `ID classificado duas vezes: ${id}.`); roles.set(id,group.role); }
  }
  for (const e of data.instances) {
    const role = roleFor(e.id,roles);
    ensure(role, `entidade sem classificação: ${e.id}.`);
    ensure(role !== 'unresolved', `entidade não resolvida: ${e.id}.`);
  }
  ensure(Array.isArray(value.notes) && value.notes.every(n=>typeof n==='string'), 'notas inválidas.');
  ensure(Array.isArray(value.assumptions) && value.assumptions.every(a=>record(a)&&typeof a.property==='string'&&typeof a.reason==='string'&&Array.isArray(a.sourceIds)&&a.sourceIds.every(id=>ids.has(id))), 'premissas inválidas.');
  const design = value.design, floor = design?.floorplan;
  ensure(record(design) && record(floor) && record(floor.corners) && Array.isArray(floor.walls) && Array.isArray(design.items), 'documento nativo ausente.');
  const corners = Object.entries(floor.corners);
  ensure(corners.length >= 3 && corners.length <= 4000 && floor.walls.length > 0 && floor.walls.length <= 2000 && design.items.length <= 500, 'limite ou quantidade de geometria inválida.');
  const knownCorners = new Set();
  for (const [id,p] of corners) {
    ensure(/^[a-zA-Z][\w-]{0,63}$/.test(id) && !['constructor','prototype','__proto__'].includes(id) && record(p) && finite(p.x) && finite(p.y), 'canto inválido.'); knownCorners.add(id);
  }
  // Only shipped resources are allowed; an AI response cannot request arbitrary URLs.
  ensure(Array.isArray(floor.wallTextures) && !floor.wallTextures.length && record(floor.floorTextures) && !Object.keys(floor.floorTextures).length && record(floor.newFloorTextures) && !Object.keys(floor.newFloorTextures).length, 'use texturas padrão do motor.');
  const edges = new Set();
  for (const wall of floor.walls) {
    ensure(record(wall) && knownCorners.has(wall.corner1) && knownCorners.has(wall.corner2) && wall.corner1!==wall.corner2, 'referência de parede inválida.');
    const edge = [wall.corner1,wall.corner2].sort().join(':'); ensure(!edges.has(edge), 'parede duplicada.'); edges.add(edge);
    ensure(!wall.frontTexture && !wall.backTexture && record(wall.cad), 'propriedades locais de parede ausentes ou textura externa.');
    if (wall.cad.floorBoundary !== true) ensure(finite(wall.cad.thicknessCm) && wall.cad.thicknessCm > 0 && wall.cad.thicknessCm <= 100 && finite(wall.cad.heightCm) && wall.cad.heightCm > 0 && wall.cad.heightCm <= 2000, 'espessura/altura local inválida.');
  }
  const graphIssues=require('./validate-ai-graph').validateAiGraph(floor);
  ensure(!graphIssues.length,graphIssues.slice(0,15).join(' '));
  const provenance = value.provenance;
  ensure(record(provenance) && Array.isArray(provenance.walls) && provenance.walls.length === floor.walls.length && Array.isArray(provenance.items) && provenance.items.length === design.items.length, 'proveniência incompleta.');
  const linked = new Set(), wallIndexes = new Set(), itemIndexes = new Set();
  for (const link of provenance.walls) {
    ensure(Number.isInteger(link.wallIndex) && link.wallIndex >= 0 && link.wallIndex < floor.walls.length && !wallIndexes.has(link.wallIndex) && refs(link.sourceIds,ids) && typeof link.reason==='string' && link.reason.trim(), 'proveniência de parede inválida.');
    wallIndexes.add(link.wallIndex);
    ensure(link.sourceIds.some(id=>STRUCTURE.has(roleFor(id,roles)) || OPENINGS.has(roleFor(id,roles))), 'parede sem fonte estrutural ou de vão.');
    const boundary=floor.walls[link.wallIndex].cad.floorBoundary===true;
    ensure(boundary ? link.sourceIds.some(id=>roleFor(id,roles)==='floor_boundary') : link.sourceIds.some(id=>['wall_face','wall_axis','wall_detail','door','window'].includes(roleFor(id,roles))), 'borda de piso e alvenaria exigem fontes correspondentes.');
    link.sourceIds.forEach(id=>linked.add(id));
  }
  const catalog = runtimeContract().modelCatalog;
  for (const link of provenance.items) {
    ensure(Number.isInteger(link.itemIndex) && link.itemIndex >= 0 && link.itemIndex < design.items.length && !itemIndexes.has(link.itemIndex) && Number.isInteger(link.wallIndex) && wallIndexes.has(link.wallIndex) && refs(link.sourceIds,ids) && typeof link.reason==='string', 'proveniência de objeto inválida.');
    itemIndexes.add(link.itemIndex);
    const item=design.items[link.itemIndex], kind=item.item_type===7?'door':'window', model=catalog.find(m=>m.item_type===item.item_type);
    ensure(model && item.model_url===model.model_url && [item.xpos,item.ypos,item.zpos,item.rotation,item.scale_x,item.scale_y,item.scale_z].every(finite) && [item.scale_x,item.scale_y,item.scale_z].every(s=>s>0), 'modelo/posição/escala de objeto inválido.');
    ensure(link.sourceIds.some(id=>roleFor(id,roles)===kind), 'objeto sem fonte da categoria correspondente.');
    ensure(item.cad_opening?.kind===kind && refs(item.cad_opening.sourceIds,ids) && item.cad_opening.sourceIds.every(id=>link.sourceIds.includes(id)) && finite(item.cad_opening.widthCm) && item.cad_opening.widthCm>0, 'evidência do vão ausente.');
    link.sourceIds.forEach(id=>linked.add(id));
  }
  for (const e of data.instances) if (STRUCTURE.has(roleFor(e.id,roles)) || OPENINGS.has(roleFor(e.id,roles))) {
    const covered=[...linked].some(id=>e.id===id || e.id.startsWith(id+'/') || (e.type==='INSERT' && id.startsWith(e.id+'/')));
    ensure(covered, `entidade física sem correspondente no destino: ${e.id}.`);
  }
  const degree={}; for(const w of floor.walls)for(const id of [w.corner1,w.corner2])degree[id]=(degree[id]||0)+1;
  const preserved=data.instances.filter(e=>contract.categories[roleFor(e.id,roles)].destination==='preserved').map(e=>({id:e.id,category:roleFor(e.id,roles)}));
  const physical=floor.walls.filter(w=>!w.cad.floorBoundary);
  return {roles,result:{design,report:{strategy:'ai-native',contractVersion:contract.version,unit:value.unit,unitSource:value.unitEvidence,transform:t,walls:floor.walls.length,physicalWalls:physical.length,floorBoundaries:floor.walls.length-physical.length,openEnds:Object.values(degree).filter(n=>n===1).length,warnings:[...value.notes,...value.assumptions.map(a=>`Premissa ${a.property}: ${JSON.stringify(a.value)}. ${a.reason}`)],preserved,assumptions:value.assumptions,provenance}}};
}
module.exports={runtimeContract,validateAiNative};
