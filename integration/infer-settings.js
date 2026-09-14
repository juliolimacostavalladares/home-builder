const units={mm:.1,cm:1,m:100,in:2.54,ft:30.48};
const insunits={1:'in',2:'ft',4:'mm',5:'cm',6:'m'};
const length=l=>Math.hypot(l.b.x-l.a.x,l.b.y-l.a.y);
function pairs(lines){
  const found=[];
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const a=lines[i],b=lines[j],len=length(a),other=length(b);if(!len||!other)continue;
    const ux=(a.b.x-a.a.x)/len,uy=(a.b.y-a.a.y)/len;
    if(Math.abs(ux*(b.b.y-b.a.y)-uy*(b.b.x-b.a.x))/other>.003)continue;
    const gap=Math.abs(ux*(b.a.y-a.a.y)-uy*(b.a.x-a.a.x));if(gap<1e-8)continue;
    const t1=(b.a.x-a.a.x)*ux+(b.a.y-a.a.y)*uy,t2=(b.b.x-a.a.x)*ux+(b.b.y-a.a.y)*uy;
    const overlap=Math.min(len,Math.max(t1,t2))-Math.max(0,Math.min(t1,t2));
    if(overlap>gap*2)found.push({gap,overlap});
  }
  return found;
}
function inferSettings(parsed,vectors,options){
  const warnings=[];
  const available=[...new Set([...vectors.lines,...vectors.curves].map(l=>l.layer))].sort();
  let layers=options.layers?.length?options.layers:available.filter(l=>/parede|wall|alvenaria/i.test(l));
  if(!layers.length){
    const weights=new Map();for(const l of vectors.lines.filter(l=>!l.symbol))weights.set(l.layer,(weights.get(l.layer)||0)+length(l));
    const ranked=[...weights].sort((a,b)=>b[1]-a[1]);if(ranked.length)layers=[ranked[0][0]];
    warnings.push('Camada estrutural inferida pela geometria predominante.');
  }
  if(!layers.length||layers.some(l=>!available.includes(l)))throw new Error('CAD sem camada estrutural identificável.');
  const lines=vectors.lines.filter(l=>layers.includes(l.layer)&&(options.roles||!l.symbol));
  if(lines.length>2000)throw new Error('CAD excede 2000 segmentos estruturais por conversão.');
  const candidates=pairs(lines);
  let unit=options.unit&&options.unit!=='auto'?options.unit:insunits[parsed.header?.$INSUNITS];
  let unitSource=unit?'header-or-override':null;
  if(!unit){
    // P80 is an 80 cm door; its block's local X span supplies independent scale evidence.
    const votes=[];
    for(const e of parsed.entities||[]){
      const name=e.type==='INSERT'&&(e.name||'').match(/^P(\d+)(?:[DE]\d+)?$/i),block=parsed.blocks?.[e.name];
      if(!name||!block)continue;
      const xs=block.entities.flatMap(e=>e.vertices||[]).map(v=>v.x);
      if(!xs.length)continue;const width=(Math.max(...xs)-Math.min(...xs))*Math.abs(e.xScale??1);
      for(const [key,scale] of Object.entries(units))if(Math.abs(width*scale-Number(name[1]))<2)votes.push(key);
    }
    if(votes.length&&new Set(votes).size===1){unit=votes[0];unitSource='door-block-dimensions';}
  }
  if(!unit){
    const scores=Object.entries(units).map(([unit,scale])=>({unit,score:candidates.reduce((sum,p)=>{const t=p.gap*scale;return sum+(t>=8&&t<=40?p.overlap/p.gap:0);},0)})).sort((a,b)=>b.score-a.score);
    if(scores[0].score>0&&scores[0].score>scores[1].score*1.5){unit=scores[0].unit;unitSource='wall-spacing';warnings.push('Escala inferida pelas espessuras de parede; o CAD não declara unidade.');}
  }
  if(!Object.hasOwn(units,unit))throw new Error('CAD sem unidade física inequívoca. É necessário um arquivo com unidade declarada ou referência dimensional; coordenadas isoladas não determinam a escala.');
  const scale=units[unit];
  const bins=new Map();for(const pair of candidates){const width=pair.gap*scale;if(width>=5&&width<=60){const bin=Math.round(width*2)/2;bins.set(bin,(bins.get(bin)||0)+pair.overlap/pair.gap);}}
  const ranked=[...bins].sort((a,b)=>b[1]-a[1]);
  const thickness=options.thickness&&options.thickness!=='auto'?Number(options.thickness):(ranked[0]?.[0]||15);
  if(!Number.isFinite(thickness)||thickness<5||thickness>100)throw new Error('Espessura deve estar entre 5 e 100 cm.');
  const mode=options.mode&&options.mode!=='auto'?options.mode:(ranked.length?'faces':'axes');
  if(!['faces','axes'].includes(mode))throw new Error('Representação de paredes inválida.');
  return {unit,unitSource,layers,thickness,mode,warnings,scale,available};
}
module.exports={inferSettings};
