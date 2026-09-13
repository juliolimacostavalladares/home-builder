const fs = require('fs');
const {roleFor}=require('./cad-inventory');
const path = require('path');
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const models = { door: 'closed-door28x80_baked.js', window: 'whitewindow.js' };
const sizes = {};
function sourceKey(id,roles,kind) {
  while(id.includes('/')) {const parent=id.slice(0,id.lastIndexOf('/'));if(!roles||roleFor(parent,roles)!==kind)break;id=parent;}
  return id;
}
function projection(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,length=distance(a,b),t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(length*length);
  return {t,p:{x:a.x+t*dx,y:a.y+t*dy},distance:Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)/length};
}
function modelSize(kind) {
  if (sizes[kind]) return sizes[kind];
  const data = JSON.parse(fs.readFileSync(path.join(__dirname,'../vendor/blueprint3d/example/models/js',models[kind]),'utf8'));
  const axes = [[],[],[]]; data.vertices.forEach((n,i)=>axes[i%3].push(n / (data.scale || 1)));
  return sizes[kind] = axes.map(a=>Math.max(...a)-Math.min(...a));
}

// Fill only gaps backed by a named CAD door or a parallel window drawing.
// Native InWallItem objects create the holes; no mesh generation lives here.
module.exports = function openings(floorplan, parsed, vectors, transform, thickness,roles) {
  const incident = {};
  for (const w of floorplan.walls) for (const id of [w.corner1,w.corner2]) (incident[id] ||= []).push(w);
  const ends = Object.keys(incident).filter(id=>incident[id].length===1);
  const doors = (parsed.entities || []).flatMap((e,index)=>e.type==='INSERT' && /^P\d+/i.test(e.name || '') && (!roles||roleFor('e'+index,roles)==='door')?[{sourceId:'e'+index,p:transform(e.position),width:Number(e.name.match(/^P(\d+)/i)[1])*Math.abs(e.xScale || 1), angle:-(e.rotation || 0)*Math.PI/180, sign:Math.sign(e.xScale || 1)}]:[]);
  if(roles)for(const curve of vectors.curves.filter(c=>roleFor(c.entityId,roles)==='door')){
    const p=transform(curve.center);
    if(doors.some(d=>distance(d.p,p)<thickness))continue;
    const tips=[transform(curve.point(curve.start)),transform(curve.point(curve.start+curve.span))];
    const nearest=tip=>Math.min(...floorplan.walls.map(w=>{
      const a=floorplan.corners[w.corner1],b=floorplan.corners[w.corner2],p=projection(tip,a,b);
      return p.t>=0&&p.t<=1?p.distance:Math.min(distance(tip,a),distance(tip,b));
    }));
    tips.sort((a,b)=>nearest(a)-nearest(b));const tip=tips[0];
    doors.push({sourceId:curve.entityId,p,width:distance(p,tip),angle:Math.atan2(tip.y-p.y,tip.x-p.x),sign:1});
  }
  const windowLines = vectors.lines.filter(l=>roles?roleFor(l.entityId,roles)==='window':!l.symbol).map(l=>({sourceId:l.entityId,a:transform(l.a),b:transform(l.b)}));
  const candidates=[];
  // Axis-based CAD commonly draws an uninterrupted wall behind a window or door.
  // An InWallItem makes that opening; adding a second wall would duplicate it.
  function existingWall(a,b,kind,sourceId,door) {
    const length=distance(a,b);if(length<10)return false;
    const matches=floorplan.walls.flatMap(w=>{
      const p=floorplan.corners[w.corner1],q=floorplan.corners[w.corner2],pa=projection(a,p,q),pb=projection(b,p,q);
      const wallLength=distance(p,q),parallel=Math.abs((b.x-a.x)*(q.y-p.y)-(b.y-a.y)*(q.x-p.x))/(length*wallLength);
      if(parallel>.02||Math.max(pa.distance,pb.distance)>thickness*1.5||Math.min(pa.t,pb.t)<-.001||Math.max(pa.t,pb.t)>1.001)return [];
      return [{a:w.corner1,b:w.corner2,start:pa.p,end:pb.p,length:distance(pa.p,pb.p),mid:{x:(pa.p.x+pb.p.x)/2,y:(pa.p.y+pb.p.y)/2},kind,sourceId,door,existing:true,cost:pa.distance+pb.distance}];
    }).sort((a,b)=>a.cost-b.cost);
    if(!matches.length)return false;candidates.push(matches[0]);return true;
  }
  for (const line of windowLines) {
    if(distance(line.a,line.b)<40)continue;
    if(roles&&existingWall(line.a,line.b,'window',line.sourceId))continue;
    const closest=p=>Object.keys(incident).map(id=>({id,d:distance(p,floorplan.corners[id])})).filter(v=>v.d<=thickness*1.5).sort((a,b)=>a.d-b.d)[0];
    const start=closest(line.a),end=closest(line.b);
    if(!start||!end||start.id===end.id)continue;
    if(floorplan.walls.some(w=>(w.corner1===start.id&&w.corner2===end.id)||(w.corner2===start.id&&w.corner1===end.id)))continue;
    const a=floorplan.corners[start.id],b=floorplan.corners[end.id];
    const len=distance(a,b),dx=(b.x-a.x)/len,dy=(b.y-a.y)/len;
    const intervals=[];
    for(const w of floorplan.walls){
      const p=floorplan.corners[w.corner1],q=floorplan.corners[w.corner2];
      if(Math.max(Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx),Math.abs((q.x-a.x)*dy-(q.y-a.y)*dx))>thickness*1.5)continue;
      const u=(p.x-a.x)*dx+(p.y-a.y)*dy,v=(q.x-a.x)*dx+(q.y-a.y)*dy;
      intervals.push([Math.max(0,Math.min(u,v)),Math.min(len,Math.max(u,v))]);
    }
    let covered=0,right=0;
    for(const [lo,hi] of intervals.sort((a,b)=>a[0]-b[0])){if(hi>Math.max(right,lo)){covered+=hi-Math.max(right,lo);right=hi;}}
    if(covered/len>.6)continue;
    candidates.push({a:start.id,b:end.id,length:len,mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},kind:'window',sourceId:line.sourceId});
  }

  // A door can terminate at a T/corner junction: endpoint degree and tangent
  // are not reliable evidence. Its CAD insert gives the opening direction.
  for (const door of doors) {
    const tip={x:door.p.x+Math.cos(door.angle)*door.width*door.sign,y:door.p.y+Math.sin(door.angle)*door.width*door.sign};
    if(roles&&existingWall(door.p,tip,'door',door.sourceId,door))continue;
    const nearest=p=>Object.keys(incident).map(id=>({id,d:distance(p,floorplan.corners[id])})).filter(c=>c.d<=2*thickness).sort((a,b)=>a.d-b.d);
    const starts=nearest(door.p), finishes=nearest(tip);
    const pairs=starts.flatMap(a=>finishes.filter(b=>b.id!==a.id).map(b=>({a:a.id,b:b.id,cost:a.d+b.d}))).sort((a,b)=>a.cost-b.cost);
    const pair=pairs[0]; if(!pair)continue;
    const a=floorplan.corners[pair.a],b=floorplan.corners[pair.b];
    if(floorplan.walls.some(w=>(w.corner1===pair.a&&w.corner2===pair.b)||(w.corner2===pair.a&&w.corner1===pair.b)))continue;
    candidates.push({...pair,length:distance(a,b),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},kind:'door',door,sourceId:door.sourceId});
  }
  for(let i=0;i<ends.length;i++) for(let j=i+1;j<ends.length;j++) {
    const a=floorplan.corners[ends[i]],b=floorplan.corners[ends[j]],length=distance(a,b);
    if(length<40 || length>320) continue;
    const u={x:(b.x-a.x)/length,y:(b.y-a.y)/length};
    const outward=(id,p,sign)=>{
      const w=incident[id][0],q=floorplan.corners[w.corner1===id?w.corner2:w.corner1];
      const d=distance(p,q),dx=(p.x-q.x)/d,dy=(p.y-q.y)/d;
      return (dx*u.x+dy*u.y)*sign>.99;
    };
    if(!outward(ends[i],a,1)||!outward(ends[j],b,-1)) continue;
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const door=doors.find(d=>Math.abs(d.width-length)<2*thickness+5 && Math.min(distance(d.p,a),distance(d.p,b))<2*thickness+5);
    const window=windowLines.find(l=>{
      const len=distance(l.a,l.b),m={x:(l.a.x+l.b.x)/2,y:(l.a.y+l.b.y)/2};
      return Math.abs(len-length)<2*thickness+5 && distance(m,mid)<thickness && Math.abs((l.b.x-l.a.x)*u.y-(l.b.y-l.a.y)*u.x)<1;
    });
    if(door||window) candidates.push({a:ends[i],b:ends[j],length,mid,kind:door?'door':'window',door,sourceId:door?.sourceId||window.sourceId});
  }
  const used=new Set(), usedDoors=new Set(), items=[];
  for(const gap of candidates.sort((a,b)=>a.length-b.length)) {
    const key=gap.existing?[gap.a,gap.b,gap.mid.x.toFixed(2),gap.mid.y.toFixed(2)].join(':'):[gap.a,gap.b].sort().join(':');
    if(used.has(key)||(gap.door&&usedDoors.has(gap.door))||items.some(item=>distance({x:item.xpos,y:item.zpos},gap.mid)<thickness))continue;
    used.add(key);if(gap.door)usedDoors.add(gap.door);
    if(!gap.existing)floorplan.walls.push({corner1:gap.a,corner2:gap.b});
    const size=modelSize(gap.kind),isDoor=gap.kind==='door';
    const height=isDoor?210:(gap.length<90?60:120),sill=isDoor?0:(gap.length<90?150:90);
    const start=gap.start||floorplan.corners[gap.a],end=gap.end||floorplan.corners[gap.b];
    const sourceIds=new Set(gap.sourceId?[sourceKey(gap.sourceId,roles,gap.kind)]:[]);
    if(roles&&isDoor&&gap.door)for(const curve of vectors.curves.filter(c=>roleFor(c.entityId,roles)==='door')){
      const hinge=transform(curve.center),radius=distance(hinge,transform(curve.point(curve.start)));
      if(distance(hinge,gap.door.p)<=thickness&&Math.abs(radius-gap.door.width)<=thickness)sourceIds.add(sourceKey(curve.entityId,roles,'door'));
    }
    if(roles)for(const line of vectors.lines.filter(l=>roleFor(l.entityId,roles)===gap.kind)){
      const a=transform(line.a),b=transform(line.b),pa=projection(a,start,end),pb=projection(b,start,end);
      const atOpening=Math.max(pa.distance,pb.distance)<=thickness*1.5&&Math.min(pa.t,pb.t)>=-thickness/gap.length&&Math.max(pa.t,pb.t)<=1+thickness/gap.length;
      const doorLeaf=isDoor&&gap.door&&Math.min(distance(a,gap.door.p),distance(b,gap.door.p))<=thickness&&Math.max(distance(a,gap.door.p),distance(b,gap.door.p))<=gap.door.width+thickness;
      if(atOpening||doorLeaf)sourceIds.add(sourceKey(line.entityId,roles,gap.kind));
    }
    // Exploded CAD swing arcs may have an offset centre. Trace their endpoint
    // to the already matched leaf geometry instead of inventing another door.
    if(roles&&isDoor)for(const curve of vectors.curves.filter(c=>roleFor(c.entityId,roles)==='door')){
      const points=[transform(curve.point(curve.start)),transform(curve.point(curve.start+curve.span))];
      const connected=vectors.lines.some(l=>roleFor(l.entityId,roles)==='door'&&sourceIds.has(sourceKey(l.entityId,roles,'door'))&&points.some(p=>{
        const a=transform(l.a),b=transform(l.b),hit=projection(p,a,b);return hit.distance<=.5&&hit.t>=0&&hit.t<=1;
      }));
      if(connected)sourceIds.add(sourceKey(curve.entityId,roles,'door'));
    }
    items.push({item_name:isDoor?'Porta CAD':'Janela CAD',item_type:isDoor?7:3,model_url:`models/js/${models[gap.kind]}`,xpos:gap.mid.x,ypos:sill+height/2,zpos:gap.mid.y,rotation:0,scale_x:Math.max(10,gap.length-2)/size[0],scale_y:height/size[1],scale_z:thickness/size[2],fixed:false,cad_opening:{kind:gap.kind,sourceIds:[...sourceIds],start:{...start},end:{...end}}});
  }
  return items;
};
module.exports.modelSize=modelSize;
module.exports.sourceKey=sourceKey;
