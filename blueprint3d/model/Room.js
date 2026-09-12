const Utils = require('../core/utils');

class Room {
  constructor(floorplan, corners = [], name = 'Cômodo', floorType = 'hardwood') {
    this.floorplan = floorplan;
    this.corners = corners; // Array de Corners ordenados
    this.name = name;
    this.floorType = floorType;
    this.id = this.getUuid();
    this.area = this.calculateArea();
  }

  getUuid() {
    const ids = this.corners.map(c => c.id).sort();
    return ids.join('_');
  }

  calculateArea() {
    const pts = this.corners.map(c => ({ x: c.x, y: c.y }));
    return Utils.polygonArea(pts);
  }

  getCenter() {
    let sx = 0, sy = 0;
    this.corners.forEach(c => { sx += c.x; sy += c.y; });
    return {
      x: sx / (this.corners.length || 1),
      y: sy / (this.corners.length || 1)
    };
  }

  /**
   * Retorna os pontos do polígono do piso para Three.js Shape
   */
  getPolygonPoints() {
    return this.corners.map(c => ({ x: c.x, y: c.y }));
  }
}

module.exports = Room;
