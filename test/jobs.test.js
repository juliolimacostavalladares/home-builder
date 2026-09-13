const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const express=require('express');
const multer=require('multer');
const mount=require('../integration/jobs');
test('Async API publishes progress/artifacts and preserves failure diagnostics without AI network access',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cad-jobs-')),app=express();
 mount(app,multer({dest:root}).single('file'),{root,config:()=>({}),pipeline:async(input,config,{directory,onStage})=>{
  onStage({name:'inventory',message:'synthetic test'});
  if(fs.readFileSync(input,'utf8')==='fail'){const error=new Error('Invalid geometry');error.diagnostics=['open contour'];throw error;}
  fs.writeFileSync(path.join(directory,'inventory.json'),'{}');return {design:{},report:{}};
 }});
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const [source,expected] of [['synthetic','ready'],['fail','failed']]){
   const body=new FormData();body.append('file',new Blob([source]),'input.dxf');
   const response=await fetch(base+'/api/blueprint3d/jobs',{method:'POST',body});assert.equal(response.status,202);
   let job=await response.json();
   for(let i=0;i<20&&job.status==='running';i++){await new Promise(resolve=>setTimeout(resolve,10));job=await(await fetch(base+'/api/blueprint3d/jobs/'+job.id)).json();}
   assert.equal(job.status,expected);assert.equal(job.stages[0].name,'inventory');
   if(expected==='ready')assert.ok(job.artifacts['inventory.json']);else assert.deepEqual(job.diagnostics,['open contour']);
   assert.ok(!fs.existsSync(path.join(root,job.id,'input.dxf')));
  }
  assert.equal((await (await fetch(base+'/api/blueprint3d/recent')).json()).length,1);
  assert.equal((await fetch(base+'/api/blueprint3d/jobs/unknown')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
