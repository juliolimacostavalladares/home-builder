// Apply CAD dimensions through the original engine's public wall properties.
// No upstream source or renderer is changed. Extra JSON fields remain optional.
(function(root){
  function install(model){
    const plan=model.floorplan,load=plan.loadFloorplan,save=plan.saveFloorplan,newWall=plan.newWall;
    let incoming;
    plan.newWall=function(a,b){
      const wall=newWall.call(this,a,b);
      const properties=incoming?.find(w=>(w.corner1===a.id&&w.corner2===b.id)||(w.corner2===a.id&&w.corner1===b.id));
      if(properties?.cad){
        const p=properties.cad;
        if(p.floorBoundary===true){wall.height=0;wall.thickness=0;wall.cadFloorBoundary=true;}
        else {if(Number.isFinite(p.thicknessCm)&&p.thicknessCm>0&&p.thicknessCm<=100)wall.thickness=p.thicknessCm;if(Number.isFinite(p.heightCm)&&p.heightCm>0&&p.heightCm<=2000)wall.height=p.heightCm;}
      }
      return wall;
    };
    plan.loadFloorplan=function(data){incoming=data?.walls;try{return load.call(this,data);}finally{incoming=null;}};
    plan.saveFloorplan=function(){const data=save.call(this),walls=this.getWalls();data.walls.forEach((w,i)=>{w.cad=walls[i].cadFloorBoundary?{floorBoundary:true}:{thicknessCm:walls[i].thickness,heightCm:walls[i].height};});return data;};
  }
  if(typeof module==='object'&&module.exports)module.exports={install};else root.installNativeCadProperties=install;
})(typeof window==='undefined'?globalThis:window);
