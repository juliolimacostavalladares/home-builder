const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateAiNative,runtimeContract}=require('../integration/ai-native-contract');
const {validateAiGraph}=require('../integration/validate-ai-graph');
function fixture(){
 const corners={a:{x:0,y:0},b:{x:400,y:0},c:{x:400,y:-300},d:{x:0,y:-300}},ends=[['a','b'],['b','c'],['c','d'],['d','a']];
 const data={source:{header:{$INSUNITS:6}},instances:[0,1,2,3].map(i=>({id:'e'+i,type:'LINE'}))};
 const value={contractVersion:'cad-blueprint3d/2',unit:'m',unitEvidence:'INSUNITS=6',transform:{origin:{x:0,y:0},scaleToCm:100,invertY:true},assignments:[{role:'wall_axis',ids:['e0','e1','e2','e3']}],design:{floorplan:{corners,walls:ends.map(([corner1,corner2],i)=>({corner1,corner2,cad:{thicknessCm:10+i*5,heightCm:260+i*10}})),wallTextures:[],floorTextures:{},newFloorTextures:{}},items:[]},provenance:{walls:ends.map((_,i)=>({wallIndex:i,sourceIds:['e'+i],reason:'Coordenadas da entidade CAD.'})),items:[]},assumptions:[],notes:[]};return {data,value};
}
test('AI native document is passed through exactly, including different local dimensions',()=>{
 const {data,value}=fixture(),before=JSON.stringify(value);const {result}=validateAiNative(value,data);
 assert.strictEqual(result.design,value.design);assert.equal(JSON.stringify(value),before);assert.equal(result.design.floorplan.walls[3].cad.thicknessCm,25);assert.equal(result.report.strategy,'ai-native');
});
test('A classification-only response cannot activate the old geometric reconstruction',()=>{
 const {data,value}=fixture();delete value.design;assert.throws(()=>validateAiNative(value,data),/documento nativo/);
});
test('Missing source correspondence, unsupported resource URLs and unit drift are rejected',()=>{
 let {data,value}=fixture();value.provenance.walls.pop();assert.throws(()=>validateAiNative(value,data),/proveniência incompleta/);
 ({data,value}=fixture());value.transform.scaleToCm=1;assert.throws(()=>validateAiNative(value,data),/transformação/);
 ({data,value}=fixture());value.design.floorplan.walls[0].frontTexture={url:'https://example.invalid'};assert.throws(()=>validateAiNative(value,data),/textura externa/);
 ({data,value}=fixture());data.instances.push({id:'e4',type:'LINE'});value.assignments[0].ids.push('e4');assert.throws(()=>validateAiNative(value,data),/entidade física sem correspondente/);
});
test('Graph errors produce diagnostics without fixing the supplied geometry',()=>{
 const {value}=fixture(),floor=value.design.floorplan;floor.corners.e={x:200,y:100};floor.corners.f={x:200,y:-400};floor.walls.push({corner1:'e',corner2:'f'});const before=JSON.stringify(floor);
 assert.match(validateAiGraph(floor).join(' '),/Interseção/);assert.equal(JSON.stringify(floor),before);
});
test('The shared contract includes house structures and the actual destination model dimensions',()=>{
 const c=runtimeContract();for(const role of ['wall_face','wall_axis','wall_detail','floor_boundary','door','window','column','beam','roof','slab','stair','ramp','level','foundation','plumbing','electrical','section'])assert.ok(c.categories[role],role);
 assert.equal(c.modelCatalog.length,2);assert.ok(c.modelCatalog.every(m=>m.dimensionsCm.every(n=>n>0)));
});
