const config = require('../core/config');
const Utils = require('../core/utils');

class Wall {
  constructor(start, end, thickness = config.wallThickness, height = config.wallHeight) {
    this.start = start;
    this.end = end;
    this.id = this.getUuid();
    this.thickness = Number(thickness) || config.wallThickness;
    this.height = Number(height) || config.wallHeight;
    this.items = []; // Portas e janelas nesta parede
    this.frontEdge = null;
    this.backEdge = null;

    if (this.start) this.start.attachStart(this);
    if (this.end) this.end.attachEnd(this);
  }

  getUuid() {
    return [this.start?.id, this.end?.id].join('_');
  }

  getStart() {
    return this.start;
  }

  getEnd() {
    return this.end;
  }

  length() {
    return Utils.distance(this.start.x, this.start.y, this.end.x, this.end.y);
  }

  angle() {
    return Math.atan2(this.end.y - this.start.y, this.end.x - this.start.x);
  }

  midpoint() {
    return {
      x: (this.start.x + this.end.x) / 2,
      y: (this.start.y + this.end.y) / 2
    };
  }

  /**
   * Adiciona uma abertura (porta ou janela) na parede
   * @param {Object} item - { type: 'door'|'window', positionAlongWall, width, height, sill, lintel }
   */
  addItem(item) {
    this.items.push(item);
  }

  distanceFrom(x, y) {
    return Utils.pointDistanceFromLine(x, y, this.start.x, this.start.y, this.end.x, this.end.y);
  }
}

module.exports = Wall;
