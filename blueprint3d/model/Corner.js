const Utils = require('../core/utils');

class Corner {
  constructor(floorplan, x, y, id = null) {
    this.floorplan = floorplan;
    this.x = Number(x);
    this.y = Number(y);
    this.id = id || Utils.guid();
    this.wallStarts = [];
    this.wallEnds = [];
  }

  attachStart(wall) {
    this.wallStarts.push(wall);
  }

  attachEnd(wall) {
    this.wallEnds.push(wall);
  }

  detachWall(wall) {
    this.wallStarts = this.wallStarts.filter(w => w !== wall);
    this.wallEnds = this.wallEnds.filter(w => w !== wall);
  }

  adjacentCorners() {
    const corners = [];
    for (const w of this.wallStarts) {
      if (w.getEnd() && w.getEnd() !== this) corners.push(w.getEnd());
    }
    for (const w of this.wallEnds) {
      if (w.getStart() && w.getStart() !== this) corners.push(w.getStart());
    }
    return corners;
  }

  distanceFrom(x, y) {
    return Utils.distance(this.x, this.y, x, y);
  }
}

module.exports = Corner;
