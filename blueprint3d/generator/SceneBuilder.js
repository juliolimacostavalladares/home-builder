const THREE = require('three');
const WallBuilder = require('./WallBuilder');
const FloorBuilder = require('./FloorBuilder');
const OpeningBuilder = require('./OpeningBuilder');
const config = require('../core/config');

/**
 * Constrói a cena Three.js volumétrica completa da residência a partir do Floorplan
 */
class SceneBuilder {
  /**
   * Constrói uma cena 3D completa com paredes, pisos, esquadrias e iluminação
   * @param {Floorplan} floorplan
   * @param {Object} options - { cutHeight, includeOpenings, includeFloors, includeFoundation }
   */
  static buildScene(floorplan, options = {}) {
    const cutHeight = options.cutHeight || config.wallHeight;
    const includeOpenings = options.includeOpenings !== false;
    const includeFloors = options.includeFloors !== false;
    const includeFoundation = options.includeFoundation !== false;

    const scene = new THREE.Scene();
    scene.name = 'ResidenceScene3D';

    const houseGroup = new THREE.Group();
    houseGroup.name = 'HouseStructure';

    // 1. Constrói as Paredes com Vãos
    const wallsGroup = new THREE.Group();
    wallsGroup.name = 'Walls';

    floorplan.walls.forEach(wall => {
      const wallMesh = WallBuilder.buildWallMesh(wall, cutHeight);
      if (wallMesh) {
        wallsGroup.add(wallMesh);

        // Se habilitado e se o corte for alto o suficiente, adiciona as esquadrias
        if (includeOpenings && cutHeight >= 1.20 && wall.items) {
          wall.items.forEach(item => {
            let openingObj = null;
            if (item.type === 'door' && cutHeight >= (item.height || config.doorHeight) * 0.7) {
              openingObj = OpeningBuilder.buildDoor(item, wall);
            } else if (item.type === 'window' && cutHeight >= ((item.sill || config.windowSill) + (item.height || config.windowHeight) * 0.5)) {
              openingObj = OpeningBuilder.buildWindow(item, wall);
            }

            if (openingObj) {
              // Posiciona relativo à parede
              openingObj.position.add(new THREE.Vector3(wall.start.x, 0, wall.start.y));
              openingObj.rotation.y = -wall.angle();
              wallsGroup.add(openingObj);
            }
          });
        }
      }
    });
    houseGroup.add(wallsGroup);

    // 2. Constrói os Pisos por Cômodo
    if (includeFloors) {
      const floorsGroup = new THREE.Group();
      floorsGroup.name = 'Floors';

      floorplan.rooms.forEach(room => {
        const floorMesh = FloorBuilder.buildFloorMesh(room);
        if (floorMesh) {
          floorsGroup.add(floorMesh);
        }
      });
      houseGroup.add(floorsGroup);
    }

    // 3. Placa de Fundação / Solo
    if (includeFoundation) {
      // Calcula o bounding box dos corners
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      floorplan.corners.forEach(c => {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      });

      if (isFinite(minX)) {
        const pad = 2.0; // 2 metros de calçada ao redor
        const width = (maxX - minX) + pad * 2;
        const length = (maxY - minY) + pad * 2;
        const centerX = (minX + maxX) / 2;
        const centerZ = (minY + maxY) / 2;

        const groundGeo = new THREE.BoxGeometry(width, 0.15, length);
        const groundMat = new THREE.MeshStandardMaterial({
          color: 0xe0e0e4,
          roughness: 0.9,
          metalness: 0.05
        });
        const groundMesh = new THREE.Mesh(groundGeo, groundMat);
        groundMesh.position.set(centerX, -0.08, centerZ);
        groundMesh.receiveShadow = true;
        groundMesh.name = 'FoundationSlab';
        houseGroup.add(groundMesh);
      }
    }

    scene.add(houseGroup);

    // 4. Iluminação Arquitetônica Profissional
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.45);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff8ee, 1.2);
    sunLight.position.set(15, 25, 20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    scene.add(sunLight);

    let meshesCount = 0;
    scene.traverse(obj => {
      if (obj.isMesh) meshesCount++;
    });

    return {
      scene,
      houseGroup,
      metadata: {
        wallsCount: floorplan.walls.length,
        roomsCount: floorplan.rooms.length,
        doorsCount: floorplan.doors.length,
        windowsCount: floorplan.windows.length,
        meshesCount,
        cutHeight
      }
    };
  }
}

module.exports = SceneBuilder;
