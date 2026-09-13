// Integration boundary only. The upstream editor and engine are unchanged.
(() => {
  let instance;
  const Original = BP3D.Blueprint3d;
  BP3D.Blueprint3d = function(options) {
    instance = new Original(options);
    installNativeCadProperties(instance.model);
    BP3D.Core.Configuration.setValue(BP3D.Core.configDimUnit, BP3D.Core.dimCentiMeter);
    return instance;
  };
  BP3D.Blueprint3d.prototype = Original.prototype;
  window.homeBuilderBridge = {
    load(design) {
      if (!instance) throw new Error('Editor ainda não está pronto.');
      instance.model.loadSerialized(JSON.stringify(design));
      instance.three.centerCamera();
      document.querySelector('#floorplan_tab a').click();
      instance.floorplanner.reset();
      return { walls: instance.model.floorplan.getWalls().filter(w=>!w.cadFloorBoundary).length, floorBoundaries: instance.model.floorplan.getWalls().filter(w=>w.cadFloorBoundary).length, rooms: instance.model.floorplan.getRooms().length };
    },
    showView(view) {
      if (!instance) throw new Error('Editor ainda não está pronto.');
      document.querySelector(view === '3d' ? '#design_tab a' : '#floorplan_tab a').click();
      window.dispatchEvent(new Event('resize'));
      if (view === '3d') instance.three.centerCamera();
      else instance.floorplanner.reset();
    },
    save() { return instance.model.exportSerialized(); },
    get ready() { return !!instance; }
  };
})();
