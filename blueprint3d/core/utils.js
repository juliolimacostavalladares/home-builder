/**
 * Utilitários geométricos e matemáticos portados do Blueprint3D para Node.js
 */
class Utils {
  static guid() {
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
  }

  static distance(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  static pointDistanceFromLine(x, y, x1, y1, x2, y2) {
    const pt = this.closestPointOnLine(x, y, x1, y1, x2, y2);
    return Math.hypot(x - pt.x, y - pt.y);
  }

  static closestPointOnLine(x, y, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { x: x1, y: y1 };

    let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return {
      x: x1 + t * dx,
      y: y1 + t * dy
    };
  }

  static angle(x1, y1, x2, y2) {
    const dot = x1 * x2 + y1 * y2;
    const det = x1 * y2 - y1 * x2;
    return -Math.atan2(det, dot);
  }

  static angle2pi(x1, y1, x2, y2) {
    let theta = this.angle(x1, y1, x2, y2);
    if (theta < 0) theta += 2 * Math.PI;
    return theta;
  }

  /**
   * Determina se o polígono está orientado no sentido horário (CW) ou anti-horário (CCW)
   */
  static isClockwise(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const c1 = points[i];
      const c2 = points[(i + 1) % points.length];
      sum += (c2.x - c1.x) * (c2.y + c1.y);
    }
    return sum >= 0;
  }

  /**
   * Calcula a área de um polígono 2D (Fórmula de Shoelace / Gauss)
   */
  static polygonArea(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }

  /**
   * Ponto dentro de polígono (Ray casting)
   */
  static pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
}

module.exports = Utils;
