const graph=require('./planar-graph');
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
module.exports=function repairJunctions(floorplan,tolerance){
  const degree={};for(const w of floorplan.walls)for(const id of [w.corner1,w.corner2])degree[id]=(degree[id]||0)+1;
  const changes=[];
  for(const id of Object.keys(degree).filter(id=>degree[id]===1)){
    const p=floorplan.corners[id];let best;
    for(const w of floorplan.walls){
      if(w.corner1===id||w.corner2===id)continue;
      const a=floorplan.corners[w.corner1],b=floorplan.corners[w.corner2],dx=b.x-a.x,dy=b.y-a.y;
      const source=floorplan.walls.find(w=>w.corner1===id||w.corner2===id);
      const start=floorplan.corners[source.corner1===id?source.corner2:source.corner1];
      const rx=p.x-start.x,ry=p.y-start.y,den=rx*dy-ry*dx;
      if(Math.abs(den)<1e-8)continue;
      const ax=a.x-start.x,ay=a.y-start.y,u=(ax*ry-ay*rx)/den;
      if(u<0||u>1)continue;
      const q={x:a.x+u*dx,y:a.y+u*dy},d=distance(p,q);
      if(d<=tolerance && (!best||d<best.d))best={p:q,d};
    }
    if(best)changes.push({id,point:best.p,distance:best.d});
  }
  for(const change of changes)floorplan.corners[change.id]=change.point;
  const clean=graph(floorplan.walls.map(w=>({a:floorplan.corners[w.corner1],b:floorplan.corners[w.corner2]})),0);
  return {floorplan:clean,changes};
};
