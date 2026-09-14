const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readAiResponse}=require('../integration/ai-response');
const encoder=new TextEncoder();
const delta=content=>({choices:[{index:0,delta:{content},finish_reason:null}]});
const finish=reason=>({choices:[{index:0,delta:{},finish_reason:reason}]});
const event=value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\r\n\r\n';
function sse(chunks,{close=true,onCancel=()=>{}}={}) {
  return new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(typeof chunk==='string'?encoder.encode(chunk):chunk);if(close)controller.close();},cancel:onCancel}),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
}
test('readAiResponse preserves ordinary JSON Chat Completions responses',async()=>{
  const body={choices:[{message:{content:'{"unit":"m"}'},finish_reason:'stop'}],usage:{total_tokens:12}};
  assert.deepEqual(await readAiResponse(new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}})),body);
});
test('readAiResponse reassembles fragmented SSE, UTF-8, CRLF and usage',async()=>{
  const text=': heartbeat\r\n\r\n'+event(delta('{"nota":"'))+event(delta('posição'))+event(delta('"}'))+event(finish('stop'))+event({choices:[],usage:{prompt_tokens:10,completion_tokens:4}})+event('[DONE]');
  const bytes=encoder.encode(text),chunks=Array.from(bytes,b=>new Uint8Array([b]));
  const result=await readAiResponse(sse(chunks));
  assert.equal(result.choices[0].message.content,'{"nota":"posição"}');
  assert.equal(result.choices[0].finish_reason,'stop');assert.deepEqual(result.usage,{prompt_tokens:10,completion_tokens:4});
});
test('DONE returns immediately and cancels an SSE connection that stays open',async()=>{
  let cancelled=false;
  const response=sse([event(delta('{}'))+event(finish('stop'))+event('[DONE]')],{close:false,onCancel(){cancelled=true;return new Promise(()=>{});}});
  const result=await readAiResponse(response);
  assert.equal(result.choices[0].message.content,'{}');assert.equal(cancelled,true);
});
test('Incomplete SSE and truncated JSON are rejected explicitly',async()=>{
  await assert.rejects(readAiResponse(sse([event(delta('{}'))+event(finish('stop'))])),/incompleto.*DONE/);
  await assert.rejects(readAiResponse(sse([event(delta('{}'))+event('[DONE]')])),/incompleto.*conclusão/);
  await assert.rejects(readAiResponse(new Response('{"choices":')),/JSON inválido ou incompleto/);
  await assert.rejects(readAiResponse(sse(['data: {"choices":\n\n'])),/JSON inválido ou incompleto/);
});
test('Token truncation reason is retained for the caller to reject',async()=>{
  const result=await readAiResponse(sse([event(delta('{'))+event(finish('length'))+event('[DONE]')]));
  assert.equal(result.choices[0].finish_reason,'length');
});
test('JSON and SSE bodies are bounded to 4 MB and oversized streams are canceled',async()=>{
  const big='x'.repeat(4*1024*1024+1);
  await assert.rejects(readAiResponse(new Response(big)),/4 MB/);
  let cancelled=false;
  await assert.rejects(readAiResponse(sse([big],{close:false,onCancel(){cancelled=true;}})),/4 MB/);
  assert.equal(cancelled,true);
});
