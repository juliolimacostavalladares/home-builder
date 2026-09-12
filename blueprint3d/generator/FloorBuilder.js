const THREE = require('three');

/**
 * Construtor de Pisos 3D por Cômodo com materiais e texturas arquitetônicas
 */
class FloorBuilder {
  /**
   * Constrói o piso 3D para um cômodo (Room)
   * @param {Room} room
   */
  static buildFloorMesh(room) {
    const points = room.getPolygonPoints();
    if (!points || points.length < 3) return null;

    const shape = new THREE.Shape();
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i].x, points[i].y);
    }
    shape.closePath();

    // Extrusão leve (2cm) para dar espessura de piso
    const extrudeSettings = {
      depth: 0.02,
      bevelEnabled: false
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // Rotaciona de XY para XZ (chão horizontal com Y para cima)
    geometry.rotateX(Math.PI / 2);

    // Determina o material baseado no tipo de cômodo
    const nameLower = (room.name || '').toLowerCase();
    let floorColor = 0xc8a882; // Amadeirado padrão (Quartos e Salas)
    let roughness = 0.45;

    if (/wc|banh|lavab/i.test(nameLower)) {
      floorColor = 0xdcdde1; // Porcelanato cinza acetinado claro
      roughness = 0.25;
    } else if (/cozinh|servi|lavand/i.test(nameLower)) {
      floorColor = 0xbdc3c7; // Porcelanato cinza moderno
      roughness = 0.35;
    } else if (/terra|abrig|garag|varand/i.test(nameLower)) {
      floorColor = 0xa4b0be; // Piso cimentício / pedra externa
      roughness = 0.80;
    } else if (/estar|jantar|sala/i.test(nameLower)) {
      floorColor = 0xd4b896; // Madeira clara escandinava
      roughness = 0.50;
    }

    const material = new THREE.MeshStandardMaterial({
      color: floorColor,
      roughness: roughness,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -0.01; // Ligeiramente abaixo de 0 para evitar z-fighting
    mesh.receiveShadow = true;
    mesh.name = `floor_${room.name}`;

    return mesh;
  }
}

module.exports = FloorBuilder;
