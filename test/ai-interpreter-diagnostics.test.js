const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {createHash}=require('crypto');
const {interpretCad}=require('../integration/ai-interpreter');
const {responseDiagnostic,MAX_CONTENT_BYTES}=require('../integration/ai-response-diagnostic');

const data={source:{entities:[],blocks:{}},instances:[],sha256:'synthetic-source'};
const config={url:'http://example.invalid/v1',key:'synthetic-credential',model:'mock-model'};
const envelope=(content,finishReason='stop')=>({choices:[{message:{content},finish_reason:finishReason}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}});
const transport=body=>async()=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

test('JSON mode is requested and a malformed answer is preserved locally before rejection',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cad-ai-response-')),file=path.join(dir,'response.json');
  const raw='{"design":{"floorplan": invalid CAD content}}';let calls=0;
  try{
    await assert.rejects(interpretCad(data,Buffer.from('synthetic-image'),config,{
      fetchImpl:async(url,options)=>{
        calls++;assert.equal(url,'http://example.invalid/v1/chat/completions');
        const payload=JSON.parse(options.body);assert.deepEqual(payload.response_format,{type:'json_object'});assert.equal(payload.stream,false);
        assert.equal(options.headers.Accept,'application/json');
        return transport(envelope(raw))();
      },
      onResponse:async diagnostic=>{await fs.promises.writeFile(file,JSON.stringify(diagnostic));}
    }),error=>{
      assert.match(error.message,/JSON inválido na posição \d+ \(\d+ caracteres; \d+ bytes\)/);assert.ok(!error.message.includes('CAD content'));
      assert.equal(error.aiResponse.content,raw);assert.equal(error.interpretation,undefined);
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(saved,error.aiResponse);
      assert.equal(saved.parseError.characters,raw.length);assert.equal(saved.parseError.bytes,Buffer.byteLength(raw));assert.equal(typeof saved.parseError.position,'number');
      assert.equal(saved.finishReason,'stop');assert.equal(saved.contentSha256,createHash('sha256').update(raw).digest('hex'));
      assert.ok(!JSON.stringify(saved).includes(config.key));assert.ok(!JSON.stringify(saved).includes('synthetic-image'));
      return true;
    });
    assert.equal(calls,1,'the transport must never silently resend or repair the answer');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Diagnostic keeps bounded UTF-8 beginning and ending with full-answer hash',()=>{
  const raw='START '+('á🍀'.repeat(MAX_CONTENT_BYTES))+' END';
  const diagnostic=responseDiagnostic(envelope(raw),'mock-model');
  assert.equal(diagnostic.contentTruncated,true);assert.ok(diagnostic.content.startsWith('START '));assert.ok(diagnostic.contentTail.endsWith(' END'));
  assert.ok(Buffer.byteLength(diagnostic.content)+Buffer.byteLength(diagnostic.contentTail)<=MAX_CONTENT_BYTES);
  assert.ok(!diagnostic.content.includes('�'));assert.ok(!diagnostic.contentTail.includes('�'));
  assert.equal(diagnostic.contentBytes,Buffer.byteLength(raw));
  assert.equal(diagnostic.omittedBytes,Buffer.byteLength(raw)-Buffer.byteLength(diagnostic.content)-Buffer.byteLength(diagnostic.contentTail));
  assert.equal(diagnostic.contentSha256,createHash('sha256').update(raw).digest('hex'));
});

test('Truncation and refusal stay distinct from invalid JSON and retain the original answer',async()=>{
  for(const [body,expected] of [
    [envelope('{','length'),/truncada/],
    [envelope('{}','content_filter'),/não concluiu/],
    [{choices:[{message:{content:'Refused',refusal:'refused'},finish_reason:'stop'}]},/recusou/]
  ]){
    let diagnostic;
    await assert.rejects(interpretCad(data,Buffer.from('synthetic'),config,{fetchImpl:transport(body),onResponse:value=>{diagnostic=value;}}),error=>{
      assert.match(error.message,expected);assert.equal(error.aiResponse,diagnostic);assert.equal(diagnostic.content,body.choices[0].message.content);return true;
    });
  }
});

test('Valid JSON that violates the target contract is preserved without changing values',async()=>{
  const value={contractVersion:'unknown',design:{floorplan:{corners:{a:{x:1.234,y:5.678}}}}};
  await assert.rejects(interpretCad(data,Buffer.from('synthetic'),config,{fetchImpl:transport(envelope(JSON.stringify(value)))}),error=>{
    assert.match(error.message,/versão de resposta inválida/);assert.deepEqual(error.interpretation,value);assert.equal(error.aiResponse.content,JSON.stringify(value));return true;
  });
});
