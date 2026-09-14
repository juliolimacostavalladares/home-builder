const DxfParser = require('dxf-parser');
const addOpenings = require('./openings');
const {curveAxes,arcSpan} = require('./curves');
const {inferSettings}=require('./infer-settings');
const {roleFor}=require('./cad-inventory');
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Extract CAD vectors directly: raster/SVG pixel coordinates would lose CAD units.
function extract(parsed) {
  const lines = [], curves = [], unsupported = new Set();
  let visited = 0;
  function walk(entities, transform, inherited, depth, symbol=false, prefix='e') {
    if (depth > 12) throw new Error('Blocos CAD excedem o limite de profundidade.');
    for (const [index,e] of entities.entries()) {
      const entityId=prefix+index;
      if (++visited > 50000) throw new Error('CAD excede o limite de entidades.');
      if (e.inPaperSpace || e.visible === false) continue;
      const layer = e.layer && e.layer !== '0' ? e.layer : (inherited || '0');
      if (e.type === 'INSERT') {
        const block = parsed.blocks?.[e.name];
        if (!block) continue;
        const angle = (e.rotation || 0) * Math.PI / 180;
        const base = block.position || { x: 0, y: 0 };
        const pos = e.position || { x: 0, y: 0 };
        walk(block.entities || [], p => {
          const x = (p.x - base.x) * (e.xScale ?? 1), y = (p.y - base.y) * (e.yScale ?? 1);
          return transform({ x: pos.x + x * Math.cos(angle) - y * Math.sin(angle), y: pos.y + x * Math.sin(angle) + y * Math.cos(angle) });
        }, layer, depth + 1, symbol || /^(P\d|DOOR|PORTA|WINDOW|JANELA|DORMI|COZINH|WC|ESTAR|JANTAR|AREA|VASO|LAVAT|PIA|FOG|GELAD|ND_)/i.test(e.name || ''), entityId+'/b');
      } else if (['LINE', 'LWPOLYLINE', 'POLYLINE'].includes(e.type)) {
        const v = e.vertices || [];
        const count = e.type === 'LINE' ? Math.min(1, v.length - 1) : v.length - (e.shape ? 0 : 1);
        for (let i = 0; i < count; i++) {
          if (v[i].bulge) {
            const a=v[i],b=v[(i+1)%v.length],bulge=a.bulge,chord=dist(a,b);
            const factor=(1-bulge*bulge)/(4*bulge),center={x:(a.x+b.x)/2-(b.y-a.y)*factor,y:(a.y+b.y)/2+(b.x-a.x)*factor};
            const radius=dist(center,a),start=Math.atan2(a.y-center.y,a.x-center.x),sweep=4*Math.atan(bulge);
            curves.push({entityId,layer,symbol,center:transform(center),start:0,span:Math.abs(sweep),point:t=>transform({x:center.x+radius*Math.cos(start+Math.sign(sweep)*t),y:center.y+radius*Math.sin(start+Math.sign(sweep)*t)})});
            continue;
          }
          const a = transform(v[i]), b = transform(v[(i + 1) % v.length]);
          if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) throw new Error('Coordenadas CAD inválidas.');
          if (dist(a, b) > 1e-8) lines.push({ a, b, entityId, layer, symbol: symbol || /HIDDEN|DASH|CENTER/i.test(e.lineType || '') });
        }
      } else if (e.type==='ARC' || e.type==='CIRCLE') {
        const start=e.startAngle || 0, span=e.type==='CIRCLE'?2*Math.PI:arcSpan(start,e.endAngle);
        curves.push({entityId,layer,symbol,center:transform(e.center),start,span,point:angle=>transform({x:e.center.x+e.radius*Math.cos(angle),y:e.center.y+e.radius*Math.sin(angle)})});
      } else if (['SPLINE', 'ELLIPSE'].includes(e.type)) unsupported.add(layer);
    }
  }
  walk(parsed.entities || [], p => ({ x: p.x, y: p.y }), '0', 0);
  return { lines, curves, unsupported };
}

function centerlines(lines, thickness, automatic=false, classified=false) {
  const axes = [], coverage = lines.map(()=>[]);
  // Recognize repeated hatch strokes, which may share the same CAD layer as walls.
  const groups=new Map(),grid=new Set();
  lines.forEach((l,i)=>{let angle=Math.atan2(l.b.y-l.a.y,l.b.x-l.a.x);if(angle<0)angle+=Math.PI;if(angle>=Math.PI-1e-5)angle=0;const key=angle.toFixed(3),offset=-Math.sin(angle)*l.a.x+Math.cos(angle)*l.a.y;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({i,offset});});
  for(const values of groups.values()){
    const rows=[];for(const v of values.sort((a,b)=>a.offset-b.offset)){const last=rows.at(-1);if(last&&Math.abs(last.offset-v.offset)<.1)last.ids.push(v.i);else rows.push({offset:v.offset,ids:[v.i]});}
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
      const step=rows[j].offset-rows[i].offset;if(step<thickness*2)continue;
      const run=[i,j];let target=rows[j].offset+step;
      for(let k=j+1;k<rows.length;k++){
        if(Math.abs(rows[k].offset-target)<Math.max(.1,step*.005)){run.push(k);target+=step;}
        else if(rows[k].offset>target+Math.max(.1,step*.005))break;
      }
      if(run.length>=4)for(const k of run)for(const id of rows[k].ids)grid.add(id);
    }
  }
  if(classified)grid.clear();
  // Match short wall piers as well as long faces; retain actual local thickness.

  for (let i = 0; i < lines.length; i++) {
    const { a, b } = lines[i], length = dist(a, b);
    if (length < 0.01) continue;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    for (let j = i + 1; j < lines.length; j++) {
      const other = lines[j], v = sub(other.b, other.a), ol = dist(other.a, other.b);
      if (ol < 0.01 || Math.abs(cross(u, v)) / ol > 0.005) continue;
      const offset = cross(u, sub(other.a, a));
      const matches=automatic ? Math.abs(offset)>=8 && Math.abs(offset)<=40 && !grid.has(i)&&!grid.has(j) : Math.abs(Math.abs(offset)-thickness)<=Math.max(1,thickness*.25);
      if(!matches)continue;
      const t1 = dot(sub(other.a, a), u), t2 = dot(sub(other.b, a), u);
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(length, Math.max(t1, t2));
      if (hi - lo < 0.01) continue;
      const p = t => ({ x: a.x + u.x * t - u.y * offset / 2, y: a.y + u.y * t + u.x * offset / 2 });
      axes.push({ a: p(lo), b: p(hi) });
      coverage[i].push([lo/length,hi/length]);
      const q1=p(lo),q2=p(hi),r=sub(other.b,other.a);
      const u1=dot(sub(q1,other.a),r)/dot(r,r),u2=dot(sub(q2,other.a),r)/dot(r,r);
      coverage[j].push([Math.min(u1,u2),Math.max(u1,u2)]);
      if (axes.length > 2000) throw new Error('Excesso de pares de faces. Restrinja as camadas de paredes.');
    }
  }
  for(let i=0;i<lines.length;i++){
    const line=lines[i],len=dist(line.a,line.b);let cursor=0;
    for(const [lo,hi] of [...coverage[i],[1,1]].sort((a,b)=>a[0]-b[0])){
      if((lo-cursor)*len>=thickness*2){
        const a= mix(line.a,line.b,cursor),b=mix(line.a,line.b,lo),r=sub(b,a),n=dist(a,b);
        const narrowBundle=lines.some((other,j)=>{
          if(i===j)return false;const v=sub(other.b,other.a),gap=Math.abs(cross(r,sub(other.a,a)))/n;
          if(gap<.05||gap>=thickness*.5||Math.abs(cross(r,v))/(n*dist(other.a,other.b))>.003)return false;
          const x=dot(sub(other.a,a),r)/(n*n),y=dot(sub(other.b,a),r)/(n*n);
          return Math.min(1,Math.max(x,y))-Math.max(0,Math.min(x,y))>.7;
        });
        if(!narrowBundle&&!grid.has(i))axes.push({a,b});
      }
      cursor=Math.max(cursor,hi);
    }
  }
  return axes;
}

const graph = require('./planar-graph');

function convertDxf(dxf, options = {}) {
  const parsed = new DxfParser().parseSync(dxf);
  if (!parsed?.entities) throw new Error('DXF inválido ou sem entidades.');
  const vectors = extract(parsed);
  const roles=options.roles;
  const isStructural=e=>!roles||['wall_face','wall_axis'].includes(roleFor(e.entityId,roles));
  const structural=roles?{...vectors,lines:vectors.lines.filter(isStructural),curves:vectors.curves.filter(isStructural)}:vectors;
  const requested=roles?{...options,mode:[...structural.lines,...structural.curves].some(e=>roleFor(e.entityId,roles)==='wall_face')?'faces':'axes',layers:[...new Set([...structural.lines,...structural.curves].map(e=>e.layer))]}:options;
  const settings=inferSettings(parsed,structural,requested);
  const {unit,scale:scaleToCm,layers:chosen,thickness,mode}=settings;
  if(options.inspect)return {layers:settings.available,unit,recommendedLayers:chosen,thickness,mode,unitSource:settings.unitSource};
  let lines = vectors.lines.filter(l => chosen.includes(l.layer)&&(roles?isStructural(l):!l.symbol));
  if (lines.length > 2000) throw new Error('Selecione menos camadas: máximo de 2000 segmentos de parede.');
  const points = [...lines.flatMap(l => [l.a, l.b]),...structural.curves.flatMap(c=>[c.point(c.start),c.point(c.start+c.span/2)])];
  if(!points.length)throw new Error('Nenhuma geometria estrutural suportada.');
  const cx = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2;
  const cy = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2;
  const transform = p => ({ x: (p.x - cx) * scaleToCm, y: -(p.y - cy) * scaleToCm });
  lines = lines.map(l => ({ ...l, a: transform(l.a), b: transform(l.b) }));
  const sourceSegments = lines.length;
  const direct=roles?lines.filter(l=>roleFor(l.entityId,roles)==='wall_axis'):[];
  if (mode === 'faces') lines = [...centerlines(roles?lines.filter(l=>roleFor(l.entityId,roles)==='wall_face'):lines, thickness,!options.thickness||options.thickness==='auto',!!roles),...direct];
  const transformedCurves=vectors.curves.filter(c=>chosen.includes(c.layer)&&(roles?isStructural(c):!c.symbol)).map(c=>{
    const center=transform(c.center),point=a=>transform(c.point(a)),radius=dist(center,point(c.start));
    if(roles&&[.25,.5,.75,1].some(t=>Math.abs(dist(center,point(c.start+c.span*t))-radius)>.02))throw new Error('Curva estrutural com escala não uniforme não suportada; importação bloqueada.');
    return {...c,center,point,radius};
  });
  const faceCurves=roles?transformedCurves.filter(c=>roleFor(c.entityId,roles)==='wall_face'):transformedCurves;
  const curved=curveAxes(faceCurves,thickness,.2,mode);
  if(roles){
    const axes=curveAxes(transformedCurves.filter(c=>roleFor(c.entityId,roles)==='wall_axis'),thickness,.2,'axes');
    curved.lines.push(...axes.lines);curved.approximated+=axes.approximated;
    if(curved.unmatched)throw new Error('Faces curvas sem par correspondente; importação bloqueada.');
  }
  lines.push(...curved.lines);
  if (!lines.length) throw new Error('Nenhuma parede encontrada. Confira camada, unidade, espessura e representação do CAD.');
  let floorplan = graph(lines, mode === 'faces' ? thickness : 0.6);
  const items = addOpenings(floorplan, parsed, vectors, transform, thickness,roles);
  const repaired=require('./repair-junctions')(floorplan,mode==='faces'?thickness:.05);
  floorplan=repaired.floorplan;
  if(roles){
    const boundaryLines=vectors.lines.filter(l=>roleFor(l.entityId,roles)==='floor_boundary').map(l=>({a:transform(l.a),b:transform(l.b),floorBoundary:true}));
    if(vectors.curves.some(c=>roleFor(c.entityId,roles)==='floor_boundary'))throw new Error('Borda de piso curva ainda não suportada.');
    if(boundaryLines.length){
      const structural=floorplan.walls.map(w=>({a:floorplan.corners[w.corner1],b:floorplan.corners[w.corner2]}));
      // Join CAD floor-face endpoints to native wall axes within the wall's
      // half-thickness footprint. These zero-height links never raise a wall.
      const links=[];
      for(const edge of boundaryLines)for(const p of [edge.a,edge.b]){
        let nearest;
        for(const w of structural){const r=sub(w.b,w.a),t=Math.max(0,Math.min(1,dot(sub(p,w.a),r)/dot(r,r))),q=mix(w.a,w.b,t),d=dist(p,q);if(!nearest||d<nearest.d)nearest={q,d};}
        if(nearest&&nearest.d>.5&&nearest.d<=thickness/Math.SQRT2+.5)links.push({a:p,b:nearest.q,floorBoundary:true});
      }
      floorplan=graph([...structural,...boundaryLines,...links],0);
    }
  }
  for(const wall of floorplan.walls)if(!wall.cad?.floorBoundary)wall.cad={thicknessCm:thickness};
  const warnings = [...settings.warnings];
  const floorBoundaries=floorplan.walls.filter(w=>w.cad?.floorBoundary).length;
  if(floorBoundaries)warnings.push(`${floorBoundaries} arestas de piso sem altura ligam contornos abertos ao motor original. Não representam alvenaria.`);
  if(curved.approximated)warnings.push(`${curved.approximated} paredes curvas discretizadas com erro máximo de 2 mm para o motor de paredes retas.`);
  if (chosen.some(l => vectors.unsupported.has(l))) warnings.push('Curvas nas camadas selecionadas não foram convertidas: o editor original trabalha com paredes retas.');
  if (mode === 'faces') warnings.push('Eixos inferidos por pares de faces paralelas; confira o resultado no editor 2D.');
  warnings.push(`${items.length} portas/janelas inferidas em vãos reconhecidos. Alturas padrão: portas 210 cm, janelas 120 cm (peitoril 90 cm) ou 60 cm (peitoril 150 cm). Confira posição e dimensão no editor. Móveis CAD não são importados.`);
  const degree = {};
  for (const w of floorplan.walls) for (const id of [w.corner1, w.corner2]) degree[id] = (degree[id] || 0) + 1;
  const openEnds = Object.values(degree).filter(n => n === 1).length;
  if (openEnds) warnings.push(`${openEnds} terminações livres registradas. O validador de pisos verifica separadamente se há ambientes sem cobertura.`);
  return { design: { floorplan, items }, report: { unit, unitSource:settings.unitSource,thickness,mode,floorBoundaries, junctionRepairs:repaired.changes.length, layers: chosen, sourceSegments, walls: floorplan.walls.length, openEnds, warnings, transform: { origin: { x: cx, y: cy }, scaleToCm: scaleToCm, invertY: true } } };
}
module.exports = { convertDxf };
