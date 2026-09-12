const Corner = require('./Corner');
const Wall = require('./Wall');
const Room = require('./Room');
const Utils = require('../core/utils');
const config = require('../core/config');

class Floorplan {
  constructor() {
    this.corners = [];
    this.walls = [];
    this.rooms = [];
    this.doors = [];
    this.windows = [];
  }

  newCorner(x, y, id = null) {
    const corner = new Corner(this, x, y, id);
    this.corners.push(corner);
    return corner;
  }

  newWall(corner1, corner2, thickness = config.wallThickness, height = config.wallHeight) {
    const wall = new Wall(corner1, corner2, thickness, height);
    this.walls.push(wall);
    return wall;
  }

  findCorner(x, y, tolerance = config.vertexSnapTolerance) {
    for (const c of this.corners) {
      if (c.distanceFrom(x, y) <= tolerance) {
        return c;
      }
    }
    return null;
  }

  findOrCreateCorner(x, y, tolerance = config.vertexSnapTolerance) {
    const existing = this.findCorner(x, y, tolerance);
    if (existing) return existing;
    return this.newCorner(x, y);
  }

  /**
   * Identifica ciclos fechados de paredes e gera Rooms automaticamente
   * (Algoritmo do Blueprint3D: _findTightestCycle)
   */
  updateRooms() {
    this.rooms = [];

    const calculateTheta = (previousCorner, currentCorner, nextCorner) => {
      const theta1 = Utils.angle2pi(
        currentCorner.x - previousCorner.x,
        currentCorner.y - previousCorner.y,
        0, 0
      );
      const theta2 = Utils.angle2pi(
        nextCorner.x - currentCorner.x,
        nextCorner.y - currentCorner.y,
        0, 0
      );
      let diff = theta2 - theta1;
      if (diff < 0) diff += 2 * Math.PI;
      return diff;
    };

    const findTightestCycle = (firstCorner, secondCorner) => {
      const stack = [{
        corner: secondCorner,
        previousCorners: [firstCorner]
      }];
      const visited = { [firstCorner.id]: true };

      while (stack.length > 0) {
        const next = stack.pop();
        const currentCorner = next.corner;
        visited[currentCorner.id] = true;

        if (currentCorner === firstCorner && next.previousCorners.length > 2) {
          return next.previousCorners;
        }

        const adjacentCorners = currentCorner.adjacentCorners();
        const addToStack = [];

        for (const nextCorner of adjacentCorners) {
          if (nextCorner.id in visited && !(nextCorner === firstCorner && currentCorner !== secondCorner)) {
            continue;
          }
          addToStack.push(nextCorner);
        }

        const prevCorner = next.previousCorners[next.previousCorners.length - 1];
        if (addToStack.length > 1) {
          addToStack.sort((a, b) => calculateTheta(prevCorner, currentCorner, b) - calculateTheta(prevCorner, currentCorner, a));
        }

        for (const cand of addToStack) {
          stack.push({
            corner: cand,
            previousCorners: [...next.previousCorners, currentCorner]
          });
        }
      }
      return [];
    };

    const rawCycles = [];
    for (const first of this.corners) {
      for (const second of first.adjacentCorners()) {
        const cycle = findTightestCycle(first, second);
        if (cycle && cycle.length >= 3) {
          rawCycles.push(cycle);
        }
      }
    }

    // Remove duplicatas e ciclos no sentido horário (externos)
    const seen = new Set();
    const validRooms = [];

    for (const cycle of rawCycles) {
      const pts = cycle.map(c => ({ x: c.x, y: c.y }));
      // Se for sentido horário (CW), é o contorno externo, descartar
      if (Utils.isClockwise(pts)) continue;

      const area = Utils.polygonArea(pts);
      // Descarta áreas minúsculas (menores que 1m²) ou gigantescas (terreno inteiro)
      if (area < 0.8 || area > 500) continue;

      const sortedIds = cycle.map(c => c.id).sort().join('-');
      if (!seen.has(sortedIds)) {
        seen.add(sortedIds);
        validRooms.push(new Room(this, cycle));
      }
    }

    // Deduplica cômodos com centros muito próximos (dupla linha de alvenaria em CAD)
    const uniqueRooms = [];
    for (const r of validRooms) {
      const c = r.getCenter();
      const duplicate = uniqueRooms.find(ur => {
        const uc = ur.getCenter();
        return Math.hypot(c.x - uc.x, c.y - uc.y) < 0.45;
      });
      if (!duplicate) {
        uniqueRooms.push(r);
      } else if (r.area > duplicate.area && r.area < duplicate.area * 1.35) {
        const idx = uniqueRooms.indexOf(duplicate);
        uniqueRooms[idx] = r;
      }
    }

    this.rooms = uniqueRooms;
    return this.rooms;
  }

  toJSON() {
    const cornersObj = {};
    this.corners.forEach(c => {
      cornersObj[c.id] = { x: c.x, y: c.y };
    });

    const wallsArr = this.walls.map(w => ({
      id: w.id,
      corner1: w.start.id,
      corner2: w.end.id,
      thickness: w.thickness,
      height: w.height,
      items: w.items
    }));

    const roomsArr = this.rooms.map(r => ({
      id: r.id,
      name: r.name,
      area: Number(r.area.toFixed(2)),
      floorType: r.floorType,
      corners: r.corners.map(c => c.id),
      polygon: r.getPolygonPoints()
    }));

    return {
      corners: cornersObj,
      walls: wallsArr,
      rooms: roomsArr,
      doors: this.doors,
      windows: this.windows
    };
  }
}

module.exports = Floorplan;
