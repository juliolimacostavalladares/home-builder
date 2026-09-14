const MAX_BYTES=4*1024*1024;

function parseJson(text) {
  try{return JSON.parse(text);}catch{throw new Error('Serviço de IA retornou JSON inválido ou incompleto.');}
}

/** Read either a regular Chat Completions response or an SSE response from a proxy. */
async function readAiResponse(response) {
  const type=response.headers?.get?.('content-type')||'';
  const isStream=/\btext\/event-stream\b/i.test(type);
  if(Number(response.headers?.get?.('content-length'))>MAX_BYTES){
    response.body?.cancel?.().catch(()=>{});
    throw new Error('Resposta da IA excede o limite de 4 MB.');
  }
  // Lightweight injected test transports may expose only json()/text(). Actual
  // fetch responses are read incrementally below, enforcing the limit in flight.
  if(!response.body?.getReader){
    if(isStream)throw new Error('Fluxo SSE da IA sem corpo legível.');
    const text=response.text?await response.text():JSON.stringify(await response.json());
    if(Buffer.byteLength(text)>MAX_BYTES)throw new Error('Resposta da IA excede o limite de 4 MB.');
    return parseJson(text);
  }
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,pending='',json='',dataLines=[],content='',finishReason=null,usage=null,seenChoice=false;
  function event() {
    if(!dataLines.length)return false;
    const data=dataLines.join('\n');dataLines=[];
    if(data.trim()==='[DONE]'){
      if(!seenChoice||finishReason===null)throw new Error('Fluxo SSE da IA incompleto: falta a conclusão da resposta.');
      return true;
    }
    const chunk=parseJson(data);
    if(chunk.error)throw new Error('Serviço de IA retornou um erro durante o fluxo SSE.');
    if(chunk.usage!=null)usage=chunk.usage;
    const choice=chunk.choices?.[0];
    if(choice){
      seenChoice=true;
      const delta=choice.delta?.content;
      if(delta!=null){
        if(typeof delta!=='string')throw new Error('Fluxo SSE da IA contém conteúdo textual inválido.');
        content+=delta;
      }
      if(choice.finish_reason!=null)finishReason=choice.finish_reason;
    }
    return false;
  }
  function consumeLines(final=false) {
    while(true){
      const index=pending.search(/[\r\n]/);
      if(index<0)break;
      // A CRLF delimiter itself can be split between network chunks.
      if(pending[index]==='\r'&&index===pending.length-1&&!final)break;
      const line=pending.slice(0,index),skip=pending[index]==='\r'&&pending[index+1]==='\n'?2:1;
      pending=pending.slice(index+skip);
      if(!line){if(event())return true;continue;}
      if(line.startsWith(':'))continue;
      const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon);
      if(field==='data'){
        let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
        dataLines.push(value);
      }
    }
    return false;
  }
  function result(){return {choices:[{index:0,message:{role:'assistant',content},finish_reason:finishReason}],usage};}
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done){
        const last=decoder.decode();
        if(!isStream)return parseJson(json+last);
        pending+=last;
        if(consumeLines(true))return result();
        throw new Error('Fluxo SSE da IA incompleto: conexão encerrada antes de [DONE].');
      }
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES)throw new Error('Resposta da IA excede o limite de 4 MB.');
      const text=decoder.decode(value,{stream:true});
      if(!isStream){json+=text;continue;}
      pending+=text;
      if(consumeLines())return result();
    }
  }finally{
    // Some proxies leave SSE connections open even after [DONE]. Do not await
    // network teardown: canceling the reader is sufficient to stop consuming it.
    reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

module.exports={readAiResponse};
