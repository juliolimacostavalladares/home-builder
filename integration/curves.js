const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const TAU=2*Math.PI;
// Error is bounded by the sagitta in centimetres; the native engine has only
// straight walls. Pair curves before tessellating, so both faces share vertices.
function curveAxes(curves,thickness,tolerance=.2,mode='faces'){
  const lines=[],used=new Set();let approximated=0;
  for(let i=0;i<curves.length;i++){
    if(used.has(i))continue;
    const a=curves[i];let other;
    if(mode==='faces'){
      other=curves.find((b,j)=>j>i&&!used.has(j)&&distance(a.center,b.center)<.02&&Math.abs(a.start-b.start)<1e-5&&Math.abs(a.span-b.span)<1e-5&&Math.abs(Math.abs(a.radius-b.radius)-thickness)<thickness*.3);
      if(!other)continue;
      used.add(curves.indexOf(other));
    }
    const radius=Math.max(a.radius,other?.radius||0);
    const step=2*Math.acos(Math.max(-1,Math.min(1,1-tolerance/radius)));
    const count=Math.max(1,Math.ceil(a.span/Math.min(Math.PI/8,step)));
    if(count>1000)throw new Error('Curva excede o limite de discretização.');
    const point=t=>{
      const p=a.point(a.start+a.span*t);if(!other)return p;
      const q=other.point(other.start+other.span*t);return {x:(p.x+q.x)/2,y:(p.y+q.y)/2};
    };
    for(let k=0;k<count;k++)lines.push({a:point(k/count),b:point((k+1)/count)});
    approximated++;used.add(i);
  }
  return {lines,approximated,unmatched:curves.length-used.size,tolerance};
}
function arcSpan(start,end){const d=(end-start)%TAU;return d>1e-10?d:d+TAU;}
module.exports={curveAxes,arcSpan};
