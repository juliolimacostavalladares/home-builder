const Utils = require('../core/utils');

class HalfEdge {
  constructor(room, wall, front = true) {
    this.room = room;
    this.wall = wall;
    this.front = front;
    this.offset = wall.thickness / 2.0;
    this.height = wall.height;
    this.next = null;
    this.prev = null;

    if (this.front) {
      this.wall.frontEdge = this;
    } else {
      this.wall.backEdge = this;
    }
  }

  getStart() {
    return this.front ? this.wall.getStart() : this.wall.getEnd();
  }

  getEnd() {
    return this.front ? this.wall.getEnd() : this.wall.getStart();
  }

  /**
   * Calcula o vetor normal (perpendicular) direcionado para o interior do cômodo
   */
  interiorNormal() {
    const s = this.getStart();
    const e = this.getEnd();
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    // Rotação 90 graus para o lado interno
    return {
      x: -dy / len,
      y: dx / len
    };
  }

  interiorStart() {
    const s = this.getStart();
    const norm = this.interiorNormal();
    return {
      x: s.x + norm.x * this.offset,
      y: s.y + norm.y * this.offset
    };
  }

  interiorEnd() {
    const e = this.getEnd();
    const norm = this.interiorNormal();
    return {
      x: e.x + norm.x * this.offset,
      y: e.y + norm.y * this.offset
    };
  }

  exteriorStart() {
    const s = this.getStart();
    const norm = this.interiorNormal();
    return {
      x: s.x - norm.x * this.offset,
      y: s.y - norm.y * this.offset
    };
  }

  exteriorEnd() {
    const e = this.getEnd();
    const norm = this.interiorNormal();
    return {
      x: e.x - norm.x * this.offset,
      y: e.y - norm.y * this.offset
    };
  }
}

module.exports = HalfEdge;
