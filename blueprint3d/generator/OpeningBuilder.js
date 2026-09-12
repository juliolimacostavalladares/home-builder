const THREE = require('three');
const config = require('../core/config');

/**
 * Construtor de esquadrias 3D (Portas e Janelas)
 */
class OpeningBuilder {
  /**
   * Constrói uma porta 3D (batente + folha semi-aberta)
   */
  static buildDoor(door, wall) {
    const width = door.width || config.doorWidth;
    const height = door.height || config.doorHeight;
    const thickness = wall.thickness || config.wallThickness;
    const posAlongWall = door.positionAlongWall || (wall.length() - width) / 2;

    const group = new THREE.Group();

    // 1. Batente da porta (marco)
    const frameGeo = new THREE.BoxGeometry(width, height, thickness * 1.05);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x8c6239, // Madeira nobre
      roughness: 0.6
    });

    // 2. Folha da porta (aberta a ~35 graus)
    const doorLeafGeo = new THREE.BoxGeometry(width * 0.96, height * 0.98, 0.035);
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0xa87948,
      roughness: 0.5
    });
    const leaf = new THREE.Mesh(doorLeafGeo, leafMat);
    leaf.position.set(-width * 0.45, 0, width * 0.25);
    leaf.rotation.y = Math.PI / 5; // semi-aberta

    group.add(leaf);
    group.position.set(posAlongWall + width / 2, height / 2, 0);

    return group;
  }

  /**
   * Constrói uma janela 3D (esquadria de alumínio + vidro translúcido)
   */
  static buildWindow(win, wall) {
    const width = win.width || config.windowWidth;
    const height = win.height || config.windowHeight;
    const sill = win.sill !== undefined ? win.sill : config.windowSill;
    const thickness = wall.thickness || config.wallThickness;
    const posAlongWall = win.positionAlongWall || (wall.length() - width) / 2;

    const group = new THREE.Group();

    // 1. Esquadria de alumínio (preto acetinado contemporâneo)
    const frameGeo = new THREE.BoxGeometry(width, height, thickness * 0.8);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.3,
      metalness: 0.8
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);

    // 2. Vidro translúcido (azul claro / transparente)
    const glassGeo = new THREE.BoxGeometry(width * 0.92, height * 0.92, 0.015);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x88bbdd,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1,
      transmission: 0.9,
      thickness: 0.02
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);

    group.add(frame);
    group.add(glass);
    group.position.set(posAlongWall + width / 2, sill + height / 2, 0);

    return group;
  }
}

module.exports = OpeningBuilder;
