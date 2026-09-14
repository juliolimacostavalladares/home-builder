const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const DxfParser = require('dxf-parser');
const converter = require('../converter');
const { convertDxf } = require('../integration/cad-to-blueprint');
function nativeFloorplan(data) {
  const context = vm.createContext({ console, THREE: require('../vendor/blueprint3d/node_modules/three'), $: { Callbacks() { const callbacks=[];return {add(f){callbacks.push(f);},fire(...args){callbacks.forEach(f=>f(...args));},remove(){}}; } } });
  vm.runInContext(fs.readFileSync('vendor/blueprint3d/example/js/blueprint3d.js','utf8'),context);
  const model=new context.BP3D.Model.Model('models/textures/');
  model.floorplan.loadFloorplan(data); return model.floorplan;
}
function inside(point, corners) {
  let result=false;
  for(let i=0,j=corners.length-1;i<corners.length;j=i++) {
    const a=corners[i],b=corners[j];
    if((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}
test('160m2: every named interior space receives a native floor without manual edits',async()=>{
  const raw=await converter.toDxf(await converter.parseCadFile('public/samples/Planta_3_quartos-160m2.dwg'));
  const parsed=new DxfParser().parseSync(raw);
  const result=convertDxf(raw,{unit:'m',layers:['PAREDE'],mode:'faces'});
  const fp=nativeFloorplan(result.design.floorplan), t=result.report.transform;
  const anchors=parsed.entities.filter(e=>e.type==='INSERT' && /^(DORMI|WC|COZINHA|ESTAR|JANTAR)$/.test(e.name));
  for(const room of fp.getRooms()) {
    const polygonArea=Math.abs(room.interiorCorners.reduce((sum,a,i)=>{const b=room.interiorCorners[(i+1)%room.interiorCorners.length];return sum+a.x*b.y-b.x*a.y;},0))/2;
    const geom=room.floorPlane.geometry;
    const trianglesArea=geom.faces.reduce((sum,f)=>{const a=geom.vertices[f.a],b=geom.vertices[f.b],c=geom.vertices[f.c];return sum+Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;},0);
    assert.ok(Math.abs(polygonArea-trianglesArea)<.1,`Floor triangulation loses ${Math.abs(polygonArea-trianglesArea)} cm²`);
  }

  assert.equal(anchors.length,8);
  const missing=anchors.filter(e=>!fp.getRooms().some(r=>inside({x:(e.position.x-t.origin.x)*t.scaleToCm,y:-(e.position.y-t.origin.y)*t.scaleToCm},r.corners)));
  assert.deepEqual(missing.map(e=>e.name),[],`Missing floors: ${missing.map(e=>e.name).join(', ')}; ${result.report.openEnds} dangling endpoints`);
});
function drawing(segments, extra='') {
  return '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'+segments.map(([x,y,xx,yy])=>`0\nLINE\n8\nWALL\n10\n${x}\n20\n${y}\n11\n${xx}\n21\n${yy}\n`).join('')+extra+'0\nENDSEC\n0\nEOF\n';
}
test('door next to a corner keeps the room closed, including the short wall pier',()=>{
  const raw=drawing([[0,0,.1,0],[.9,0,4,0],[0,-.15,.1,-.15],[.9,-.15,4.15,-.15],
    [4,0,4,3],[4.15,-.15,4.15,3.15],[4,3,0,3],[4.15,3.15,-.15,3.15],[0,3,0,0],[-.15,3.15,-.15,-.15]],
    '0\nINSERT\n8\nDOORS\n2\nP80\n10\n0.1\n20\n0\n50\n0\n');
  const result=convertDxf(raw,{mode:'faces'});
  assert.equal(nativeFloorplan(result.design.floorplan).getRooms().length,1);
});
