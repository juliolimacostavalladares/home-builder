const DxfParser=require('dxf-parser');
const crypto=require('crypto');
const IDENTITY=[1,0,0,1,0,0];
// This is a local extraction budget, independent of the AI context budget.
// Ordinary CAD files can contain tens of thousands of drafting entities.
const MAX_INSTANCES=100000;
const MAX_BLOCK_DEPTH=12;
function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function point(m,p){return {x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5],z:p.z||0};}
function inventoryError(message,code,details){const error=new Error(message);error.code=code;error.details=details;return error;}
// Count the INSERT graph before allocating expanded records. Shared definitions
// are memoized, but each placement still contributes its complete entity count.
function analyzeSource(source){
  const memo=new Map(),referenced=new Set();
  function block(name,ancestors=[]){
    referenced.add(name);
    if(ancestors.includes(name)){
      const cycle=[...ancestors.slice(ancestors.indexOf(name)),name];
      throw inventoryError(`Bloco CAD cíclico: ${cycle.join(' → ')}. Nenhum dado foi truncado.`,'CAD_BLOCK_CYCLE',{cycle});
    }
    if(ancestors.length>=MAX_BLOCK_DEPTH)throw inventoryError(`Blocos CAD excedem ${MAX_BLOCK_DEPTH} níveis. Nenhum dado foi truncado.`,'CAD_BLOCK_DEPTH',{block:name,limit:MAX_BLOCK_DEPTH});
    if(memo.has(name))return memo.get(name);
    const definition=source.blocks?.[name];
    if(!definition)throw inventoryError(`Definição do bloco CAD ausente: ${name}. Não é possível extrair todas as entidades.`,'CAD_BLOCK_MISSING',{block:name});
    const entities=definition.entities||[];
    let count=BigInt(entities.length),depth=1;
    for(const entity of entities)if(entity.type==='INSERT'){
      const child=block(entity.name,[...ancestors,name]);
      count+=child.count;depth=Math.max(depth,1+child.depth);
    }
    const summary={count,depth};memo.set(name,summary);return summary;
  }
  let count=BigInt(source.entities.length),maxDepth=0;
  for(const entity of source.entities)if(entity.type==='INSERT'){
    const child=block(entity.name);count+=child.count;maxDepth=Math.max(maxDepth,child.depth);
  }
  // A memoized block can be reused farther down another branch of the graph.
  if(maxDepth>MAX_BLOCK_DEPTH)throw inventoryError(`Blocos CAD excedem ${MAX_BLOCK_DEPTH} níveis. Nenhum dado foi truncado.`,'CAD_BLOCK_DEPTH',{maxDepth,limit:MAX_BLOCK_DEPTH});
  return {rootEntities:source.entities.length,expandedInstances:count<=BigInt(Number.MAX_SAFE_INTEGER)?Number(count):count.toString(),definedBlocks:Object.keys(source.blocks||{}).length,referencedBlocks:referenced.size,maxDepth};
}
function inventory(dxf){
  const source=new DxfParser().parseSync(dxf);
  if(!source?.entities?.length)throw new Error('CAD sem entidades legíveis.');
  const stats=analyzeSource(source);
  if(BigInt(stats.expandedInstances)>BigInt(MAX_INSTANCES))throw inventoryError(`CAD excede o orçamento local de ${MAX_INSTANCES} entidades instanciadas: ${stats.rootEntities} na raiz e ${stats.expandedInstances} após expansão de blocos (${stats.maxDepth} níveis). Nenhum dado foi truncado; a extração integral exige processamento em lotes.`,'CAD_INVENTORY_LIMIT',{...stats,limit:MAX_INSTANCES});
  const instances=[];
  function visit(entities,matrix,prefix,layer,depth){
    if(depth>MAX_BLOCK_DEPTH)throw new Error(`Blocos CAD excedem ${MAX_BLOCK_DEPTH} níveis.`);
    entities.forEach((entity,index)=>{
      const id=prefix+index,effectiveLayer=entity.layer&&entity.layer!=='0'?entity.layer:layer;
      const position=entity.position||entity.startPoint||entity.center;
      const record={id,type:entity.type,handle:entity.handle,layer:effectiveLayer,matrix,entity};
      if(position)record.worldPosition=point(matrix,position);
      if(entity.vertices)record.worldVertices=entity.vertices.map(p=>point(matrix,p));
      instances.push(record);
      if(entity.type==='INSERT'){
        const block=source.blocks?.[entity.name];if(!block)return;
        const angle=(entity.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),sx=entity.xScale??1,sy=entity.yScale??1;
        const base=block.position||{x:0,y:0},pos=entity.position||{x:0,y:0};
        const local=[c*sx,s*sx,-s*sy,c*sy,pos.x-c*sx*base.x+s*sy*base.y,pos.y-s*sx*base.x-c*sy*base.y];
        visit(block.entities||[],multiply(matrix,local),id+'/b',effectiveLayer,depth+1);
      }
    });
  }
  visit(source.entities,IDENTITY,'e','0',0);
  return {version:1,sha256:crypto.createHash('sha256').update(dxf).digest('hex'),source,instances,stats};
}
const ROLES=new Set(Object.keys(require('./contracts/cad-blueprint3d-v2.json').categories));
function roleFor(id,assignments){
  while(id){if(assignments.has(id))return assignments.get(id);const slash=id.lastIndexOf('/');if(slash<0)break;id=id.slice(0,slash);}
  return null;
}
function validateInterpretation(value,data){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('IA não retornou um objeto JSON.');
  if(!['mm','cm','m','in','ft'].includes(value.unit))throw new Error('IA retornou unidade inválida.');
  if(!Array.isArray(value.assignments)||value.assignments.length>data.instances.length)throw new Error('Classificações da IA inválidas.');
  const validIds=new Set(data.instances.map(e=>e.id)),roles=new Map();
  for(const group of value.assignments){
    if(!ROLES.has(group.role)||!Array.isArray(group.ids))throw new Error('Papel de entidade inválido.');
    for(const id of group.ids){if(!validIds.has(id)||roles.has(id))throw new Error(`Referência de entidade inválida ou duplicada: ${String(id).slice(0,60)}`);roles.set(id,group.role);}
  }
  const missing=data.instances.filter(e=>!roleFor(e.id,roles));
  if(missing.length)throw new Error(`IA deixou entidades sem classificação: ${missing.slice(0,15).map(e=>e.id).join(', ')}`);
  const unresolved=data.instances.filter(e=>roleFor(e.id,roles)==='unresolved');
  if(unresolved.length)throw new Error(`IA declarou entidades não resolvidas: ${unresolved.slice(0,15).map(e=>e.id).join(', ')}`);
  if(!data.instances.some(e=>['wall_face','wall_axis'].includes(roleFor(e.id,roles))))throw new Error('IA não identificou paredes.');
  for(const e of data.instances){if(['wall_face','wall_axis'].includes(roleFor(e.id,roles))&&!['LINE','LWPOLYLINE','POLYLINE','ARC','CIRCLE','INSERT'].includes(e.type))throw new Error(`Entidade estrutural ${e.id} (${e.type}) não suportada; a planta não será importada parcialmente.`);}
  // Freehand Blueprint3D coordinates are not an accepted output channel.
  for(const key of Object.keys(value))if(!['unit','unitEvidence','assignments','notes'].includes(key))throw new Error(`Campo não permitido na resposta da IA: ${key}`);
  return roles;
}
module.exports={inventory,validateInterpretation,roleFor,point};
