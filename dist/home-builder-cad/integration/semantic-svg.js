const {roleFor}=require('./cad-inventory');
const categories=require('./contracts/cad-blueprint3d-v2.json').categories;
const COLORS={...Object.fromEntries(Object.entries(categories).map(([role,v])=>[role,v.color])),floor:'#dc2626'};
const LABELS={...Object.fromEntries(Object.entries(categories).map(([role,v])=>[role,v.label])),floor:'Piso derivado do contorno'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const num=value=>Number.isFinite(value)?Number(value.toFixed(7)):0;
function geometry(entity){
  const e=entity;
  if(e.type==='LINE'){if(!e.vertices?.[1])return '';const [a,b]=e.vertices;return `<path d="M${num(a.x)},${num(a.y)} L${num(b.x)},${num(b.y)}"/>`;}
  if(['LWPOLYLINE','POLYLINE'].includes(e.type)&&e.vertices?.length){
    const v=e.vertices;let d=`M${num(v[0].x)},${num(v[0].y)}`;
    for(let i=0;i<v.length-(e.shape?0:1);i++){const a=v[i],b=v[(i+1)%v.length];if(a.bulge){const chord=Math.hypot(b.x-a.x,b.y-a.y),radius=chord*(1+a.bulge*a.bulge)/(4*Math.abs(a.bulge));d+=` A${num(radius)},${num(radius)} 0 ${Math.abs(a.bulge)>1?1:0} ${a.bulge>0?1:0} ${num(b.x)},${num(b.y)}`;}else d+=` L${num(b.x)},${num(b.y)}`;}
    return `<path d="${d}${e.shape?' Z':''}"/>`;
  }
  if(e.type==='CIRCLE')return `<circle cx="${num(e.center.x)}" cy="${num(e.center.y)}" r="${num(e.radius)}"/>`;
  if(e.type==='ARC'){
    const a=e.startAngle,b=e.endAngle,span=((b-a)%(2*Math.PI)+2*Math.PI)%(2*Math.PI),p=t=>`${num(e.center.x+e.radius*Math.cos(t))},${num(e.center.y+e.radius*Math.sin(t))}`;
    return `<path d="M${p(a)} A${num(e.radius)},${num(e.radius)} 0 ${span>Math.PI?1:0} 1 ${p(b)}"/>`;
  }
  if(['TEXT','MTEXT','ATTRIB','ATTDEF'].includes(e.type)){
    const p=e.startPoint||e.position;if(!p)return '';
    const text=(e.text||'').replace(/\\U\+([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\P/g,' ').replace(/\\[a-zA-Z][^;]*;/g,'').replace(/[{}]/g,'');
    return `<text stroke="none" fill="currentColor" font-size="${num(e.textHeight||e.height||.15)}" transform="translate(${num(p.x)} ${num(p.y)}) rotate(${num(e.rotation||0)}) scale(1 -1)">${esc(text)}</text>`;
  }
  return '';
}
function renderSemanticSvg(data,roles,{floorRegions=[],transform}={}){
  const palette=['#15803d','#7e22ce','#92400e','#0369a1','#b91c1c','#0f766e','#64748b'];
  const layers=[...new Set(data.instances.map(e=>e.layer))].sort(),layerColors=new Map(layers.map((l,i)=>[l,palette[i%palette.length]]));
  const points=data.instances.flatMap(e=>e.worldVertices||[e.worldPosition].filter(Boolean));
  // Headers include extents of arcs/blocks not represented by vertex lists.
  const header=data.source.header||{};for(const p of [header.$EXTMIN,header.$EXTMAX])if(p)points.push(p);
  const finite=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!finite.length)throw new Error('CAD sem extensão vetorial.');
  const minX=Math.min(...finite.map(p=>p.x)),maxX=Math.max(...finite.map(p=>p.x)),minY=Math.min(...finite.map(p=>p.y)),maxY=Math.max(...finite.map(p=>p.y));
  const scale=Math.min(1020/Math.max(maxX-minX,.001),860/Math.max(maxY-minY,.001));
  const tx=35-minX*scale,ty=60+maxY*scale;
  const rendered=[],missing=[];let body='';
  for(const instance of data.instances){
    if(instance.entity.inPaperSpace||instance.entity.visible===false)continue;
    const shape=geometry(instance.entity);if(!shape){if(instance.type!=='INSERT')missing.push(instance.id);continue;}
    const role=roles?roleFor(instance.id,roles):'raw-layer',color=roles?COLORS[role]:layerColors.get(instance.layer);
    const title=`${instance.id} · ${LABELS[role]||'Camada '+instance.layer} · ${instance.type} · handle ${instance.handle||'—'}`;
    body+=`<g data-entity-id="${esc(instance.id)}" data-role="${esc(role)}" data-layer="${esc(instance.layer)}" transform="matrix(${instance.matrix.map(num).join(' ')})" stroke="${color}" color="${color}"><title>${esc(title)}</title>${shape}</g>`;rendered.push(instance.id);
  }
  let floors='';
  if(roles&&transform)for(const region of floorRegions){const pts=region.corners.map(p=>`${num(p.x/transform.scaleToCm+transform.origin.x)},${num(-p.y/transform.scaleToCm+transform.origin.y)}`).join(' ');floors+=`<polygon data-floor-id="${esc(region.id)}" data-role="floor" points="${pts}" fill="${COLORS.floor}" fill-opacity=".08" stroke="${COLORS.floor}" stroke-dasharray="${2/scale} ${2/scale}"><title>${esc(region.id)} · piso derivado das paredes validadas</title></polygon>`;}
  const legend=roles?Object.entries(LABELS):layers.map(l=>['layer:'+l,'Camada CAD: '+l]);
  let keys='';legend.forEach(([key,label],i)=>{const color=roles?COLORS[key]:layerColors.get(key.slice(6));keys+=`<rect x="1100" y="${90+i*35}" width="18" height="12" fill="${color}"/><text x="1127" y="${101+i*35}" font-size="14" fill="#1e293b">${esc(label)}</text>`;});
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1430 ${Math.max(970,150+legend.length*35)}" role="img" aria-label="${roles?'Classificação semântica CAD':'Camadas originais do CAD'}"><style>g[data-entity-id]{cursor:crosshair}g[data-entity-id]:hover{stroke:#f59e0b;stroke-width:${3/scale}}text{font-family:Arial,sans-serif}</style><rect width="100%" height="100%" fill="white"/><text x="30" y="28" fill="#0f172a" font-size="20">${roles?'Entidades classificadas pela IA — geometria CAD preservada':'Camadas CAD originais — sem classificação semântica'}</text><g transform="matrix(${scale} 0 0 ${-scale} ${tx} ${ty})" fill="none" stroke-width="${1.2/scale}">${floors}${body}</g><text x="1100" y="60" font-size="17" fill="#0f172a">Legenda</text>${keys}<text x="30" y="950" fill="#475569" font-size="13">IDs vinculados ao inventário técnico. Elementos não representados nesta vista: ${missing.length}; preservados no inventário e SVG original.</text></svg>`,rendered,missing,colors:COLORS,labels:LABELS};
}
module.exports={renderSemanticSvg,COLORS,LABELS};
