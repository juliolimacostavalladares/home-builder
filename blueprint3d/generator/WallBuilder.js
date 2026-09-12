const THREE = require('three');
const config = require('../core/config');

/**
 * Construtor de Geometria 3D Volumétrica de Paredes com Vãos de Portas e Janelas
 * Adaptado e modernizado do Blueprint3D Three.Edge para Three.js BufferGeometry
 */
class WallBuilder {
  /**
   * Constrói uma parede sólida 3D com abertura precisa de portas e janelas
   * @param {Wall} wall - Instância de Wall
   * @param {number} cutHeight - Altura de corte (ex: 1.30m para planta baixa 3D ou 2.80m para parede cheia)
   */
  static buildWallMesh(wall, cutHeight = config.wallHeight) {
    const start = wall.getStart();
    const end = wall.getEnd();
    const length = wall.length();
    if (length < 0.05) return null;

    const angle = wall.angle();
    const thickness = wall.thickness;
    const height = Math.min(wall.height, cutHeight);

    // Se for soleira/vão de porta
    if (wall.isDoorwayThreshold) {
      // Abaixo da altura da porta (2.10m), o vão fica completamente livre
      if (height <= config.doorHeight) return null;

      // Acima de 2.10m, renderiza a verga (lintel) de fechamento
      const lintelHeight = height - config.doorHeight;
      const lintelGeo = new THREE.BoxGeometry(length, lintelHeight, thickness);
      const wallMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5f7,
        roughness: 0.65,
        metalness: 0.05,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(lintelGeo, wallMaterial);
      mesh.position.set(start.x + (end.x - start.x) / 2, config.doorHeight + lintelHeight / 2, start.y + (end.y - start.y) / 2);
      mesh.rotation.y = -angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    // Cria a forma 2D da elevação da parede (X = 0 até length, Y = 0 até height)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.lineTo(length, height);
    shape.lineTo(0, height);
    shape.closePath();

    // Adiciona as aberturas (furos) de portas e janelas que intersectam a altura atual
    if (wall.items && wall.items.length > 0) {
      wall.items.forEach(item => {
        const itemWidth = item.width || (item.type === 'door' ? config.doorWidth : config.windowWidth);
        const itemHeight = item.height || (item.type === 'door' ? config.doorHeight : config.windowHeight);
        const itemSill = item.sill !== undefined ? item.sill : (item.type === 'door' ? config.doorSill : config.windowSill);

        // Se a abertura começa acima da altura do corte, não afeta a geometria cortada
        if (itemSill >= height) return;

        // Posição ao longo do comprimento da parede
        const posAlongWall = Math.max(0, Math.min(length - itemWidth, item.positionAlongWall || (length - itemWidth) / 2));
        const effectiveHeight = Math.min(itemSill + itemHeight, height);

        if (effectiveHeight > itemSill) {
          const hole = new THREE.Path();
          hole.moveTo(posAlongWall, itemSill);
          hole.lineTo(posAlongWall + itemWidth, itemSill);
          hole.lineTo(posAlongWall + itemWidth, effectiveHeight);
          hole.lineTo(posAlongWall, effectiveHeight);
          hole.closePath();
          shape.holes.push(hole);
        }
      });
    }

    // Extrusão da parede na espessura (depth = thickness)
    const extrudeSettings = {
      depth: thickness,
      bevelEnabled: false
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // Ajusta o ponto de ancoragem para centralizar na espessura
    geometry.translate(0, 0, -thickness / 2);

    // Cria o Mesh com material arquitetônico acetinado
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f5f7,
      roughness: 0.65,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, wallMaterial);

    // Posiciona e rotaciona a parede no espaço 3D (X e Z na planta, Y para cima)
    // Em Three.js padrão: Y é altura, X e Z são as coordenadas horizontais
    mesh.position.set(start.x, 0, start.y);
    mesh.rotation.y = -angle; // Rotação no plano horizontal

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }
}

module.exports = WallBuilder;
