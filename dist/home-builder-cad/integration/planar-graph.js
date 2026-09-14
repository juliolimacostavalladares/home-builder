const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const at=(l,t)=>({x:l.a.x+(l.b.x-l.a.x)*t,y:l.a.y+(l.b.y-l.a.y)*t});
const EPS=.5; // Merge sub-5 mm drafting noise, never whole wall-thickness gaps.
function intersection(l,m){
  const r=sub(l.b,l.a),s=sub(m.b,m.a),q=sub(m.a,l.a),den=cross(r,s);
  if(Math.abs(den)<1e-8)return null;
  const t=cross(q,s)/den,u=cross(q,r)/den;
  return {t,u,p:at(l,t)};
}
module.exports=function planarGraph(input,tolerance){
  let lines=input.filter(l=>length(l.a,l.b)>EPS).map(l=>({...l,a:{...l.a},b:{...l.b}}));
  // Consolidate overlapping collinear vectors before constructing intersections.
  for(let i=0;i<lines.length;i++) for(let j=i+1;j<lines.length;j++) {
    if(!!lines[i].floorBoundary!==!!lines[j].floorBoundary)continue;
    const l=lines[i],m=lines[j],r=sub(l.b,l.a),s=sub(m.b,m.a),len=length(l.a,l.b);
    if(Math.abs(cross(r,s))/(len*length(m.a,m.b))>1e-5 || Math.abs(cross(sub(m.a,l.a),r))/len>EPS)continue;
    const a=dot(sub(m.a,l.a),r)/dot(r,r),b=dot(sub(m.b,l.a),r)/dot(r,r);
    const lo=Math.min(a,b),hi=Math.max(a,b);
    if(lo>1+EPS/len || hi< -EPS/len)continue;
    lines[i]={...l,a:at(l,Math.min(0,lo)),b:at(l,Math.max(1,hi))};lines.splice(j--,1);
  }
  const candidates=lines.map(l=>[[{p:l.a,d:Infinity}],[{p:l.b,d:Infinity}]]);
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++) {
    const l=lines[i],m=lines[j],hit=intersection(l,m);if(!hit)continue;
    const ti=tolerance/length(l.a,l.b),tj=tolerance/length(m.a,m.b);
    if(hit.t < -ti || hit.t > 1+ti || hit.u < -tj || hit.u > 1+tj)continue;
    for(const [idx,line] of [[i,l],[j,m]])for(const [k,p] of [[0,line.a],[1,line.b]]){
      const d=length(p,hit.p);if(d<=tolerance+EPS)candidates[idx][k].push({p:hit.p,d});
    }
  }
  lines=lines.map((l,i)=>({...l,a:candidates[i][0].sort((a,b)=>a.d-b.d)[0].p,b:candidates[i][1].sort((a,b)=>a.d-b.d)[0].p})).filter(l=>length(l.a,l.b)>EPS);
  const cuts=lines.map(()=>[0,1]);
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const l=lines[i],m=lines[j],hit=intersection(l,m);
    if(hit){
      if(hit.t>=-1e-7&&hit.t<=1+1e-7&&hit.u>=-1e-7&&hit.u<=1+1e-7){cuts[i].push(Math.max(0,Math.min(1,hit.t)));cuts[j].push(Math.max(0,Math.min(1,hit.u)));}
    }else{
      for(const [idx,line,other] of [[i,l,m],[j,m,l]]){
        const r=sub(line.b,line.a),len=length(line.a,line.b);
        if(Math.abs(cross(sub(other.a,line.a),r))/len>EPS)continue;
        for(const p of [other.a,other.b]){const t=dot(sub(p,line.a),r)/dot(r,r);if(t>0&&t<1)cuts[idx].push(t);}
      }
    }
  }
  const corners={},walls=[],seen=new Set();
  function corner(p){
    const id=Object.keys(corners).find(id=>length(corners[id],p)<EPS);
    if(id)return id;
    const key=`cad-${Object.keys(corners).length+1}`;corners[key]={x:+p.x.toFixed(5),y:+p.y.toFixed(5)};return key;
  }
  lines.forEach((l,i)=>{
    const ts=cuts[i].sort((a,b)=>a-b);
    for(let k=1;k<ts.length;k++){
      const a=at(l,ts[k-1]),b=at(l,ts[k]);if(length(a,b)<EPS)continue;
      const corner1=corner(a),corner2=corner(b),key=[corner1,corner2].sort().join(':');
      if(corner1===corner2||seen.has(key))continue;seen.add(key);walls.push({corner1,corner2,...(l.floorBoundary?{cad:{floorBoundary:true}}:{})});
    }
  });
  return {corners,walls,wallTextures:[],floorTextures:{},newFloorTextures:{}};
};
