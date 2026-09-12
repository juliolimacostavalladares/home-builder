const CadToFloorplan = require('./cadToFloorplan');
const SceneBuilder = require('./generator/SceneBuilder');
const WallBuilder = require('./generator/WallBuilder');
const FloorBuilder = require('./generator/FloorBuilder');
const OpeningBuilder = require('./generator/OpeningBuilder');
const Floorplan = require('./model/Floorplan');
const config = require('./core/config');
const Utils = require('./core/utils');

class Blueprint3D {
  /**
   * Converte um arquivo CAD (DXF string ou SVG) em um modelo volumétrico 3D completo
   * @param {string} dxfString
   * @param {Object} options - { cutHeight, includeOpenings, includeFloors }
   */
  static processDxfTo3d(dxfString, options = {}) {
    const cutHeight = options.cutHeight !== undefined ? Number(options.cutHeight) : config.wallHeight;

    // 1. Gera o Floorplan arquitetônico
    const floorplan = CadToFloorplan.convertDxf(dxfString, options);

    // 2. Constrói a cena Three.js
    const { scene, houseGroup, metadata } = SceneBuilder.buildScene(floorplan, {
      cutHeight,
      includeOpenings: options.includeOpenings !== false,
      includeFloors: options.includeFloors !== false,
      includeFoundation: options.includeFoundation !== false
    });

    // 3. Serializa o Floorplan para JSON
    const floorplanJson = floorplan.toJSON();

    return {
      floorplan: floorplanJson,
      volumetrics: {
        cutHeight,
        wallHeight: config.wallHeight,
        wallThickness: config.wallThickness,
        totalRooms: floorplan.rooms.length,
        totalWalls: floorplan.walls.length,
        totalDoors: floorplan.doors.length,
        totalWindows: floorplan.windows.length,
        roomsList: floorplan.rooms.map(r => ({
          name: r.name,
          area: Number(r.area.toFixed(2)),
          floorType: r.floorType,
          center: r.getCenter(),
          polygon: r.getPolygonPoints()
        }))
      },
      metadata
    };
  }
}

module.exports = {
  Blueprint3D,
  CadToFloorplan,
  SceneBuilder,
  WallBuilder,
  FloorBuilder,
  OpeningBuilder,
  Floorplan,
  config,
  Utils
};
