const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

test('HTTP: original editor/assets, published AI contract and invalid uploads', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const url of ['/','/blueprint3d/','/blueprint3d/js/blueprint3d.js','/blueprint3d/js/three.min.js','/blueprint3d/models/js/whitewindow.js','/cad.html']) {
      const res=await fetch(base+url); assert.equal(res.status,200,url);
    }
    const html=await (await fetch(base+'/blueprint3d/')).text();
    assert.match(html,/blueprint-bridge.js/); assert.match(html,/Add Items/);
    const send=async(name,content,fields={})=>{
      const form=new FormData();form.append('file',new Blob([content]),name);
      for(const [k,v] of Object.entries(fields))form.append(k,v);
      return fetch(base+'/api/blueprint3d',{method:'POST',body:form});
    };
    const contract=await (await fetch(base+'/api/blueprint3d/contract')).json();
    assert.equal(contract.version,'cad-blueprint3d/2');assert.ok(contract.categories.wall_detail);
    assert.equal((await send('file.svg','<svg/>')).status,400);
    assert.equal((await fetch(base+'/api/blueprint3d',{method:'POST'})).status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
