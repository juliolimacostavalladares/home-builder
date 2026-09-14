const fs=require('fs');
const vm=require('vm');
const path=require('path');
const {roleFor}=require('./cad-inventory');
const {modelSize,sourceKey}=require('./openings');
const THREE=require('../vendor/blueprint3d/node_modules/three');
const context=vm.createContext({THREE,console:{log(){},warn(){},error(){}},$: {Callbacks(){const callbacks=[];return {add(f){callbacks.push(f);},fire(...args){callbacks.forEach(f=>f(...args));},remove(f){const i=callbacks.indexOf(f);if(i>=0)callbacks.splice(i,1);}};}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../vendor/blueprint3d/example/js/blueprint3d.js'),'utf8'),context);
function inside(p,poly){let answer=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)answer=!answer;}return answer;}
function validateNative(result,data,roles){
  roles = roles || new Map();
  const issues=[],floor=result.design.floorplan,seen=new Set();
  for(const w of floor.walls){
    const a=floor.corners[w.corner1],b=floor.corners[w.corner2],key=[w.corner1,w.corner2].sort().join(':');
    if(!a||!b||![a.x,a.y,b.x,b.y].every(Number.isFinite)||w.corner1===w.corner2)issues.push('Parede degenerada ou com coordenadas inválidas.');
    if(seen.has(key))issues.push('Parede duplicada.');seen.add(key);
  }
  if(issues.length)return {valid:false,issues};
  const model=new context.BP3D.Model.Model('models/textures/');
  require('../public/native-cad-properties').install(model);
  model.floorplan.loadFloorplan(floor);
  const represented=new Set(),openingItems=[];
  const validIds=new Set(data.instances.map(e=>e.id));
  for(const [index,item] of (result.design.items||[]).entries()){
    const prefix=`Vão ${index+1}`,evidence=item.cad_opening,kind=item.item_type===7?'door':item.item_type===3?'window':null;
    if(!kind||![item.xpos,item.ypos,item.zpos,item.rotation,item.scale_x,item.scale_y,item.scale_z].every(Number.isFinite)||[item.scale_x,item.scale_y,item.scale_z].some(n=>n<=0)){
      issues.push(`${prefix} possui tipo, posição ou escala inválida.`);continue;
    }
    if(!evidence||evidence.kind!==kind||!Array.isArray(evidence.sourceIds)||!evidence.sourceIds.length||evidence.sourceIds.some(id=>!validIds.has(id)||(roles.size > 0 && roleFor(id,roles)!==kind))){
      issues.push(`${prefix} não tem correspondência verificável com as entidades CAD.`);continue;
    }
    const a=evidence.start,b=evidence.end;
    if(!a||!b||![a.x,a.y,b.x,b.y].every(Number.isFinite)) {issues.push(`${prefix} não tem segmento CAD válido.`);continue;}
    const span=Math.hypot(b.x-a.x,b.y-a.y),size=modelSize(kind),width=size[0]*item.scale_x,height=size[1]*item.scale_y;
    if(span<10||(result.report.strategy==='ai-native'&&width>span+.5)||Math.hypot(item.xpos-(a.x+b.x)/2,item.zpos-(a.y+b.y)/2)>.5||Math.abs(width-(result.report.strategy==='ai-native'?evidence.widthCm:Math.max(10,span-2)))>.5){issues.push(`${prefix} mudou a posição ou a largura do segmento CAD.`);continue;}
    const supports=(p,q)=>{
      const dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy);
      return len>.01&&[a,b].every(v=>Math.abs((v.x-p.x)*dy-(v.y-p.y)*dx)/len<=.5&&((v.x-p.x)*dx+(v.y-p.y)*dy)/(len*len)>=-.5/len&&((v.x-p.x)*dx+(v.y-p.y)*dy)/(len*len)<=1+.5/len);
    };
    try{
      const Item=context.BP3D.Items.Factory.getClass(item.item_type);
      // Use the shipped model dimensions, then run the real native placement code.
      const native=new Item(model,{itemName:item.item_name,resizable:true},new THREE.BoxGeometry(size[0],size[1],size[2]),new THREE.MeshFaceMaterial([]),new THREE.Vector3(item.xpos,item.ypos,item.zpos),item.rotation,new THREE.Vector3(item.scale_x,item.scale_y,item.scale_z));
      native.initObject();
      const edge=native.currentWallEdge,wall=edge?.wall;
      if(!wall||!supports(wall.getStart(),wall.getEnd()))issues.push(`${prefix} não se associa à parede correta no motor original.`);
      else if(item.ypos-height/2<-.1||item.ypos+height/2>wall.height+.1)issues.push(`${prefix} ultrapassa a altura da parede original.`);
      else {evidence.sourceIds.forEach(id=>represented.add(id));openingItems.push({kind,width,point:{x:item.xpos,y:item.zpos},sourceIds:evidence.sourceIds});}
    }catch(error){issues.push(`${prefix} não pôde ser colocado no motor original: ${error.message}`);}
  }
  const expected=new Set(data.instances.filter(e=>['door','window'].includes(roleFor(e.id,roles))).map(e=>sourceKey(e.id,roles,roleFor(e.id,roles))));
  const missing=[...expected].filter(id=>!represented.has(id));
  if(missing.length)issues.push(`Portas/janelas CAD sem correspondência nativa: ${missing.slice(0,20).join(', ')}.`);
  let sourceCoverage;
  if(result.report.strategy!=='ai-native' && roles.size > 0){
  sourceCoverage=require('./source-coverage').checkSourceCoverage(result,data,roles);
  const missingStructure=sourceCoverage.uncovered.filter(s=>s.role==='wall_axis'||s.uncoveredCm>result.report.thickness*2);
  issues.push(...missingStructure.map(s=>`Estrutura CAD ${s.entityId}:${s.segmentIndex} sem cobertura em ${s.uncoveredCm.toFixed(2)} cm.`));
  sourceCoverage.unverifiedShortReturns=sourceCoverage.uncovered.filter(s=>!missingStructure.includes(s));
  }
  const rooms=model.floorplan.getRooms();
  if(!rooms.length)issues.push('O motor original não formou nenhum piso.');
  for(const [index,room] of rooms.entries()){
    const polygon=room.interiorCorners;
    const area=Math.abs(polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a.x*b.y-b.x*a.y;},0))/2;
    const geometry=room.floorPlane.geometry;
    const triangles=geometry.faces.reduce((sum,f)=>{const a=geometry.vertices[f.a],b=geometry.vertices[f.b],c=geometry.vertices[f.c];return sum+Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;},0);
    if(!Number.isFinite(area)||area<1||Math.abs(area-triangles)>Math.max(.1,area*1e-6))issues.push(`Piso ${index+1} inválido: triangulação não cobre o contorno.`);
  }
  const t=result.report.transform,anchors=[];
  for(const e of data.instances){
    const sourceText=(e.entity.text||e.entity.name||'').replace(/\\U\+([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    const independent=/^(DORMI|COZINH|W\.?C\.?$|ESTAR$|JANTAR$|QUARTO|BANHEIRO|SU[IÍ]TE)/i.test(sourceText);
    if(!e.worldPosition||(!independent&&roleFor(e.id,roles)!=='room_label'))continue;
    if(e.type==='INSERT'&&data.instances.some(child=>child.id.startsWith(e.id+'/')&&['TEXT','MTEXT'].includes(child.type)))continue;
    if(!['TEXT','MTEXT','INSERT'].includes(e.type))continue;
    const p={x:(e.worldPosition.x-t.origin.x)*t.scaleToCm,y:-(e.worldPosition.y-t.origin.y)*t.scaleToCm};
    anchors.push(e.id);
    if(!rooms.some(room=>inside(p,room.corners)))issues.push(`Ambiente ${e.id} (${sourceText.slice(0,60)}) sem piso na posição CAD.`);
  }
  return {valid:issues.length===0,issues,sourceCoverage,floorRegions:rooms.map((r,i)=>({id:'floor-'+(i+1),corners:r.corners.map(c=>({x:c.x,y:c.y}))})),rooms:rooms.length,roomAnchors:anchors.length,walls:floor.walls.length,openings:openingItems.length,openingSourceGroups:expected.size,freeEnds:result.report.openEnds,checks:['referências','coordenadas finitas','paredes sem duplicatas','vãos CAD representados e posicionados no motor original','pisos nativos triangulados','ambientes nas posições originais']};
}
module.exports={validateNative};
