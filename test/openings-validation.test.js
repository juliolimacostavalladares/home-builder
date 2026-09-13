const {test}=require('node:test');
const assert=require('node:assert/strict');
const {convertDxf}=require('../integration/cad-to-blueprint');
const {inventory,validateInterpretation}=require('../integration/cad-inventory');
const {validateNative}=require('../integration/validate-native');
const line=(a,b)=>`0\nLINE\n8\nCAD\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}\n`;
const room=[[[0,0],[400,0]],[[400,0],[400,300]],[[400,300],[0,300]],[[0,300],[0,0]]].map(([a,b])=>line(a,b)).join('');
function fixture(extra,assignments){
  const dxf='0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n5\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'+room+extra+'0\nENDSEC\n0\nEOF\n';
  const data=inventory(dxf),roles=validateInterpretation({unit:'cm',assignments:[{role:'wall_axis',ids:['e0','e1','e2','e3']},...assignments]},data);
  return {data,roles,result:convertDxf(dxf,{unit:'cm',roles})};
}
test('Window strokes on a continuous axis wall create one native opening and retain all source references',()=>{
  const {data,roles,result}=fixture(line([120,300],[240,300])+line([120,295],[240,295])+line([120,295],[120,300]),[{role:'window',ids:['e4','e5','e6']}]);
  assert.equal(result.design.items.length,1);
  assert.equal(result.design.floorplan.walls.length,4);
  assert.deepEqual(new Set(result.design.items[0].cad_opening.sourceIds),new Set(['e4','e5','e6']));
  const validation=validateNative(result,data,roles);
  assert.equal(validation.valid,true,validation.issues.join('; '));
  assert.equal(validation.openings,1);
});
test('A door swing on an axis wall selects its wall-aligned tip and places a native door',()=>{
  const arc='0\nARC\n8\nCAD\n10\n100\n20\n0\n40\n80\n50\n0\n51\n90\n';
  const {data,roles,result}=fixture(arc+line([100,0],[100,80]),[{role:'door',ids:['e4','e5']}]);
  assert.equal(result.design.items.length,1);
  const item=result.design.items[0];assert.equal(item.item_type,7);
  assert.equal(item.xpos,-60);assert.equal(item.zpos,150);
  const validation=validateNative(result,data,roles);assert.equal(validation.valid,true,validation.issues.join('; '));
});
test('Native floor success does not publish a missing or misplaced CAD opening',()=>{
  const {data,roles,result}=fixture(line([120,300],[240,300]),[{role:'window',ids:['e4']}]);
  const missing=structuredClone(result);missing.design.items=[];
  const missingValidation=validateNative(missing,data,roles);
  assert.equal(missingValidation.rooms,1);assert.equal(missingValidation.valid,false);assert.match(missingValidation.issues.join(' '),/sem correspondência/);
  const shifted=structuredClone(result);shifted.design.items[0].xpos+=50;
  assert.equal(validateNative(shifted,data,roles).valid,false);
  const wrongWall=structuredClone(result);wrongWall.design.items[0].zpos=0;wrongWall.design.items[0].cad_opening.start.y=0;wrongWall.design.items[0].cad_opening.end.y=0;
  assert.match(validateNative(wrongWall,data,roles).issues.join(' '),/parede correta/);
});
test('An unplaceable window is rejected even when the room has a complete native floor',()=>{
  const {data,roles,result}=fixture(line([120,150],[240,150]),[{role:'window',ids:['e4']}]);
  assert.equal(result.design.items.length,0);
  const validation=validateNative(result,data,roles);assert.equal(validation.valid,false);assert.match(validation.issues.join(' '),/e4/);
});
