/**
 * First-Person Walk Mode com Física e Colisão — Blueprint3D
 *
 * Controles:
 *   W / ↑  → avançar     S / ↓  → recuar
 *   A / ←  → strafe esq  D / →  → strafe dir
 *   Mouse  → olhar (pointer lock)
 *   ESC    → sair do modo walk
 *
 * Física:
 *   • Câmera fixada na altura dos olhos (sem gravidade simulada)
 *   • Colisão com cada segmento de parede (capsule radius)
 *   • Confinamento dentro do polígono da planta (union de rooms)
 */
(function installFirstPersonWalk() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // Constantes de física e câmera
  // ═══════════════════════════════════════════════════════════════════════════
  const EYE_HEIGHT    = 155;   // altura dos olhos em unidades BP3D (≈ cm)
  const MOVE_SPEED    = 5.5;   // unidades por frame (~50 fps → ~275 u/s)
  const LOOK_SENS     = 0.0022;
  const MIN_PITCH     = -Math.PI * 0.38;
  const MAX_PITCH     =  Math.PI * 0.38;
  const PLAYER_RADIUS = 25;    // raio da cápsula do jogador (cm)
  const WALL_MARGIN   = PLAYER_RADIUS;
  const FLOOR_MARGIN  = PLAYER_RADIUS * 0.6; // margem da borda exterior da planta

  // ═══════════════════════════════════════════════════════════════════════════
  // Estado do walk
  // ═══════════════════════════════════════════════════════════════════════════
  let active   = false;
  let yaw      = 0;
  let pitch    = 0;
  const keys   = {};

  // cache de geometria da planta (atualizado ao entrar no modo walk)
  let wallSegments   = []; // [{x1,z1,x2,z2}]
  let floorPolygons  = []; // [[[x,z],...]]  — uma por room
  let planeBounds    = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

  // refs BP3D
  let camera, controls, threeInstance, rafId;

  // ═══════════════════════════════════════════════════════════════════════════
  // Geometria de colisão — extrai da planta BP3D
  // ═══════════════════════════════════════════════════════════════════════════
  function buildCollisionGeometry(floorplan) {
    wallSegments  = [];
    floorPolygons = [];

    // ── Paredes ──────────────────────────────────────────────────────────────
    const walls = floorplan.getWalls ? floorplan.getWalls() : [];
    walls.forEach(wall => {
      // Evitar paredes de contorno (cadFloorBoundary) — são apenas visuais
      if (wall.cadFloorBoundary) return;

      const sv = wall.startVertex || wall.start;
      const ev = wall.endVertex   || wall.end;
      if (!sv || !ev) return;

      wallSegments.push({ x1: sv.x, z1: sv.y, x2: ev.x, z2: ev.y });
    });

    // ── Polígonos de rooms (chão) ─────────────────────────────────────────
    const rooms = floorplan.getRooms ? floorplan.getRooms() : [];
    let allX = [], allZ = [];

    rooms.forEach(room => {
      const corners = room.interiorCorners || [];
      if (corners.length < 3) return;
      const poly = corners.map(c => [c.x, c.y]);
      floorPolygons.push(poly);
      poly.forEach(([x, z]) => { allX.push(x); allZ.push(z); });
    });

    if (allX.length) {
      planeBounds = {
        minX: Math.min(...allX) - FLOOR_MARGIN,
        maxX: Math.max(...allX) + FLOOR_MARGIN,
        minZ: Math.min(...allZ) + FLOOR_MARGIN,
        maxZ: Math.max(...allZ) - FLOOR_MARGIN,
      };
    }

    console.log(`[HB Walk] Colisão: ${wallSegments.length} paredes, ${floorPolygons.length} ambientes`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Física de colisão
  // ═══════════════════════════════════════════════════════════════════════════

  /** Ponto mais próximo no segmento AB a partir do ponto P */
  function closestPointOnSegment(px, pz, ax, az, bx, bz) {
    const abx = bx - ax, abz = bz - az;
    const apx = px - ax, apz = pz - az;
    const ab2 = abx * abx + abz * abz;
    if (ab2 === 0) return { x: ax, z: az };
    const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
    return { x: ax + t * abx, z: az + t * abz };
  }

  /**
   * Aplica push-back por colisão com paredes.
   * Retorna {x, z} corrigido.
   */
  function resolveWallCollisions(nx, nz) {
    // Iterar até 4 vezes para resolver colisões compostas (cantos)
    for (let iter = 0; iter < 4; iter++) {
      let pushed = false;

      for (const seg of wallSegments) {
        const cp = closestPointOnSegment(nx, nz, seg.x1, seg.z1, seg.x2, seg.z2);
        const dx = nx - cp.x;
        const dz = nz - cp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < WALL_MARGIN && dist > 0.001) {
          // Empurrar para fora da parede
          const penetration = WALL_MARGIN - dist;
          const nx2 = dx / dist;
          const nz2 = dz / dist;
          nx += nx2 * penetration;
          nz += nz2 * penetration;
          pushed = true;
        }
      }

      if (!pushed) break;
    }
    return { x: nx, z: nz };
  }

  /**
   * Verifica se ponto (px, pz) está dentro de algum polígono de room.
   * Ray-casting algorithm.
   */
  function isInsideFloorPlan(px, pz) {
    if (floorPolygons.length === 0) {
      // Sem rooms: usar bounding box como fallback
      return px >= planeBounds.minX && px <= planeBounds.maxX
          && pz >= planeBounds.minZ && pz <= planeBounds.maxZ;
    }

    for (const poly of floorPolygons) {
      if (pointInPolygon(px, pz, poly)) return true;
    }
    return false;
  }

  function pointInPolygon(px, pz, poly) {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (((zi > pz) !== (zj > pz)) &&
          px < (xj - xi) * (pz - zi) / (zj - zi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Loop de jogo
  // ═══════════════════════════════════════════════════════════════════════════
  let lastPos = { x: 0, z: 0 }; // última posição válida

  function loop() {
    if (!active) return;
    rafId = requestAnimationFrame(loop);

    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);

    let dx = 0, dz = 0;

    if (keys['KeyW']    || keys['ArrowUp'])    { dx +=  sinY; dz +=  cosY; }
    if (keys['KeyS']    || keys['ArrowDown'])  { dx -=  sinY; dz -=  cosY; }
    if (keys['KeyA']    || keys['ArrowLeft'])  { dx -=  cosY; dz +=  sinY; }
    if (keys['KeyD']    || keys['ArrowRight']) { dx +=  cosY; dz -=  sinY; }

    if (dx !== 0 || dz !== 0) {
      const len = Math.sqrt(dx * dx + dz * dz);
      let nx = camera.position.x + (dx / len) * MOVE_SPEED;
      let nz = camera.position.z + (dz / len) * MOVE_SPEED;

      // 1. Resolver colisão com paredes
      const resolved = resolveWallCollisions(nx, nz);
      nx = resolved.x;
      nz = resolved.z;

      // 2. Confinamento à planta
      if (isInsideFloorPlan(nx, nz)) {
        camera.position.x = nx;
        camera.position.z = nz;
        lastPos = { x: nx, z: nz };
      } else {
        // Tentar mover só em X
        const onlyX = resolveWallCollisions(nx, camera.position.z);
        if (isInsideFloorPlan(onlyX.x, camera.position.z)) {
          camera.position.x = onlyX.x;
          lastPos = { x: onlyX.x, z: camera.position.z };
        } else {
          // Tentar mover só em Z
          const onlyZ = resolveWallCollisions(camera.position.x, nz);
          if (isInsideFloorPlan(camera.position.x, onlyZ.z)) {
            camera.position.z = onlyZ.z;
            lastPos = { x: camera.position.x, z: onlyZ.z };
          }
          // Senão: parado (bloqueado pelo canto)
        }
      }
    }

    // Câmera sempre na altura dos olhos (sem queda)
    camera.position.y = EYE_HEIGHT;

    // Olhar
    const lookX = camera.position.x + Math.sin(yaw)  * Math.cos(pitch);
    const lookY = camera.position.y + Math.sin(pitch);
    const lookZ = camera.position.z + Math.cos(yaw)  * Math.cos(pitch);
    camera.lookAt(new THREE.Vector3(lookX, lookY, lookZ));
    camera.updateProjectionMatrix();

    controls.needsUpdate = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI — botão Walk + crosshair + hint
  // ═══════════════════════════════════════════════════════════════════════════
  function injectWalkButton() {
    if (document.getElementById('hb-walk-btn')) return;
    const cameraControls = document.getElementById('camera-controls');
    if (!cameraControls) return;

    const btn = document.createElement('a');
    btn.id        = 'hb-walk-btn';
    btn.href      = '#';
    btn.className = 'btn btn-default bottom';
    btn.title     = 'Modo Primeira Pessoa · W A S D · Mouse';
    btn.style.cssText = 'margin-left:10px; font-size:16px;';
    btn.innerHTML = '🚶';
    btn.addEventListener('click', e => { e.preventDefault(); toggleWalk(); });
    cameraControls.appendChild(btn);

    // Crosshair
    const ch = document.createElement('div');
    ch.id = 'hb-crosshair';
    ch.style.cssText = `
      display:none; position:fixed; top:50%; left:50%;
      transform:translate(-50%,-50%); pointer-events:none; z-index:9999;
      width:22px; height:22px;`;
    ch.innerHTML = `<svg viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <line x1="11" y1="3"  x2="11" y2="19" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/>
      <line x1="3"  y1="11" x2="19" y2="11" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/>
      <circle cx="11" cy="11" r="2.5" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/>
    </svg>`;
    document.body.appendChild(ch);

    // Hint bar
    const hint = document.createElement('div');
    hint.id = 'hb-walk-hint';
    hint.style.cssText = `
      display:none; position:fixed; bottom:22px; left:50%; transform:translateX(-50%);
      background:rgba(0,0,0,.6); color:#fff; padding:6px 18px; border-radius:20px;
      font:13px/1.5 system-ui,sans-serif; pointer-events:none; z-index:9999;`;
    hint.innerHTML = 'W A S D · Mouse para olhar · <kbd style="background:#333;border-radius:4px;padding:1px 5px">ESC</kbd> para sair';
    document.body.appendChild(hint);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toggle Walk
  // ═══════════════════════════════════════════════════════════════════════════
  function toggleWalk() { active ? exitWalk() : enterWalk(); }

  function enterWalk() {
    if (!resolveRefs()) {
      alert('O editor 3D ainda não está pronto. Acesse a aba "Design" primeiro.');
      return;
    }

    active = true;

    // Construir geometria de colisão
    buildCollisionGeometry(threeInstance.getModel().floorplan);

    // Posicionar jogador no centro da planta
    const center = threeInstance.getModel().floorplan.getCenter();
    camera.position.set(center.x, EYE_HEIGHT, center.z);
    lastPos = { x: center.x, z: center.z };
    yaw     = 0;
    pitch   = 0;

    // Desabilitar OrbitControls
    controls.enabled = false;
    controls.noKeys  = true;

    // Pointer lock
    const canvas = document.querySelector('#viewer canvas');
    if (canvas) {
      (canvas.requestPointerLock || canvas.mozRequestPointerLock
        || canvas.webkitRequestPointerLock || (() => {})).call(canvas);
    }

    document.getElementById('hb-walk-btn').style.background = '#5bc0de';
    document.getElementById('hb-crosshair').style.display   = 'block';
    document.getElementById('hb-walk-hint').style.display   = 'block';

    document.addEventListener('pointerlockchange',    onPointerLockChange, false);
    document.addEventListener('mozpointerlockchange', onPointerLockChange, false);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('keydown',   onKeyDown,   false);
    document.addEventListener('keyup',     onKeyUp,     false);

    rafId = requestAnimationFrame(loop);
  }

  function exitWalk() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);

    const exitPL = document.exitPointerLock
      || document.mozExitPointerLock
      || document.webkitExitPointerLock;
    exitPL && exitPL.call(document);

    if (controls) { controls.enabled = true; controls.noKeys = false; }
    threeInstance?.centerCamera();

    document.getElementById('hb-walk-btn').style.background = '';
    document.getElementById('hb-crosshair').style.display   = 'none';
    document.getElementById('hb-walk-hint').style.display   = 'none';

    document.removeEventListener('pointerlockchange',    onPointerLockChange, false);
    document.removeEventListener('mozpointerlockchange', onPointerLockChange, false);
    document.removeEventListener('mousemove', onMouseMove, false);
    document.removeEventListener('keydown',   onKeyDown,   false);
    document.removeEventListener('keyup',     onKeyUp,     false);

    if (controls) controls.needsUpdate = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Eventos de input
  // ═══════════════════════════════════════════════════════════════════════════
  function onMouseMove(e) {
    if (!active) return;
    const canvas = document.querySelector('#viewer canvas');
    const locked = document.pointerLockElement === canvas
                || document.mozPointerLockElement === canvas;
    if (!locked) return;
    yaw   -= (e.movementX || e.mozMovementX || 0) * LOOK_SENS;
    pitch -= (e.movementY || e.mozMovementY || 0) * LOOK_SENS;
    pitch  = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
  }

  function onKeyDown(e) {
    if (!active) return;
    keys[e.code] = true;
    if (e.code === 'Escape') exitWalk();
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) { keys[e.code] = false; }

  function onPointerLockChange() {
    const canvas = document.querySelector('#viewer canvas');
    const locked = document.pointerLockElement === canvas
                || document.mozPointerLockElement === canvas;
    if (!locked && active) exitWalk();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Resolver referências BP3D
  // ═══════════════════════════════════════════════════════════════════════════
  function resolveRefs() {
    if (threeInstance && camera && controls) return true;

    // O blueprint-bridge.js guarda em window._bp3dInstance
    const inst = window._bp3dInstance;
    if (!inst || !inst.three) return false;

    threeInstance = inst.three;
    camera        = threeInstance.getCamera();
    controls      = threeInstance.controls;
    return !!(camera && controls);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Bootstrap — integra com o homeBuilderBridge
  // ═══════════════════════════════════════════════════════════════════════════
  function waitForBridge() {
    if (!window.homeBuilderBridge) { setTimeout(waitForBridge, 200); return; }

    // Expõe API pública
    window.homeBuilderBridge.enterWalk = enterWalk;
    window.homeBuilderBridge.exitWalk  = exitWalk;

    // Injetar botão quando o modelo for carregado
    const origLoad = window.homeBuilderBridge.load.bind(window.homeBuilderBridge);
    window.homeBuilderBridge.load = function(design) {
      const result = origLoad(design);
      setTimeout(injectWalkButton, 600);
      return result;
    };

    // Injetar se já carregado
    setTimeout(injectWalkButton, 800);
  }

  // Injetar botão quando a tab Design for clicada
  document.addEventListener('click', e => {
    if (e.target.closest('#design_tab')) {
      setTimeout(() => {
        if (!document.getElementById('hb-walk-btn')) injectWalkButton();
      }, 400);
    }
  });

  waitForBridge();
})();
