const {createHash}=require('crypto');
const MAX_CONTENT_BYTES=1024*1024;

// This record contains only the model's answer, never the request headers,
// credentials, images or technical prompt. The caller chooses local storage.
function responseDiagnostic(result,model){
  const choice=result.choices?.[0],value=choice?.message?.content;
  const raw=typeof value==='string'?value:JSON.stringify(value??null);
  const bytes=Buffer.from(raw),truncated=bytes.length>MAX_CONTENT_BYTES;
  let end=bytes.length,start=bytes.length;
  if(truncated){
    end=MAX_CONTENT_BYTES/2;start=bytes.length-MAX_CONTENT_BYTES/2;
    // Keep whole UTF-8 code points when retaining the beginning and ending.
    while(end>0&&(bytes[end]&0xc0)===0x80)end--;
    while(start<bytes.length&&(bytes[start]&0xc0)===0x80)start++;
  }
  const usage={};
  for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isFinite(result.usage?.[key]))usage[key]=result.usage[key];
  return {model,finishReason:choice?.finish_reason??null,refusal:!!choice?.message?.refusal,usage,
    contentType:typeof value,contentBytes:bytes.length,contentSha256:createHash('sha256').update(bytes).digest('hex'),contentTruncated:truncated,
    content:bytes.subarray(0,end).toString('utf8'),...(truncated?{contentTail:bytes.subarray(start).toString('utf8'),omittedBytes:start-end}:{})};
}

function invalidJsonDiagnostic(error,content){
  // JSON.parse's message can contain CAD text. Expose only its numeric location;
  // the exact answer is available in the bounded local diagnostic record.
  let position=null;
  const match=error.message.match(/position (\d+)/);
  if(match){
    position=Number(match[1]);
  }else{
    const snippet=error.message.match(/\.\.\.\"(.*?)\"\.\.\./)||error.message.match(/\"(.*?)\"/);
    const token=error.message.match(/Unexpected token '(.*?)'/);
    if(snippet){
      const snipText=snippet[1],snipIndex=content.indexOf(snipText);
      if(snipIndex!==-1){
        if(token){
          const tokIndex=snipText.indexOf(token[1],Math.max(0,Math.floor(snipText.length/2)-5));
          position=tokIndex!==-1?snipIndex+tokIndex:snipIndex+snipText.indexOf(token[1]);
        }else{
          position=snipIndex;
        }
      }
    }
  }
  return {position:position===null?null:Number(position),characters:content.length,bytes:Buffer.byteLength(content)};
}

module.exports={responseDiagnostic,invalidJsonDiagnostic,MAX_CONTENT_BYTES};
