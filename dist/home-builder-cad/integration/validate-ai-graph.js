// Validation only: return problems; never snap, split, join or repair AI geometry.
function validateAiGraph(floor) {
  const issues=[],entries=Object.entries(floor.corners),epsilon=.01;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),cross=(a,b)=>a.x*b.y-a.y*b.x,sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++)if(distance(entries[i][1],entries[j][1])<epsilon)issues.push(`Cantos ${entries[i][0]} e ${entries[j][0]} duplicam a mesma posição; use um ID compartilhado.`);
  const lines=floor.walls.map(w=>({w,a:floor.corners[w.corner1],b:floor.corners[w.corner2]}));
  for(let i=0;i<lines.length;i++){
    const l=lines[i],r=sub(l.b,l.a),length=distance(l.a,l.b);
    if(length<epsilon){issues.push(`Parede ${i} tem comprimento nulo.`);continue;}
    for(let j=i+1;j<lines.length;j++){
      const m=lines[j],s=sub(m.b,m.a),otherLength=distance(m.a,m.b);if(otherLength<epsilon)continue;
      const q=sub(m.a,l.a),den=cross(r,s);
      if(Math.abs(den)/(length*otherLength)<1e-8){
        if(Math.abs(cross(q,r))/length>epsilon)continue;
        const project=p=>((p.x-l.a.x)*r.x+(p.y-l.a.y)*r.y)/length;
        const lo=Math.max(0,Math.min(project(m.a),project(m.b))),hi=Math.min(length,Math.max(project(m.a),project(m.b)));
        if(hi-lo>epsilon)issues.push(`Paredes ${i} e ${j} sobrepostas.`);
      }else{
        const t=cross(q,s)/den,u=cross(q,r)/den;
        if(t < -epsilon/length || t > 1+epsilon/length || u < -epsilon/otherLength || u > 1+epsilon/otherLength)continue;
        const shared=[l.w.corner1,l.w.corner2].some(id=>id===m.w.corner1||id===m.w.corner2);
        if(!shared)issues.push(`Interseção entre paredes ${i} e ${j} sem canto compartilhado; a IA deve dividir as arestas.`);
      }
    }
  }
  return issues;
}
module.exports={validateAiGraph};
