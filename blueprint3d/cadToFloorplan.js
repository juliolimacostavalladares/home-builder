const DxfParser = require('dxf-parser');
const Floorplan = require('./model/Floorplan');
const config = require('./core/config');
const Utils = require('./core/utils');

/**
 * Converte dados extraídos de DWG/DXF/SVG para o modelo arquitetônico Blueprint3D
 */
class CadToFloorplan {
  /**
   * Decodifica Unicode do AutoCAD DXF
   */
  static decodeDxfUnicode(str) {
    if (!str) return '';
    return str.replace(/\\U\+([0-9A-Fa-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  /**
   * Converte DXF String para uma instância completa de Floorplan
   * @param {string} dxfString
   * @param {Object} options
   */
  static convertDxf(dxfString, options = {}) {
    const parser = new DxfParser();
    let parsed;
    try {
      parsed = parser.parseSync(dxfString);
    } catch (err) {
      console.error('[CadToFloorplan] Erro no parsing DXF:', err);
      return new Floorplan();
    }

    const floorplan = new Floorplan();
    const entities = parsed.entities || [];
    const snapTol = options.snapTolerance || config.vertexSnapTolerance;

    // 1. Extrai Linhas de Paredes (PAREDE ou stroke branco)
    const wallEntities = entities.filter(e => {
      const isParedeLayer = (e.layer || '').toUpperCase() === 'PAREDE';
      return isParedeLayer && e.type === 'LINE';
    });

    console.log(`[CadToFloorplan] Linhas brutas de parede encontradas: ${wallEntities.length}`);

    // Cria paredes e esquinas com snap inteligente
    wallEntities.forEach(line => {
      const p1 = line.vertices[0];
      const p2 = line.vertices[1];
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);

      // Descarta linhas minúsculas (menores que 8cm)
      if (len < 0.08) return;

      const c1 = floorplan.findOrCreateCorner(p1.x, p1.y, snapTol);
      const c2 = floorplan.findOrCreateCorner(p2.x, p2.y, snapTol);

      if (c1 !== c2) {
        // Evita paredes duplicadas idênticas
        const alreadyExists = floorplan.walls.some(w =>
          (w.start === c1 && w.end === c2) || (w.start === c2 && w.end === c1)
        );
        if (!alreadyExists) {
          floorplan.newWall(c1, c2, config.wallThickness, config.wallHeight);
        }
      }
    });

    console.log(`[CadToFloorplan] Esquinas criadas: ${floorplan.corners.length}, Paredes únicas: ${floorplan.walls.length}`);

    // 2. Extrai Blocos de Portas (P80, P70, P90, etc.)
    const doorInserts = entities.filter(e => e.type === 'INSERT' && /^P\d+/i.test(e.name || ''));
    doorInserts.forEach(ins => {
      const name = ins.name.toUpperCase();
      let width = config.doorWidth;
      const widthMatch = name.match(/^P(\d+)/i);
      if (widthMatch) {
        width = parseInt(widthMatch[1], 10) / 100; // P80 -> 0.80m
      }

      const doorPos = {
        x: Number((ins.position?.x || 0).toFixed(3)),
        y: Number((ins.position?.y || 0).toFixed(3))
      };

      // Encontra a parede mais próxima
      let closestWall = null;
      let minDistance = Infinity;

      for (const wall of floorplan.walls) {
        const d = wall.distanceFrom(doorPos.x, doorPos.y);
        if (d < minDistance) {
          minDistance = d;
          closestWall = wall;
        }
      }

      const doorItem = {
        id: `door_${floorplan.doors.length + 1}`,
        type: 'door',
        name: ins.name,
        width,
        height: config.doorHeight,
        sill: config.doorSill,
        lintel: config.doorHeight,
        position: doorPos
      };

      if (closestWall && minDistance <= 0.40) {
        // Projeta posição ao longo da parede
        const proj = Utils.closestPointOnLine(doorPos.x, doorPos.y, closestWall.start.x, closestWall.start.y, closestWall.end.x, closestWall.end.y);
        doorItem.positionAlongWall = Utils.distance(closestWall.start.x, closestWall.start.y, proj.x, proj.y);
        closestWall.addItem(doorItem);
      }

      floorplan.doors.push(doorItem);
    });

    console.log(`[CadToFloorplan] Portas identificadas: ${floorplan.doors.length}`);

    // 3. Extrai Janelas (Linhas agrupadas em BLOCO paralelas às paredes)
    const windowLines = entities.filter(e => (e.layer || '').toUpperCase() === 'BLOCO' && e.type === 'LINE');
    const processedWindows = [];

    windowLines.forEach(wl => {
      const p1 = wl.vertices[0];
      const p2 = wl.vertices[1];
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);

      // Janelas típicas têm largura entre 0.60m e 3.00m
      if (len >= 0.55 && len <= 3.20) {
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

        // Evita linhas paralelas da mesma esquadria duplicadas (comum em CAD que desenha 4 linhas para a mesma janela)
        const isDuplicate = processedWindows.some(pw => Math.hypot(pw.mid.x - mid.x, pw.mid.y - mid.y) < 0.25);
        if (!isDuplicate) {
          processedWindows.push({ mid, len, p1, p2 });

          // Procura a parede associada
          let closestWall = null;
          let minDistance = Infinity;

          for (const wall of floorplan.walls) {
            const d = wall.distanceFrom(mid.x, mid.y);
            if (d < minDistance) {
              minDistance = d;
              closestWall = wall;
            }
          }

          const isSmall = len <= 0.85; // Provável maxim-ar de banheiro
          const windowItem = {
            id: `window_${floorplan.windows.length + 1}`,
            type: 'window',
            width: Number(len.toFixed(2)),
            height: isSmall ? config.bathWindowHeight : config.windowHeight,
            sill: isSmall ? config.bathWindowSill : config.windowSill,
            lintel: config.windowLintel,
            position: mid
          };

          if (closestWall && minDistance <= 0.35) {
            const proj = Utils.closestPointOnLine(mid.x, mid.y, closestWall.start.x, closestWall.start.y, closestWall.end.x, closestWall.end.y);
            windowItem.positionAlongWall = Math.max(0, Utils.distance(closestWall.start.x, closestWall.start.y, proj.x, proj.y) - len / 2);
            closestWall.addItem(windowItem);
          }

          floorplan.windows.push(windowItem);
        }
      }
    });

    console.log(`[CadToFloorplan] Janelas identificadas: ${floorplan.windows.length}`);

    // 4. Cria conexões virtuais nos vãos de portas para fechar os ciclos de cômodos (Face A e Face B)
    doorInserts.forEach(ins => {
      const widthMatch = (ins.name || '').match(/^P(\d+)/i);
      const width = widthMatch ? parseInt(widthMatch[1], 10) / 100 : config.doorWidth;
      const rotRad = ((ins.rotation || 0) * Math.PI) / 180;
      const vx = Math.cos(rotRad);
      const vy = Math.sin(rotRad);
      const px = ins.position?.x || 0;
      const py = ins.position?.y || 0;

      // Conecta Face A (alinhada à origem do bloco)
      const cA1 = floorplan.findCorner(px, py, 0.15);
      const cA2 = floorplan.findCorner(px + width * vx, py + width * vy, 0.15);
      if (cA1 && cA2 && cA1 !== cA2) {
        if (!floorplan.walls.some(w => (w.start === cA1 && w.end === cA2) || (w.start === cA2 && w.end === cA1))) {
          const w = floorplan.newWall(cA1, cA2);
          w.isDoorwayThreshold = true;
        }
      }

      // Conecta Face B (deslocada pela espessura da parede perpendicular)
      for (const sign of [1, -1]) {
        const nx = -vy * sign * config.wallThickness;
        const ny = vx * sign * config.wallThickness;
        const cB1 = floorplan.findCorner(px + nx, py + ny, 0.15);
        const cB2 = floorplan.findCorner(px + width * vx + nx, py + width * vy + ny, 0.15);
        if (cB1 && cB2 && cB1 !== cB2) {
          if (!floorplan.walls.some(w => (w.start === cB1 && w.end === cB2) || (w.start === cB2 && w.end === cB1))) {
            const w = floorplan.newWall(cB1, cB2);
            w.isDoorwayThreshold = true;
          }
        }
      }
    });

    // 5. Identifica Ciclos de Cômodos
    floorplan.updateRooms();
    console.log(`[CadToFloorplan] Cômodos (ciclos fechados) detectados: ${floorplan.rooms.length}`);

    // 6. Correlaciona Nomes de Cômodos com os Polígonos
    const roomTexts = [];
    entities.filter(e => e.type === 'TEXT' || e.type === 'MTEXT' || (e.type === 'INSERT' && /DORMI|COZINH|WC|ESTAR|JANTAR|SERVI|ABRIG|TERRA/i.test(e.name || ''))).forEach(t => {
      let rawName = t.text || t.name || '';
      rawName = this.decodeDxfUnicode(rawName).trim();
      rawName = rawName.replace(/^\\[a-zA-Z0-9]+;/, '').trim();

      const pos = {
        x: Number((t.startPoint?.x || t.position?.x || 0).toFixed(2)),
        y: Number((t.startPoint?.y || t.position?.y || 0).toFixed(2))
      };

      const isDimension = /^\d+(\.\d+)?$/.test(rawName) || /^\d+[\s\/\.:xX-]\d+$/.test(rawName) || /área/i.test(rawName);
      if (rawName && rawName.length > 1 && !isDimension) {
        roomTexts.push({ name: rawName, pos });
      }
    });

    // Mapeia textos para cômodos contíguos com priorização semântica de escala
    const isWc = name => /w\.?c\.?|banh|lavab/i.test(name);
    const isBed = name => /dormi|quart|suit/i.test(name);
    const isKitchen = name => /cozinh|servi/i.test(name);

    const usedTexts = new Set();
    const sortedRooms = [...floorplan.rooms].sort((a, b) => b.area - a.area);

    sortedRooms.forEach((room, idx) => {
      const polygon = room.getPolygonPoints();
      // 1. Tenta primeiro ponto estritamente dentro do polígono
      let match = roomTexts.find(rt => !usedTexts.has(rt) && Utils.pointInPolygon(rt.pos.x, rt.pos.y, polygon));

      // 2. Se não estiver contido, busca o texto mais próximo compatível com o tamanho do cômodo
      if (!match) {
        const center = room.getCenter();
        let minDist = 5.5;
        for (const rt of roomTexts) {
          if (usedTexts.has(rt)) continue;
          if (room.area > 6.0 && isWc(rt.name)) continue; // Cômodo grande não é banheiro
          if (room.area < 3.2 && isBed(rt.name)) continue; // Cômodo pequeno não é dormitório
          const d = Math.hypot(center.x - rt.pos.x, center.y - rt.pos.y);
          if (d < minDist) {
            minDist = d;
            match = rt;
          }
        }
      }

      if (match) {
        usedTexts.add(match);
        let clean = match.name;
        if (/dormi/i.test(clean)) clean = 'Dormitório';
        else if (/cozinh/i.test(clean)) clean = 'Cozinha';
        else if (/w\.?c\.?|banh/i.test(clean)) clean = 'Banheiro (W.C.)';
        else if (/estar/i.test(clean)) clean = 'Sala de Estar';
        else if (/jantar/i.test(clean)) clean = 'Sala de Jantar';
        else if (/servi/i.test(clean)) clean = 'Área de Serviço';
        else if (/terra/i.test(clean)) clean = 'Terraço';
        else if (/abrig/i.test(clean)) clean = 'Abrigo';

        room.name = clean;
      } else {
        if (room.area < 2.0) {
          room.name = 'Lavabo / Circulação';
        } else if (room.area < 3.5) {
          room.name = 'Banheiro (W.C.)';
        } else if (room.area >= 10.0) {
          room.name = 'Dormitório';
        } else {
          room.name = `Ambiente ${idx + 1}`;
        }
      }

      // Atribui o piso apropriado
      if (/banh|w\.?c\.?|cozinh|servi|lavab/i.test(room.name)) {
        room.floorType = 'porcelain';
      } else if (/terra|abrig/i.test(room.name)) {
        room.floorType = 'exterior';
      } else {
        room.floorType = 'hardwood';
      }
    });

    return floorplan;
  }
}

module.exports = CadToFloorplan;
