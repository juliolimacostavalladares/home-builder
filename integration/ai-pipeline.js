const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const converter=require('../converter');
const {inventory}=require('./cad-inventory');
const {interpretCad}=require('./ai-interpreter');
const {runtimeContract,validateAiNative}=require('./ai-native-contract');
const {validateNative}=require('./validate-native');
const {renderSemanticSvg}=require('./semantic-svg');
async function runPipeline(filePath,config,{directory,onStage=()=>{},interpret=interpretCad,initialFeedback}={}){
  const stage=(name,message)=>onStage({name,message,time:new Date().toISOString()});
  const write=(name,body)=>fs.writeFileSync(path.join(directory,name),typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body,null,2));
  stage('extract','Lendo o CAD e preservando as entidades técnicas.');
  const doc=await converter.parseCadFile(filePath);
  const dxf=path.extname(filePath).toLowerCase()==='.dxf'?fs.readFileSync(filePath,'utf8'):await converter.toDxf(doc);
  write('source.dxf',dxf);
  stage('vectorize','Gerando SVG e imagem de referência, sem redesenhar a planta.');
  const svg=await converter.toSvg(doc,{theme:'light',width:1600});write('source.svg',svg);
  const image=await sharp(Buffer.from(svg)).resize({width:1600}).flatten({background:'#ffffff'}).png().toBuffer();write('source.png',image);
  stage('inventory','Catalogando entidades, blocos, coordenadas, cotas e transformações.');
  const data=inventory(dxf);data.rawDxf=dxf;write('inventory.json',data);write('conversion-contract.json',runtimeContract());
  const layerView=renderSemanticSvg(data);write('layers.svg',layerView.svg);
  const layerImage=await sharp(Buffer.from(layerView.svg)).resize({width:1600}).png().toBuffer();write('layers.png',layerImage);
  let feedback=initialFeedback,accepted;
  for(let attempt=1;attempt<=2;attempt++){
    stage('interpret',`IA convertendo o CAD completo para o contrato Blueprint3D (${attempt}/2).`);
    let response;
    try{
    response=await interpret(data,image,config,{feedback,layerImage,onProgress:message=>stage('interpret',message),onResponse:diagnostic=>write(`ai-response-${attempt}.json`,diagnostic)});
    write(`interpretation-${attempt}.json`,response.interpretation);
    stage('adapt','Conferindo o modelo nativo produzido pela IA, sem reconstruir sua geometria.');
      const {roles,result}=validateAiNative(response.interpretation,data);
      // Preserve the full inventory and interpretation as an audit sidecar, not fake geometry.
      stage('validate','Validando contornos e triangulação no motor Blueprint3D original.');
      const validation=validateNative(result,data,roles);
      write(`validation-${attempt}.json`,validation);
      const semantic=renderSemanticSvg(data,roles,{floorRegions:validation.floorRegions,transform:result.report.transform});write('semantic.svg',semantic.svg);write('semantic-map.json',{rendered:semantic.rendered,missing:semantic.missing,colors:semantic.colors,labels:semantic.labels});
      if(!validation.valid){feedback={previous:response.interpretation,issues:validation.issues};continue;}
      accepted={...result,validation,ai:{model:response.model,attempts:attempt,usage:response.usage},sourceHash:data.sha256};break;
    }catch(error){
      if(error.aiResponse)write(`ai-response-${attempt}.json`,error.aiResponse);
      if(error.interpretation)write(`rejected-response-${attempt}.json`,error.interpretation);
      feedback={previous:response?.interpretation||error.interpretation,issues:[error.message]};
      write(`validation-${attempt}.json`,{valid:false,issues:feedback.issues});
      stage('rejected',`Tentativa ${attempt} não aceita: ${error.message}`);
    }
  }
  if(!accepted){const error=new Error('A IA não produziu um modelo Blueprint3D válido. O desenho CAD continua disponível.');error.diagnostics=feedback?.issues||[];throw error;}
  write('design.blueprint3d',accepted.design);write('conversion-map.json',{contractVersion:accepted.report.contractVersion,provenance:accepted.report.provenance,preserved:accepted.report.preserved,assumptions:accepted.report.assumptions});write('report.json',{...accepted,design:undefined});
  stage('ready','Interpretação validada. Arquivo nativo pronto para importação.');
  return accepted;
}
module.exports={runPipeline};
