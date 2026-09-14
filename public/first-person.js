/**
 * First-Person Walk Mode com Física e Colisão — Blueprint3D
 * Estratégia: patcha BP3D.Blueprint3d ANTES do example.js criar a instância.
 * Como os scripts são carregados em ordem:
 *   native-cad-properties.js → blueprint-bridge.js → example.js → first-person.js
 * O first-person.js chega DEPOIS da instância já criada; usa window._bp3dInstance.
 *
 * Controles:
 *   W / ↑  → avançar     S / ↓  → recuar
 *   A / ←  → esquerda    D / →  → direita
 *   Mouse  → olhar (pointer lock)
 *   ESC    → sair
 *
 * Física:
 *   • Colisão com segmentos de parede (push-back iterativo)
 *   • Confinamento dentro dos polígonos dos rooms (ray-cast)
 *   • Câmera sempre a EYE_HEIGHT (sem queda)
 */
(function installFirstPersonWalk() {
  'use strict';

  // ─── Constantes ──────────────────────────────────────────────────────────────
  const EYE_HEIGHT    = 155;     // altura dos olhos (unidades BP3D ≈ cm)
  const MOVE_SPEED    = 5.5;     // u/frame  (~50fps → ~275 u/s)
  const LOOK_SENS     = 0.0022;  // rad/px
  const MIN_PITCH     = -Math.PI * 0.38;
  const MAX_PITCH     =  Math.PI * 0.38;
  const PLAYER_RADIUS = 28;      // raio da cápsula (cm)

  // ─── Estado ──────────────────────────────────────────────────────────────────
  let active   = false;
  let yaw      = 0;
  let pitch    = 0;
  const keys   = {};

  let wallSegs      = [];  // [{x1,z1,x2,z2}]
  let roomPolygons  = [];  // [[[x,z],...]]

  // Refs vivas para a câmera e controls do BP3D
  let _camera   = null;
  let _controls = null;
  let _three    = null;
  let _floorplan = null;
  let rafId;

  // ─── Resolução de refs ───────────────────────────────────────────────────────
  function getRefs() {
    // window._bp3dInstance é definido pelo blueprint-bridge.js
    const inst = window._bp3dInstance;
    if (!inst) return false;
    _three    = inst.three;
    _camera   = _three.getCamera();
    _controls = _three.controls;
    _floorplan = inst.model.floorplan;
    return !!(_camera && _controls && _floorplan);
  }

  // ─── Geometria de colisão ────────────────────────────────────────────────────
  function buildGeometry() {
    wallSegs     = [];
    roomPolygons = [];

    // Paredes
    const walls = _floorplan.getWalls ? _floorplan.getWalls() : [];
    for (const w of walls) {
      if (w.cadFloorBoundary) continue;
      const s = w.startVertex || w.start;
      const e = w.endVertex   || w.end;
      if (s && e) wallSegs.push({ x1: s.x, z1: s.y, x2: e.x, z2: e.y });
    }

    // Polígonos dos cômodos (para confinamento)
    const rooms = _floorplan.getRooms ? _floorplan.getRooms() : [];
    for (const r of rooms) {
      const corners = r.interiorCorners || [];
      if (corners.length >= 3) {
        roomPolygons.push(corners.map(c => [c.x, c.y]));
      }
    }

    console.log(`[Walk] ${wallSegs.length} paredes | ${roomPolygons.length} rooms`);
  }

  // ─── Algoritmos de colisão ───────────────────────────────────────────────────
  function closestOnSeg(px, pz, ax, az, bx, bz) {
    const abx = bx - ax, abz = bz - az;
    const ab2 = abx * abx + abz * abz;
    if (ab2 < 1e-9) return { x: ax, z: az };
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / ab2));
    return { x: ax + t * abx, z: az + t * abz };
  }

  function pushBackWalls(nx, nz) {
    for (let iter = 0; iter < 5; iter++) {
      let moved = false;
      for (const seg of wallSegs) {
        const cp  = closestOnSeg(nx, nz, seg.x1, seg.z1, seg.x2, seg.z2);
        const dx  = nx - cp.x, dz = nz - cp.z;
        const d   = Math.sqrt(dx * dx + dz * dz);
        if (d < PLAYER_RADIUS && d > 1e-4) {
          const pen = PLAYER_RADIUS - d;
          nx += (dx / d) * pen;
          nz += (dz / d) * pen;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x: nx, z: nz };
  }

  function pointInPoly(px, pz, poly) {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > pz) !== (zj > pz) &&
          px < (xj - xi) * (pz - zi) / (zj - zi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function isInsidePlan(px, pz) {
    if (roomPolygons.length === 0) return true; // sem rooms: sem restrição
    for (const poly of roomPolygons) {
      if (pointInPoly(px, pz, poly)) return true;
    }
    return false;
  }

  // ─── Loop de física ──────────────────────────────────────────────────────────
  function loop() {
    if (!active) return;
    rafId = requestAnimationFrame(loop);

    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    let dx = 0, dz = 0;

    if (keys['KeyW'] || keys['ArrowUp'])    { dx +=  sinY; dz +=  cosY; }
    if (keys['KeyS'] || keys['ArrowDown'])  { dx -=  sinY; dz -=  cosY; }
    if (keys['KeyA'] || keys['ArrowLeft'])  { dx -=  cosY; dz +=  sinY; }
    if (keys['KeyD'] || keys['ArrowRight']) { dx +=  cosY; dz -=  sinY; }

    if (dx !== 0 || dz !== 0) {
      const len = Math.sqrt(dx * dx + dz * dz);
      let nx = _camera.position.x + (dx / len) * MOVE_SPEED;
      let nz = _camera.position.z + (dz / len) * MOVE_SPEED;

      // 1. push-back de paredes
      const resolved = pushBackWalls(nx, nz);
      nx = resolved.x; nz = resolved.z;

      // 2. confinamento ao polígono da planta
      if (isInsidePlan(nx, nz)) {
        _camera.position.x = nx;
        _camera.position.z = nz;
      } else {
        // tentar deslizar em X
        const rx = pushBackWalls(nx, _camera.position.z);
        if (isInsidePlan(rx.x, rx.z)) {
          _camera.position.x = rx.x;
          _camera.position.z = rx.z;
        } else {
          // tentar deslizar em Z
          const rz = pushBackWalls(_camera.position.x, nz);
          if (isInsidePlan(rz.x, rz.z)) {
            _camera.position.x = rz.x;
            _camera.position.z = rz.z;
          }
          // senão: parado
        }
      }
    }

    // Altura travada
    _camera.position.y = EYE_HEIGHT;

    // Direção do olhar
    _camera.lookAt(new THREE.Vector3(
      _camera.position.x + Math.sin(yaw)  * Math.cos(pitch),
      _camera.position.y + Math.sin(pitch),
      _camera.position.z + Math.cos(yaw)  * Math.cos(pitch)
    ));

    // Forçar re-render do BP3D
    _controls.needsUpdate = true;
  }

  // ─── Pointer lock helpers ─────────────────────────────────────────────────────
  function getCanvas() {
    // O canvas do Three.js fica dentro do #viewer
    return document.querySelector('#viewer canvas');
  }

  function requestLock() {
    const el = getCanvas();
    if (!el) return;
    (el.requestPointerLock || el.mozRequestPointerLock || el.webkitRequestPointerLock
      || (() => {})).call(el);
  }

  function releaseLock() {
    (document.exitPointerLock || document.mozExitPointerLock
      || document.webkitExitPointerLock || (() => {})).call(document);
  }

  function isLocked() {
    const el = getCanvas();
    return el && (document.pointerLockElement === el
               || document.mozPointerLockElement === el
               || document.webkitPointerLockElement === el);
  }

  // ─── Entrar / sair ───────────────────────────────────────────────────────────
  function enterWalk() {
    if (!getRefs()) {
      alert('O viewer 3D ainda não está pronto. Acesse a aba "Design" primeiro.');
      return;
    }

    active = true;
    buildGeometry();

    // Posicionar no centro da planta
    const center = _floorplan.getCenter();
    _camera.position.set(center.x, EYE_HEIGHT, center.z);
    yaw = 0; pitch = 0;

    // Desabilitar orbit controls
    _controls.enabled = false;
    _controls.noKeys  = true;

    requestLock();

    document.getElementById('hb-walk-btn').style.background = '#5bc0de';
    document.getElementById('hb-crosshair').style.display   = 'block';
    document.getElementById('hb-walk-hint').style.display   = 'block';

    document.addEventListener('pointerlockchange',    onLockChange, false);
    document.addEventListener('mozpointerlockchange', onLockChange, false);
    document.addEventListener('mousemove', onMouseMove, false);
    document.addEventListener('keydown',   onKeyDown,   false);
    document.addEventListener('keyup',     onKeyUp,     false);

    rafId = requestAnimationFrame(loop);
  }

  function exitWalk() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);
    releaseLock();

    if (_controls) { _controls.enabled = true; _controls.noKeys = false; }
    _three?.centerCamera();

    const btn = document.getElementById('hb-walk-btn');
    if (btn) btn.style.background = '';
    const ch = document.getElementById('hb-crosshair');
    if (ch) ch.style.display = 'none';
    const hint = document.getElementById('hb-walk-hint');
    if (hint) hint.style.display = 'none';

    document.removeEventListener('pointerlockchange',    onLockChange, false);
    document.removeEventListener('mozpointerlockchange', onLockChange, false);
    document.removeEventListener('mousemove', onMouseMove, false);
    document.removeEventListener('keydown',   onKeyDown,   false);
    document.removeEventListener('keyup',     onKeyUp,     false);

    if (_controls) _controls.needsUpdate = true;
  }

  function toggleWalk() { active ? exitWalk() : enterWalk(); }

  // ─── Handlers ────────────────────────────────────────────────────────────────
  function onMouseMove(e) {
    if (!active || !isLocked()) return;
    yaw   -= (e.movementX || e.mozMovementX || 0) * LOOK_SENS;
    pitch -= (e.movementY || e.mozMovementY || 0) * LOOK_SENS;
    pitch  = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
  }

  function onKeyDown(e) {
    if (!active) return;
    keys[e.code] = true;
    if (e.code === 'Escape') { exitWalk(); return; }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) { keys[e.code] = false; }

  function onLockChange() {
    // Se o pointer lock foi perdido externamente (ESC do browser), sair
    if (!isLocked() && active) exitWalk();
  }

  // ─── UI: botão, crosshair, hint ───────────────────────────────────────────────
  function injectUI() {
    if (document.getElementById('hb-walk-btn')) return;

    const cameraControls = document.getElementById('camera-controls');
    if (!cameraControls) return; // viewer ainda não está visível

    // Botão
    const btn = document.createElement('a');
    btn.id        = 'hb-walk-btn';
    btn.href      = '#';
    btn.className = 'btn btn-default bottom';
    btn.title     = 'Modo Primeira Pessoa  W A S D + Mouse';
    btn.style.cssText = 'margin-left:10px;font-size:15px;line-height:1;';
    btn.textContent = '🚶';
    btn.addEventListener('click', e => { e.preventDefault(); toggleWalk(); });
    cameraControls.appendChild(btn);

    // Crosshair SVG
    const ch = document.createElement('div');
    ch.id = 'hb-crosshair';
    ch.style.cssText = `
      display:none; position:fixed; top:50%; left:50%;
      transform:translate(-50%,-50%); pointer-events:none; z-index:9999;
      width:24px; height:24px;`;
    ch.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <line x1="12" y1="3"  x2="12" y2="21" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/>
      <line x1="3"  y1="12" x2="21" y2="12" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/>
    </svg>`;
    document.body.appendChild(ch);

    // Barra de hint
    const hint = document.createElement('div');
    hint.id = 'hb-walk-hint';
    hint.style.cssText = `
      display:none; position:fixed; bottom:22px; left:50%;
      transform:translateX(-50%);
      background:rgba(0,0,0,.65); color:#fff; padding:7px 20px;
      border-radius:20px; font:13px/1.5 system-ui,sans-serif;
      pointer-events:none; z-index:9999;`;
    hint.innerHTML = `W&nbsp;A&nbsp;S&nbsp;D &nbsp;·&nbsp; Mouse para olhar
      &nbsp;·&nbsp; <kbd style="background:#333;border-radius:4px;padding:1px 6px;font:inherit">ESC</kbd> para sair`;
    document.body.appendChild(hint);
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  // Injetar botão quando a aba Design aparecer (clique ou já visível)
  function tryInjectUI() {
    // O #viewer só está visível quando a aba Design está ativa
    const viewer = document.getElementById('viewer');
    if (viewer && viewer.style.display !== 'none' && viewer.offsetParent !== null) {
      injectUI();
    }
  }

  // Observar quando #camera-controls aparecer e injetar botão
  function watchViewer() {
    // #camera-controls sempre existe no DOM; o botão fica oculto junto com #viewer
    const cc = document.getElementById('camera-controls');
    if (!cc) { setTimeout(watchViewer, 150); return; }

    injectUI(); // injeta imediatamente (antes mesmo de ter instância BP3D)

    // Observar mudanças de display no #viewer para garantir injeção
    const viewer = document.getElementById('viewer');
    if (viewer) {
      new MutationObserver(() => {
        if (!document.getElementById('hb-walk-btn')) injectUI();
      }).observe(viewer, { attributes: true, attributeFilter: ['style'] });
    }

    // Reagir a cliques nas tabs
    document.addEventListener('click', e => {
      if (e.target.closest('#design_tab') || e.target.closest('#update-floorplan')) {
        setTimeout(() => {
          if (!document.getElementById('hb-walk-btn')) injectUI();
        }, 350);
      }
    });
  }

  // Aguardar o DOM estar pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchViewer);
  } else {
    watchViewer();
  }

  // Expor API global para o bridge usar
  window.homeBuilderWalk = { enterWalk, exitWalk, toggleWalk };

})();
