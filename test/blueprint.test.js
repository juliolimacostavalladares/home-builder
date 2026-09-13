const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const converter = require('../converter');
const { convertDxf } = require('../integration/cad-to-blueprint');
function dxf(lines, unit = 6) {
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${unit}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n` + lines.map(([x,y,xx,yy]) => `0\nLINE\n8\nWALL\n10\n${x}\n20\n${y}\n11\n${xx}\n21\n${yy}\n`).join('') + '0\nENDSEC\n0\nEOF\n';
}
function upstream() {
  const context = vm.createContext({ console, THREE: require('../vendor/blueprint3d/node_modules/three'), $: { Callbacks() { const callbacks = []; return { add(fn) { callbacks.push(fn); }, fire(...args) { callbacks.forEach(fn => fn(...args)); }, remove(fn) { const i=callbacks.indexOf(fn); if(i>=0) callbacks.splice(i,1); } }; } } });
  vm.runInContext(fs.readFileSync('vendor/blueprint3d/example/js/blueprint3d.js','utf8'), context);
  return new context.BP3D.Model.Model('models/textures/');
}
const rect = [[0,0,4,0],[4,0,4,3],[4,3,0,3],[0,3,0,0]];
test('meter CAD round-trips through the real upstream Model and creates one room', () => {
  const { design } = convertDxf(dxf(rect), { mode: 'axes' });
  assert.equal(design.floorplan.walls.length,4);
  assert.equal(Math.max(...Object.values(design.floorplan.corners).map(c=>c.x)),200);
  const model=upstream(); model.loadSerialized(JSON.stringify(design));
  assert.equal(model.floorplan.getRooms().length,1);
  const saved=model.exportSerialized(); model.loadSerialized(saved);
  assert.equal(model.floorplan.getRooms().length,1);
  assert.equal(JSON.parse(saved).floorplan.walls.length,4);
});
test('splits crossings and T junctions and removes reversed duplicate walls', () => {
  const {design}=convertDxf(dxf([...rect,[2,0,2,3],[4,0,0,0]]),{mode:'axes'});
  const model=upstream();model.loadSerialized(JSON.stringify(design));
  assert.equal(model.floorplan.getRooms().length,2);
  assert.equal(design.floorplan.walls.length,7);
});
test('parallel faces become central axes, not duplicate walls', () => {
  const {design}=convertDxf(dxf([[0,0,4,0],[0,.15,4,.15]]),{mode:'faces', thickness:15});
  assert.equal(design.floorplan.walls.length,1);
  assert.ok(Object.values(design.floorplan.corners).every(c=>Math.abs(c.y)<.001));
});
test('unknown units and absent wall layers require explicit selection', () => {
  assert.throws(()=>convertDxf(dxf(rect,0),{mode:'axes'}),/unidade/);
  assert.throws(()=>convertDxf(dxf(rect),{layers:['missing']}),/camada/);
  assert.throws(()=>convertDxf(dxf(rect),{thickness:'bad'}),/Espessura/);
  assert.throws(()=>convertDxf(dxf(rect),{unit:'toString'}),/unidade/);
});
test('both repository DWGs produce native files readable by upstream',async()=>{
  for(const [file,layers] of [['2 quartos - 70m2.dwg',['1']],['public/samples/Planta_3_quartos-160m2.dwg',['PAREDE']]]) {
    const raw=await converter.toDxf(await converter.parseCadFile(file));
    const result=convertDxf(raw,{unit:'m',layers,mode:'faces'});
    const model=upstream();model.floorplan.loadFloorplan(result.design.floorplan);
    assert.ok(model.floorplan.getWalls().length>0);
    assert.ok(model.floorplan.getRooms().length>0);
    for (const item of result.design.items) {
      assert.ok([3,7].includes(item.item_type));
      assert.ok([item.xpos,item.ypos,item.zpos,item.scale_x,item.scale_y,item.scale_z].every(Number.isFinite));
      assert.ok(fs.existsSync('vendor/blueprint3d/example/'+item.model_url));
    }
    assert.equal(model.floorplan.getWalls().length,result.report.walls);
    console.log(file,result.report.walls,'walls',model.floorplan.getRooms().length,'rooms',result.report.openEnds,'open ends');
  }
});
