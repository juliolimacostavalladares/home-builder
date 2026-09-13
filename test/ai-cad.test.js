const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {inventory,validateInterpretation}=require('../integration/cad-inventory');
const {renderSemanticSvg}=require('../integration/semantic-svg');
const {interpretCad}=require('../integration/ai-interpreter');
const {runPipeline}=require('../integration/ai-pipeline');
const line=(a,b)=>`0\nLINE\n8\nWALL\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}\n`;
const dxf='0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'+[[[0,0],[4,0]],[[4,0],[4,3]],[[4,3],[0,3]],[[0,3],[0,0]]].map(([a,b])=>line(a,b)).join('')+'0\nTEXT\n8\nLABEL\n10\n2\n20\n1\n40\n0.15\n1\nQUARTO\n0\nENDSEC\n0\nEOF\n';
const answer={unit:'m',unitEvidence:'INSUNITS=6',assignments:[{role:'wall_axis',ids:['e0','e1','e2','e3']},{role:'room_label',ids:['e4']}],notes:[]};
const nativeAnswer={...answer,contractVersion:'cad-blueprint3d/2',transform:{origin:{x:0,y:0},scaleToCm:100,invertY:true},
 design:{floorplan:{corners:{a:{x:0,y:0},b:{x:400,y:0},c:{x:400,y:-300},d:{x:0,y:-300}},walls:[['a','b'],['b','c'],['c','d'],['d','a']].map(([corner1,corner2],i)=>({corner1,corner2,cad:{thicknessCm:i===0?20:15,heightCm:250}})),wallTextures:[],floorTextures:{},newFloorTextures:{}},items:[]},
 provenance:{walls:[0,1,2,3].map(i=>({wallIndex:i,sourceIds:['e'+i],reason:'Eixo CAD em centímetros.'})),items:[]},assumptions:[{property:'wall.heightCm',value:250,reason:'Altura ausente no CAD.',sourceIds:[]}]};
test('AI output references source entities and cannot supply invented geometry',()=>{
 const data=inventory(dxf);assert.equal(data.instances.length,5);
 assert.equal(validateInterpretation(answer,data).get('e0'),'wall_axis');
 assert.throws(()=>validateInterpretation({...answer,corners:{}},data),/Campo não permitido/);
 assert.throws(()=>validateInterpretation({...answer,assignments:[...answer.assignments,{role:'door',ids:['e0']}]},data),/duplicada/);
 assert.throws(()=>validateInterpretation({...answer,assignments:answer.assignments.slice(0,1)},data),/sem classificação/);
});
test('Semantic colors, IDs and escaped CAD text remain traceable',()=>{
 const data=inventory(dxf);data.instances[4].entity.text='<script>alert(1)</script>';
 const result=renderSemanticSvg(data,validateInterpretation(answer,data));
 assert.match(result.svg,/data-entity-id="e0"/);assert.match(result.svg,/#15803d/);assert.match(result.svg,/#7e22ce/);assert.match(result.svg,/#92400e/);
 assert.ok(result.svg.includes('&lt;script&gt;'));assert.ok(!result.svg.includes('<script>'));assert.equal(result.rendered.length,5);
 assert.match(renderSemanticSvg(data).svg,/sem classificação semântica/);
});
test('AI request contains complete technical inventory and both reference images',async()=>{
 const data=inventory(dxf);let payload;
 const result=await interpretCad(data,Buffer.from('synthetic'),{url:'http://example.invalid/v1',model:'test'},{layerImage:Buffer.from('layers'),fetchImpl:async(url,options)=>{
  assert.equal(url,'http://example.invalid/v1/chat/completions');payload=JSON.parse(options.body);
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(nativeAnswer)}}]})};
 }});
 assert.equal(result.model,'test');assert.equal(payload.messages[1].content.length,3);assert.ok(payload.messages[1].content[0].text.includes(data.sha256));assert.ok(payload.messages[1].content[0].text.includes('cad-blueprint3d/2'));assert.ok(payload.messages[1].content[0].text.includes('modelCatalog'));
});
test('Pipeline retries invalid classification and validates a native floor before publishing',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cad-ai-test-')),input=path.join(dir,'input.dxf');fs.writeFileSync(input,dxf);let calls=0;const stages=[];
 try {
  const result=await runPipeline(input,{}, {directory:dir,onStage:s=>stages.push(s.name),interpret:async(data,image,config,options)=>{
   calls++;if(calls===1)throw new Error('JSON inválido');assert.match(options.feedback.issues[0],/JSON/);return {interpretation:nativeAnswer,model:'mock-test'};
  }});
  assert.equal(calls,2);assert.equal(result.validation.rooms,1);assert.equal(result.validation.roomAnchors,1);assert.ok(result.validation.valid);assert.equal(stages.at(-1),'ready');assert.deepEqual(result.design,nativeAnswer.design);assert.equal(result.report.strategy,'ai-native');
  assert.ok(fs.existsSync(path.join(dir,'design.blueprint3d')));assert.match(fs.readFileSync(path.join(dir,'semantic.svg'),'utf8'),/data-floor-id="floor-1"/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Contradictory units never publish a native design',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cad-ai-reject-')),input=path.join(dir,'input.dxf');fs.writeFileSync(input,dxf);
 try{await assert.rejects(runPipeline(input,{}, {directory:dir,interpret:async()=>({interpretation:{...nativeAnswer,unit:'mm'},model:'mock-test'})}),/não produziu/);assert.ok(!fs.existsSync(path.join(dir,'design.blueprint3d')));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Rejected AI responses retain local diagnostics and cannot publish a demo model',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cad-ai-response-')),input=path.join(dir,'input.dxf');fs.writeFileSync(input,dxf);const stages=[];
 try{
  await assert.rejects(runPipeline(input,{}, {directory:dir,onStage:s=>stages.push(s),interpret:async(data,image,config,options)=>{
   await options.onResponse({content:'{"design":',contentTruncated:false,finishReason:'stop'});
   throw new Error('IA retornou JSON inválido.');
  }}),/O desenho CAD continua disponível/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'ai-response-2.json'),'utf8')).content,'{"design":');
  assert.equal(stages.filter(s=>s.name==='rejected').length,2);
  assert.ok(fs.existsSync(path.join(dir,'source.svg')));assert.ok(!fs.existsSync(path.join(dir,'design.blueprint3d')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
