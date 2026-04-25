import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'https://esm.sh/three@0.160.0/examples/jsm/utils/SkeletonUtils.js';
import {
  buildAlienMesh, buildPropMesh, buildBuildingMesh,
  buildLobbyRoom, buildMissionRoom, buildGantzBallMesh,
  buildGantzBallDisplay, animateAlienMesh, buildWeatherGroup,
} from './factories.js';
import { createScanController } from './transferScan.js';

// Convert 2D game facing angle to Three.js Y rotation.
// In 2D: facing=0 points +X. Both human and alien meshes face +Z natively,
// so rotation.y = π/2 - facing maps game facing correctly onto the mesh:
//   facing=0  (+X game) → rot=+π/2 → mesh points +X ✓
//   facing=π/2 (+Y game = +Z 3D) → rot=0  → mesh points +Z ✓
function facingToRotY(f) { return Math.PI / 2 - f; }

function disposeGroup(group) {
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose && m.dispose());
      else o.material.dispose && o.material.dispose();
    }
  });
}

// Creates a chat speech bubble sprite above the player's head.
function makeChatBubble(text) {
  const MAX_CHARS = 40;
  const display = String(text || '').slice(0, MAX_CHARS) + (text.length > MAX_CHARS ? '…' : '');
  const FONT = 'bold 18px ui-monospace,Menlo,Consolas,monospace';

  // Measure text width
  const measurer = document.createElement('canvas').getContext('2d');
  measurer.font = FONT;
  const textW = measurer.measureText(display).width;

  const PAD = 14;
  const TRI = 8; // pointer triangle height
  const CW = Math.max(120, textW + PAD * 2);
  const CH = 44 + TRI;

  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const ctx = c.getContext('2d');

  // Bubble body
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.roundRect(0, 0, CW, CH - TRI, 8);
  ctx.fill();

  // Pointer triangle (centered at bottom)
  ctx.beginPath();
  ctx.moveTo(CW / 2 - 8, CH - TRI);
  ctx.lineTo(CW / 2 + 8, CH - TRI);
  ctx.lineTo(CW / 2, CH);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.font = FONT;
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(display, CW / 2, (CH - TRI) / 2);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // Scale in world units — keep aspect ratio
  const worldH = 0.28;
  sprite.scale.set((CW / CH) * worldH, worldH, 1);
  sprite.position.set(0, 2.55, 0);
  sprite.userData.isChatBubble = true;
  return sprite;
}

// Creates a billboard sprite with the player's name drawn on a canvas texture.
function makeNameLabel(text, hexColor) {
  const label = String(text || '?').slice(0, 18);
  const font = 'bold 20px ui-monospace,Menlo,Consolas,monospace';

  // Measure actual text width so the pill hugs the name instead of spanning
  // a fixed 256-pixel canvas. Use an offscreen context just for measurement.
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const textW = Math.max(20, Math.ceil(meas.measureText(label).width));

  const pad = 5;         // transparent margin so the pill isn't flush to the edge
  const padX = 14;       // horizontal padding INSIDE the pill
  const CH = 52;         // fixed height keeps world-space vertical scale constant
  const CW = textW + (pad + padX) * 2;

  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const ctx = c.getContext('2d');

  // Pill background — sized to the measured text, not the canvas width.
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.beginPath();
  ctx.roundRect(pad, pad, CW - pad * 2, CH - pad * 2, 8);
  ctx.fill();

  // Name text
  const color = hexColor ? '#' + hexColor.replace('#', '') : '#00e05a';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(label, CW / 2, CH / 2);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // World-space size scales the X with canvas width to keep the text readable
  // at a consistent pixels-per-metre density regardless of name length.
  const PX_PER_M = 256 / 1.1;          // prior constant (256-wide → 1.1m)
  sprite.scale.set(CW / PX_PER_M, CH / PX_PER_M, 1);
  sprite.position.set(0, 2.15, 0);     // above head in group-local space
  sprite.userData.isNameLabel = true;
  return sprite;
}

export function createScene3d({ canvas }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050a);
  scene.fog = new THREE.Fog(0x04050a, 300, 1200);

  const EYE_HEIGHT = 1.7;

  let _fpFov = 72;
  const camera = new THREE.PerspectiveCamera(_fpFov, canvas.clientWidth / canvas.clientHeight, 0.3, 4000);
  camera.position.set(0, 10, 8);

  // First-person weapon view model (parented to the camera). Only visible in FP.
  // FPS viewmodel placement (camera space, vertical FOV=72°):
  // At z=-0.55: screen half-height≈0.40m, screen half-width≈0.71m (16:9).
  // x=+0.48 → gun centre ≈ 84% right; y=-0.31 → grip near/below bottom edge.
  // Grip clips off-screen bottom-right; barrel faces upper-center — CS:GO style.
  const viewWeapon = new THREE.Group();
  viewWeapon.position.set(0.46, -0.38, -0.55);

  // Muzzle flash — bright blue point light at the barrel tip.
  // Position calibrated from ADS crosshair alignment work.
  // Layer reserved for the viewmodel + its lights. Lights on this layer only
  // illuminate objects that also enable this layer — so viewmodel lights stay
  // on the gun and cannot spill onto walls/characters, even at close range.
  const VIEWMODEL_LAYER = 2;
  // Two-pass render strategy:
  //   Pass 1: camera.layers = {0}   → scene only (viewmodel skipped, vm lights skipped)
  //   Pass 2: camera.layers = {2}   → viewmodel only, lit only by vm lights
  // This is the only reliable way in Three.js to keep muzzle flash light off
  // walls — per-object light layer filtering inside a single pass isn't honored
  // consistently, but splitting the passes cleanly isolates the light sets.

  const MUZZLE_TIP = { x: -0.188, y: 0.24, z: -0.12 };
  const muzzleLight = new THREE.PointLight(0x44aaff, 0, 2.5, 2);
  muzzleLight.position.set(MUZZLE_TIP.x, MUZZLE_TIP.y, MUZZLE_TIP.z);
  muzzleLight.layers.set(VIEWMODEL_LAYER);
  viewWeapon.add(muzzleLight);

  // Separate invisible anchor used as the bullet spawn point. `MUZZLE_TIP`
  // was calibrated for ADS crosshair alignment, which puts it slightly off
  // the visible barrel end — bullets spawning there look like they come
  // "from the gun's neighborhood" rather than straight out of the barrel.
  // This anchor sits right at the barrel tip.
  const _barrelTip = new THREE.Object3D();
  _barrelTip.position.set(MUZZLE_TIP.x, MUZZLE_TIP.y + 0.04, MUZZLE_TIP.z + 0.65);
  viewWeapon.add(_barrelTip);

  // Viewmodel-only lights — parented to viewWeapon so they move with the gun.
  // Short range (≤1m) means they light the gun but don't reach scene characters.
  const _vmKeyLight  = new THREE.PointLight(0xffffff, 2.2, 0.9, 1.5); // upper-left key
  _vmKeyLight.position.set(-0.3, 0.35, 0.0);
  _vmKeyLight.layers.set(VIEWMODEL_LAYER);
  viewWeapon.add(_vmKeyLight);
  const _vmFillLight = new THREE.PointLight(0x8899cc, 1.2, 0.8, 2);   // cool blue fill, upper-left
  _vmFillLight.position.set(-0.2, 0.15, -0.1);
  _vmFillLight.layers.set(VIEWMODEL_LAYER);
  viewWeapon.add(_vmFillLight);
  const _vmRimLight  = new THREE.PointLight(0xffffff, 1.0, 0.7, 2);   // rim/back highlight
  _vmRimLight.position.set(0.0, 0.2, 0.4);
  _vmRimLight.layers.set(VIEWMODEL_LAYER);
  viewWeapon.add(_vmRimLight);

  // X-Gun materials.
  // GLB material names: M_01_base_negra (body), M_01_luz (lights), craneo_pantalla (screen).
  // Body: full PBR texture set (colour/normal/metalness/roughness/ao).
  // Accents/screen: MeshBasicMaterial (unlit) so they always glow.
  const _xgunAccentMat = new THREE.MeshBasicMaterial({ color: 0x003577 }); // dark steel blue
  const _ACCENT_KEYS   = ['luz'];
  const _SCREEN_KEYS   = ['pantalla', 'craneo'];

  // ── Gantz HUD screen (canvas texture, updated every frame) ───────────────
  const _scrW = 256, _scrH = 128;
  const _scrCanvas = document.createElement('canvas');
  _scrCanvas.width = _scrW; _scrCanvas.height = _scrH;
  const _scrCtx = _scrCanvas.getContext('2d');
  const _scrTex  = new THREE.CanvasTexture(_scrCanvas);
  const _xgunScreenMat = new THREE.MeshBasicMaterial({ map: _scrTex, side: THREE.DoubleSide });
  let _scrTime = 0;

  // Weapon id → short display name
  const _WNAMES = { xgun:'X-GUN', xshot:'X-SHOT', xsword:'X-SWD', xsniper:'SNPR', ygun:'Y-GUN' };
  // Glitch char pool
  const _GLITCH_CHARS = '▓░█▒#@%&?!';
  let _glitchTimer = 0;     // counts down to next glitch burst
  let _glitchActive = 0;    // frames remaining in current burst

  function _drawGantzScreen(dt, state) {
    _scrTime += dt;
    const t  = _scrTime;
    const ctx = _scrCtx;

    // ── Safe draw region (derived from mesh UV bounds) ──────────────────────
    // UV: U 0.204–0.839, V 0.743–0.982  →  canvas px (256×128, flipY)
    const SX0 = 59, SX1 = 211, SW = SX1 - SX0;   // 152 px wide
    const SY0 =  4, SY1 =  31, SH = SY1 - SY0;   //  27 px tall

    // ── Glitch timing ────────────────────────────────────────────────────────
    _glitchTimer -= dt;
    if (_glitchTimer <= 0) {
      _glitchActive = 3 + Math.random() * 4; // 3–7 frames of glitch
      _glitchTimer  = 4 + Math.random() * 6; // next burst in 4–10 s
    }
    const glitching = _glitchActive > 0;
    if (glitching) _glitchActive -= 1;
    const gc = () => _GLITCH_CHARS[Math.random() * _GLITCH_CHARS.length | 0];

    // Clear to black outside safe zone
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, _scrW, _scrH);

    // Panel background
    ctx.fillStyle = '#03111e';
    ctx.fillRect(SX0, SY0, SW, SH);

    // Scan lines (every 3 px, subtle)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = SY0; y < SY1; y += 3) ctx.fillRect(SX0, y, SW, 1);

    // ── Sweep line ───────────────────────────────────────────────────────────
    // Cycles top→bottom every 3 s, then resets
    const sweepPeriod = 3.0;
    const sweepPos = (t % sweepPeriod) / sweepPeriod; // 0→1
    const sweepY   = SY0 + sweepPos * SH;
    const sweepGrad = ctx.createLinearGradient(0, sweepY - 4, 0, sweepY + 4);
    sweepGrad.addColorStop(0,   'rgba(0,212,255,0)');
    sweepGrad.addColorStop(0.5, 'rgba(0,212,255,0.35)');
    sweepGrad.addColorStop(1,   'rgba(0,212,255,0)');
    ctx.fillStyle = sweepGrad;
    ctx.fillRect(SX0, sweepY - 4, SW, 8);

    // ── Outer border — neon glow ─────────────────────────────────────────────
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.save();
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur  = 6;
    ctx.strokeStyle = `rgba(0,212,255,${0.55 + 0.25 * pulse})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(SX0 + 0.5, SY0 + 0.5, SW - 1, SH - 1);
    ctx.restore();

    // Inner inset line
    ctx.strokeStyle = 'rgba(0,212,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(SX0 + 2.5, SY0 + 2.5, SW - 5, SH - 5);

    // Corner ticks
    const TL = 5;
    ctx.save();
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur  = 4;
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 1.2;
    [[SX0,SY0,1,1],[SX1,SY0,-1,1],[SX0,SY1,1,-1],[SX1,SY1,-1,-1]].forEach(([cx,cy,sx,sy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx*TL, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy*TL);
      ctx.stroke();
    });
    ctx.restore();

    // ── Three data columns ───────────────────────────────────────────────────
    const D1 = SX0 + SW * 0.333 | 0;
    const D2 = SX0 + SW * 0.667 | 0;
    ctx.strokeStyle = 'rgba(0,212,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(D1, SY0 + 3); ctx.lineTo(D1, SY1 - 3);
    ctx.moveTo(D2, SY0 + 3); ctx.lineTo(D2, SY1 - 3);
    ctx.stroke();

    const C1x   = SX0 + SW * 0.167 | 0;
    const C2x   = SX0 + SW * 0.500 | 0;
    const C3x   = SX0 + SW * 0.833 | 0;
    const labelY = SY0 + 10;
    const valueY = SY1 - 4;

    // Live data
    const alienCount  = (state?.aliens?.length ?? 0);
    const points      = (state?.player?.points  ?? 0);
    const wid         = state?.player?.loadout?.weapon1 || 'xgun';
    const weaponLabel = _WNAMES[wid] || wid.toUpperCase().slice(0,5);

    // Alien count colour — red pulse on last target
    const oneLeft   = alienCount === 1 && state?.phase === 'MISSION';
    const targetClr = oneLeft ? `rgba(255,60,60,${0.7 + 0.3 * pulse})` : '#00d4ff';

    ctx.textAlign = 'center';

    // Column labels — neon glow
    ctx.save();
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur  = 5;
    ctx.font = '7px monospace';
    ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(0,212,255,0.75)';
    ctx.fillText('TARGETS', C1x, labelY);
    ctx.fillText('POINTS',  C2x, labelY);
    ctx.fillText('WEAPON',  C3x, labelY);
    ctx.restore();

    // Column values — brighter glow + optional glitch
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.letterSpacing = '2px';

    // TARGETS
    ctx.shadowColor = oneLeft ? '#ff3c3c' : '#00d4ff';
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = targetClr;
    const tgtStr = glitching
      ? gc() + (Math.random() < 0.5 ? gc() : String(alienCount).padStart(2,'0')[1])
      : String(alienCount).padStart(2, '0');
    ctx.fillText(tgtStr, C1x, valueY);

    // POINTS
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = '#00d4ff';
    const ptStr = glitching && Math.random() < 0.4
      ? String(points).slice(0,-1) + gc()
      : String(points);
    ctx.fillText(ptStr, C2x, valueY);

    // WEAPON
    const wpStr = glitching && Math.random() < 0.3
      ? weaponLabel.slice(0,-1) + gc()
      : weaponLabel;
    ctx.fillText(wpStr, C3x, valueY);

    ctx.restore();
    ctx.letterSpacing = '0px';

    // Blinking "alive" dot — bottom-left corner
    const dotAlpha = 0.4 + 0.6 * ((Math.floor(t * 1.5) % 2 === 0) ? 1 : 0);
    ctx.fillStyle = `rgba(0,212,255,${dotAlpha})`;
    ctx.beginPath();
    ctx.arc(SX0 + 4, SY1 - 4, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    _scrTex.needsUpdate = true;
  }
  // These accent meshes were visually identified and removed (wrong placement on model).
  const _HIDDEN_MESHES = new Set(['Object_24', 'Object_26', 'Object_27']);

  // Load PBR textures for the body then build the material.
  const _tl = new THREE.TextureLoader();
  const _xgunBodyMat = new THREE.MeshStandardMaterial({
    color:    0x141518,   // dark tint over the colour map
    metalness: 1.0,       // driven fully by metalnessMap
    roughness: 1.0,       // driven fully by roughnessMap
    aoMapIntensity: 2.5,
  });
  Promise.all([
    _tl.loadAsync('assets/models/gun_color.jpg'),
    _tl.loadAsync('assets/models/gun_normal.png'),
    _tl.loadAsync('assets/models/gun_metalness.jpg'),
    _tl.loadAsync('assets/models/gun_roughness.jpg'),
    _tl.loadAsync('assets/models/gun_ao.jpg'),
  ]).then(([colorMap, normalMap, metalnessMap, roughnessMap, aoMap]) => {
    for (const t of [colorMap, normalMap, metalnessMap, roughnessMap, aoMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1, 1);
    }
    _xgunBodyMat.map          = colorMap;
    _xgunBodyMat.normalMap    = normalMap;
    _xgunBodyMat.metalnessMap = metalnessMap;
    _xgunBodyMat.roughnessMap = roughnessMap;
    _xgunBodyMat.aoMap        = aoMap;
    _xgunBodyMat.needsUpdate  = true;
  });


  new GLTFLoader().load('assets/models/x_gun_gantz.glb', gltf => {
    try {
      const gun = gltf.scene;
      // Compute bbox at natural scale/rotation to find geometry centre & size.
      gun.scale.setScalar(1);
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
      gun.updateMatrixWorld(true);
      const _b  = new THREE.Box3().setFromObject(gun);
      const _ct = _b.getCenter(new THREE.Vector3());
      const _sz = _b.getSize(new THREE.Vector3());
      const _md = Math.max(_sz.x, _sz.y, _sz.z);
      const _s  = _md > 0 ? 0.32 / _md : 1;
      // Translate geometry vertices so centre is at origin (avoids position+rotation interaction).
      gun.traverse(node => {
        if (!node.isMesh || !node.geometry) return;
        node.geometry = node.geometry.clone();
        node.geometry.translate(-_ct.x, -_ct.y, -_ct.z);
        node.frustumCulled = false;
        // Read original GLB material name before replacing it.
        if (_HIDDEN_MESHES.has(node.name)) { node.visible = false; return; }
        const matName = (node.material?.name || '').toLowerCase();
        if (_ACCENT_KEYS.some(k => matName.includes(k)))       node.material = _xgunAccentMat;
        else if (_SCREEN_KEYS.some(k => matName.includes(k)))  node.material = _xgunScreenMat;
        else                                                    node.material = _xgunBodyMat;
      });
      gun.scale.setScalar(_s);
      // Clone the gun BEFORE applying viewmodel-specific rotation.
      // This template (scale=_s, no rotation, geometry centred) is used to attach
      // the X-Gun to character hand bones in world space.
      _worldGunScale = _s;
      _worldGunTemplate = gun.clone(true);

      gun.position.set(0, 0, 0); // centre is now at origin — no offset needed
      // Barrel forward (-Z), grip hangs bottom-right. Roll slight CW so top of gun faces left.
      gun.rotation.set(0.10, -Math.PI / 2 + 0.35, -0.20);
      gun.frustumCulled = false;
      console.log(`[scene3d] X-Gun size: ${_sz.x.toFixed(2)}x${_sz.y.toFixed(2)}x${_sz.z.toFixed(2)} scale:${_s.toFixed(3)} ctr:${_ct.x.toFixed(2)},${_ct.y.toFixed(2)},${_ct.z.toFixed(2)}`);
      viewWeapon.add(gun);
      // Store barrel panel refs for animation (traverse after add so full tree is reachable).
      // Move every viewmodel descendant onto VIEWMODEL_LAYER exclusively so the
      // main render pass (camera on layer 0) skips them, and the second pass
      // (camera on layer 2) draws them lit only by the viewmodel lights.
      viewWeapon.traverse(n => {
        n.layers.set(VIEWMODEL_LAYER);
        if (n.name === 'Object_7') _panelL = n;
        if (n.name === 'Object_8') _panelR = n;
        if (n.name === 'Object_6') _panelB = n;
      });
      console.log('[scene3d] barrel panels:', !!_panelL, !!_panelR, !!_panelB);
      // Pre-warm gun shaders so first render is instant. Gun meshes live on
      // VIEWMODEL_LAYER only, so temporarily enable layer 2 on the camera so
      // compile() can see and compile them, then restore.
      camera.layers.enable(VIEWMODEL_LAYER);
      renderer.compile(scene, camera);
      camera.layers.set(0);
    } catch (e) {
      console.error('[scene3d] X-Gun setup error:', e);
    }
  }, undefined, err => {
    console.warn('[scene3d] X-Gun GLB failed to load:', err);
  });

  camera.add(viewWeapon);
  scene.add(camera); // camera must be in scene graph for child meshes to render
  viewWeapon.visible = false;

  // ── Barrel panel references (populated after GLB loads) ──────────────────
  let _panelL = null;  // Object_7 — left panel
  let _panelR = null;  // Object_8 — right panel
  let _panelB = null;  // Object_6 — bottom panel
  let _barrelExtend = 0; // 0=closed, spikes to 1 on fire, spring-decays back

  // ── ADS (Aim Down Sights) ─────────────────────────────────────────────────
  let _adsActive = false;
  let _adsT = 0; // 0 = hip fire, 1 = fully ADS (smoothstepped)
  canvas.addEventListener('mousedown', e => { if (e.button === 2) _adsActive = true; });
  canvas.addEventListener('mouseup',   e => { if (e.button === 2) _adsActive = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;

  // Dim global lights so per-room lighting dominates (warm apartment bulb in the
  // lobby, street/moon in the mission). Rooms add their own key/fill lights.
  const ambient = new THREE.AmbientLight(0x554a42, 0.9);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xe8eaff, 0.9);
  key.position.set(10, 22, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -22; key.shadow.camera.right = 22;
  key.shadow.camera.top = 22; key.shadow.camera.bottom = -22;
  key.shadow.camera.near = 1; key.shadow.camera.far = 60;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const hemi = new THREE.HemisphereLight(0x3a3832, 0x1a1712, 0.55);
  scene.add(hemi);

  // Set to false to revert to the procedural lobby room.
  const USE_GLB_LOBBY = true;
  // Uniform scale applied to the GLB room — increase to make the space feel larger.
  const GLB_ROOM_SCALE  = 1.2;
  // Extra downward shift so the GLB floor aligns with Y=0.
  // The exterior geometry sits below the floor and pulls the bbox min lower than the actual floor surface.
  const GLB_ROOM_Y_OFFSET = 0.25;
  // Shift the room along Z (negative = forward toward the player's default view).
  const GLB_ROOM_Z_OFFSET = 1.9;
  const GLB_ROOM_X_OFFSET = 0.2;

  // Room switching
  let currentRoomKind = null;
  // Increments once per lightning strike start in thunderstorm weather. Game
  // code polls this to fire one-shot thunder SFX on the transition.
  let _lightningStrikeCount = 0;
  let currentRoomSeed = null;
  let currentRoomGroup = null;
  const buildingMeshes  = new Map();
  const _devZoneMeshes  = new Map(); // devId → { mesh, mat, lastW, lastH, lastD }
  const _cityObjects    = new Map(); // id → { mesh: THREE.Group, placement }
  const _cityGltfCache  = new Map(); // url → loaded gltf.scene (template)
  let _cityIdCounter    = 0;
  let _citySelBox       = null;      // THREE.BoxHelper for selected city object
  let _citySelId        = null;

  // ── Fly cam ────────────────────────────────────────────────────────────────
  let _flyCamActive  = false;
  const _flyCamPos   = new THREE.Vector3();
  let _flyCamYaw     = 0;
  let _flyCamPitch   = 0;
  let _flyCamSpeed   = 20;
  const _flyCamKeys  = new Set();
  let _fcListenersAdded = false;
  // ── City drag ──────────────────────────────────────────────────────────────
  const _cityDragRay    = new THREE.Raycaster();
  const _cityDragPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _cityDragPt     = new THREE.Vector3();
  const _cityDragOffset = new THREE.Vector3();
  let _cityDragId       = null;
  let _cityOnDragSelect = null;  // (id) set by devMode
  let _cityOnDragEnd    = null;  // (id) set by devMode

  // ── City builder / fly cam private helpers ─────────────────────────────────
  function _citySetSel(id) {
    if (_citySelBox) { scene.remove(_citySelBox); _citySelBox.geometry.dispose(); _citySelBox.material.dispose(); _citySelBox = null; }
    _citySelId = id;
    if (!id) return;
    const entry = _cityObjects.get(id);
    if (!entry) return;
    _citySelBox = new THREE.BoxHelper(entry.mesh, 0x00ff88);
    scene.add(_citySelBox);
  }


  function _flyCamTick(dt) {
    const spd = _flyCamSpeed * dt;
    const cy = Math.cos(_flyCamYaw), sy = Math.sin(_flyCamYaw);
    const cp = Math.cos(_flyCamPitch), sp = Math.sin(_flyCamPitch);
    const fx = -sy * cp, fy = sp, fz = -cy * cp; // forward (pitch-aware)
    const rx = cy,                 rz = -sy;      // right (horizontal)
    if (_flyCamKeys.has('w')) { _flyCamPos.x += fx*spd; _flyCamPos.y += fy*spd; _flyCamPos.z += fz*spd; }
    if (_flyCamKeys.has('s')) { _flyCamPos.x -= fx*spd; _flyCamPos.y -= fy*spd; _flyCamPos.z -= fz*spd; }
    if (_flyCamKeys.has('a')) { _flyCamPos.x -= rx*spd; _flyCamPos.z -= rz*spd; }
    if (_flyCamKeys.has('d')) { _flyCamPos.x += rx*spd; _flyCamPos.z += rz*spd; }
    if (_flyCamKeys.has('q') || _flyCamKeys.has(' '))      _flyCamPos.y += spd;
    if (_flyCamKeys.has('e') || _flyCamKeys.has('shift'))  _flyCamPos.y -= spd;
  }

  function _ensureFcListeners() {
    if (_fcListenersAdded) return;
    _fcListenersAdded = true;
    window.addEventListener('keydown', e => { if (_flyCamActive) _flyCamKeys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup',   e => { _flyCamKeys.delete(e.key.toLowerCase()); });
    const cnv = renderer.domElement;
    cnv.addEventListener('mousedown', e => {
      if (!_flyCamActive || document.pointerLockElement || e.button !== 0) return;
      const rect = cnv.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      const ndcY = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
      _cityDragRay.setFromCamera({ x: ndcX, y: ndcY }, camera);
      let bestId = null, bestDist = Infinity;
      const tmpBox = new THREE.Box3(), tmpPt = new THREE.Vector3();
      for (const [id, entry] of _cityObjects) {
        tmpBox.setFromObject(entry.mesh);
        if (tmpBox.isEmpty()) continue;
        if (_cityDragRay.ray.intersectBox(tmpBox, tmpPt)) {
          const d = camera.position.distanceTo(tmpPt);
          if (d < bestDist) { bestDist = d; bestId = id; }
        }
      }
      if (!bestId) return;
      const ent = _cityObjects.get(bestId);
      _cityDragPlane.constant = -ent.placement.y;
      _cityDragRay.ray.intersectPlane(_cityDragPlane, _cityDragPt);
      _cityDragOffset.set(ent.placement.x - _cityDragPt.x, 0, ent.placement.z - _cityDragPt.z);
      _cityDragId = bestId;
      _citySetSel(bestId);
      if (_cityOnDragSelect) _cityOnDragSelect(bestId);
    });
    cnv.addEventListener('mousemove', e => {
      if (!_flyCamActive || document.pointerLockElement) { cnv.style.cursor = ''; return; }
      const rect = cnv.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      const ndcY = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
      _cityDragRay.setFromCamera({ x: ndcX, y: ndcY }, camera);
      if (_cityDragId) {
        if (_cityDragRay.ray.intersectPlane(_cityDragPlane, _cityDragPt)) {
          const ent = _cityObjects.get(_cityDragId);
          if (ent) {
            const nx = _cityDragPt.x + _cityDragOffset.x;
            const nz = _cityDragPt.z + _cityDragOffset.z;
            ent.mesh.position.x = nx; ent.mesh.position.z = nz;
            ent.placement.x = nx;     ent.placement.z = nz;
            if (_citySelBox) _citySelBox.update();
          }
        }
        cnv.style.cursor = 'grabbing';
      } else {
        const tmpBox = new THREE.Box3();
        let hit = false;
        for (const [, ent] of _cityObjects) {
          tmpBox.setFromObject(ent.mesh);
          if (!tmpBox.isEmpty() && _cityDragRay.ray.intersectsBox(tmpBox)) { hit = true; break; }
        }
        cnv.style.cursor = hit ? 'grab' : '';
      }
    });
    window.addEventListener('mouseup', e => {
      if (e.button !== 0 || !_cityDragId) return;
      const id = _cityDragId;
      _cityDragId = null;
      renderer.domElement.style.cursor = '';
      if (_cityOnDragEnd) _cityOnDragEnd(id);
    });
    // Scroll wheel adjusts fly speed while pointer is locked
    cnv.addEventListener('wheel', e => {
      if (!_flyCamActive || !document.pointerLockElement) return;
      e.preventDefault();
      _flyCamSpeed = Math.max(1, Math.min(500, _flyCamSpeed * (e.deltaY > 0 ? 0.85 : 1 / 0.85)));
    }, { passive: false });
  }

  function clearRoom() {
    if (currentRoomGroup) {
      scene.remove(currentRoomGroup);
      disposeGroup(currentRoomGroup);
      currentRoomGroup = null;
    }
    for (const [id, m] of buildingMeshes) {
      scene.remove(m);
      disposeGroup(m);
    }
    buildingMeshes.clear();
    // Blood / gib particles are scene-level and outlive the room group, so
    // returning to the lobby after a mission would otherwise leave splats and
    // mist on the lobby floor. Purge them here.
    for (const g of _gibs) {
      scene.remove(g.mesh);
      if (g.mesh.geometry && !g.mesh.geometry._shared) g.mesh.geometry.dispose?.();
      g.mat?.dispose?.();
    }
    _gibs.length = 0;
    for (const sp of _gibSplats) {
      scene.remove(sp.mesh);
      sp.mat?.dispose?.();
    }
    _gibSplats.length = 0;
    // Active bullets likewise belong to the room they were fired in.
    for (const b of bullets) {
      scene.remove(b.mesh);
      if (b.light) scene.remove(b.light);
    }
    bullets.length = 0;
  }

  function setRoom(kind, missionMap, lobbySeed) {
    clearRoom();
    currentRoomKind = kind;
    // City builder buildings are lobby-only — hide them in missions
    const cityInLobby = kind === 'lobby';
    for (const entry of _cityObjects.values()) entry.mesh.visible = cityInLobby;
    if (_citySelBox) _citySelBox.visible = cityInLobby;
    currentRoomSeed = missionMap?._seed ?? null;
    if (kind === 'lobby') {
      currentRoomGroup = buildLobbyRoom(lobbySeed || 0);
      if (USE_GLB_LOBBY) {
        // Async-load the GLB room. Capture the group reference so a phase
        // transition that clears the room before load finishes is a no-op.
        const targetGroup = currentRoomGroup;
        new GLTFLoader().load('assets/models/gantz_room.glb', gltf => {
          if (targetGroup !== currentRoomGroup) return;
          const root = gltf.scene;
          root.scale.setScalar(GLB_ROOM_SCALE);
          // Fix perfectly-smooth interior material (roughness=0 → looks mirror-like without envmap).
          root.traverse(n => {
            if (!n.isMesh) return;
            const mats = Array.isArray(n.material) ? n.material : [n.material];
            for (const m of mats) { if (m.roughness < 0.1) m.roughness = 0.5; }
          });
          // Model was authored Z-up (3ds Max): Y is room depth, Z is height.
          // Rotate -90° around X to map Z-up → Y-up so the room stands correctly.
          const _b0 = new THREE.Box3().setFromObject(root);
          const _s0 = _b0.getSize(new THREE.Vector3());
          if (_s0.y > _s0.z) root.rotation.x = -Math.PI / 2;
          // Center at origin, floor at Y=0.
          root.updateMatrixWorld(true);
          const box  = new THREE.Box3().setFromObject(root);
          const cent = box.getCenter(new THREE.Vector3());
          root.position.x -= cent.x - GLB_ROOM_X_OFFSET;
          root.position.z -= cent.z;
          root.position.y -= box.min.y + GLB_ROOM_Y_OFFSET;
          root.position.z += GLB_ROOM_Z_OFFSET;
          targetGroup.add(root);
          _tpCollidableKey = ''; // GLB meshes now in group — force TP raycaster rebuild
          // Interior lighting — added to the room group so they auto-clear on phase change.
          // Extra ambient lift: the GLB has baked textures that need more base light.
          targetGroup.add(new THREE.AmbientLight(0xfff6e8, 1.8));
          // Ceiling fill lights spread along the room depth.
          const _ceilY = box.max.y - 0.3;
          for (const [lx, lz] of [[-1.5, -5], [1.5, 0], [-1.5, 5]]) {
            const _pl = new THREE.PointLight(0xfff5d0, 3.5, 14, 2);
            _pl.position.set(lx, _ceilY, lz);
            targetGroup.add(_pl);
          }
          // Ceiling lamp directly above the Gantz ball (3D: x=0, z=-4).
          {
            const lg = new THREE.Group();
            lg.position.set(0, _ceilY, -4);
            const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c2e, roughness: 0.65, metalness: 0.55 });
            // Ceiling mount disc
            const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 12), darkMat);
            mount.position.y = -0.02;
            lg.add(mount);
            // Hanging cord
            const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 6),
              new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 }));
            cord.position.y = -0.04 - 0.125;
            lg.add(cord);
            // Lamp shade — inverted frustum, open-ended
            const shade = new THREE.Mesh(
              new THREE.CylinderGeometry(0.09, 0.34, 0.30, 16, 1, true),
              new THREE.MeshStandardMaterial({ color: 0x1c1c2e, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }),
            );
            shade.position.y = -0.04 - 0.25 - 0.15;
            lg.add(shade);
            // Shade top cap
            const shadeCap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 12), darkMat);
            shadeCap.position.y = -0.04 - 0.25;
            lg.add(shadeCap);
            // Bulb
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8),
              new THREE.MeshBasicMaterial({ color: 0xffd890 }));
            bulb.position.y = -0.04 - 0.25 - 0.06;
            lg.add(bulb);
            // Point light
            const lampPt = new THREE.PointLight(0xffd890, 5.0, 12, 2);
            lampPt.position.y = -0.04 - 0.65 - 0.06;
            lg.add(lampPt);
            targetGroup.add(lg);
          }
        });
      }
    } else if (kind === 'mission') {
      currentRoomGroup = buildMissionRoom(missionMap);
      // buildings
      if (missionMap?.buildings) {
        for (const b of missionMap.buildings) {
          const mesh = buildBuildingMesh(b);
          scene.add(mesh);
          buildingMeshes.set(`${b.x},${b.y},${b.w},${b.h}`, mesh);
        }
      }
    }
    if (currentRoomGroup) {
      scene.add(currentRoomGroup);
      // Pre-warm all room/building/prop shaders so the first rendered frame
      // after a phase transition doesn't stall on GPU compilation. Prefer
      // the async variant when available (three r151+) — it parallelises
      // program compilation across the driver's worker pool instead of
      // blocking the main thread for the entire duration.
      if (typeof renderer.compileAsync === 'function') {
        renderer.compileAsync(scene, camera).catch(() => {
          try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
        });
      } else {
        renderer.compile(scene, camera);
      }
    }
  }


  // ── Third-person camera ───────────────────────────────────────────────────
  // Scroll down → TP, scroll up → FP.  RMB → ADS zoom while in TP.
  const TP_ARM_LENGTH     = 3.0;   // spring arm length hip-fire
  const TP_ARM_LENGTH_ADS = 1.8;   // spring arm length ADS (closer to shoulder)
  const TP_SHOULDER_X     = 1.0;   // right-shoulder offset hip-fire
  // ADS keeps the same shoulder offset as hip-fire so the camera only pulls
  // forward (arm shortens) and FOV narrows — no lateral slide. That way the
  // crosshair ray stays on the same world point through the whole transition.
  const TP_SHOULDER_X_ADS = 1.0;
  const TP_PIVOT_H        = 1.7;   // pivot height above player feet
  const TP_LOOK_FWD       = 2.0;   // look-at forward shift (pushes char left of centre)
  const TP_FOV            = 65;    // hip-fire FOV
  const TP_FOV_ADS        = 45;    // ADS FOV (zoomed in)
  const TP_LERP           = 25;    // camera position lerp speed (high enough
                                   // that fast mouse swings can't leave the
                                   // character behind the FOV; ADS bumps even
                                   // higher — see followLerp below)
  const TP_ADS_SPEED      = 7;     // ADS transition speed (lower = slower/weightier)
  const TP_PITCH_MIN      = -Math.PI / 3;  // −60°
  const TP_PITCH_MAX      =  Math.PI / 3;  // +60°
  const TP_TRANS_RATE     = 4;     // FP↔TP transition speed (units/sec). 1/4 = 0.25s

  // _tpTarget is what scroll wants (0 = FP, 1 = TP). _tpMix is the eased
  // runtime value that steps toward the target each frame. The camera state
  // is computed as a smoothstep blend of the FP and TP solutions using _tpMix,
  // so both FP→TP and TP→FP transitions glide smoothly.
  let   _tpTarget      = 0;
  let   _tpMix         = 0;
  let   _tpSnap        = false;               // (re)snap smooth pivot/pos when entering TP
  let   _tpADS         = false;               // RMB held in TP mode
  let   _tpADST        = 0;                   // 0 = hip, 1 = full ADS (smoothstepped)
  const _tpSmoothPos   = new THREE.Vector3(); // lerped camera position
  const _tpSmoothPivot = new THREE.Vector3(); // lerped pivot — drives both cam pos + look-at
  const _tpRaycaster   = new THREE.Raycaster();
  let   _tpCollidables = [];
  let   _tpCollidableKey = '';

  function _rebuildTPCollidables() {
    _tpCollidables = [];
    // Only the static room geometry — NOT the whole scene. The scene contains
    // the camera-attached viewWeapon, the Gantz ball, character meshes, etc.
    // A raycast from the camera along its forward axis would otherwise hit the
    // viewWeapon (mounted on the camera, so always directly in front) producing
    // a near-zero hit distance and garbage aim direction.
    const root = currentRoomGroup;
    if (!root) return;
    root.traverse(o => {
      if (o.isMesh && !o.isSkinnedMesh && o.visible !== false) _tpCollidables.push(o);
    });
  }

  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.deltaY > 0 && _tpTarget === 0) {
      _tpTarget = 1;
      // Snap smooth pivot/pos to fresh TP values when we start the transition
      // so _tpSmoothPos doesn't lerp in from stale leftovers of a prior exit.
      if (_tpMix <= 0.001) _tpSnap = true;
    } else if (e.deltaY < 0 && _tpTarget === 1) {
      _tpTarget = 0;
      _tpADS    = false;  // clear ADS if we're leaving TP
    }
  }, { passive: false });

  renderer.domElement.addEventListener('mousedown', e => {
    if (e.button === 2 && _tpTarget === 1) _tpADS = true;
  });
  renderer.domElement.addEventListener('mouseup', e => {
    if (e.button === 2) _tpADS = false;
  });
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  // ── World-space gun template (for attaching to character hand bones) ──────
  // Populated when the X-Gun GLB loads. Cloned per-character in mission phase.
  let _worldGunTemplate = null;
  let _worldGunScale = 1; // the _s factor (0.32/maxDim) — applied when cloning

  // ── Character model (FBX / GLB) ──────────────────────────────────────────
  // _charVariants: array of loaded mesh templates (male1 first, others added as they load).
  // All share the same animation clips — retargeting works because Mixamo rigs
  // have identical bone names once the namespace prefix is stripped.
  const _charVariants = [];
  let _charClips = null;  // { clipName → AnimationClip } — shared by all variants

  // Strip 'mixamorig:' / 'mixamorig' Mixamo namespace from a bone or track name.
  function _normBone(n) { return n.replace(/^mixamorig[: ]?/, ''); }

  // Instance pool: pre-cloned character instances that are ready to use instantly.
  // skeletonClone() is expensive (~10-30ms per call). Pre-building the pool one
  // entry per rAF frame spreads that cost to load time rather than gameplay.
  // POOL_SIZE = 12 civilians + 8 players + a few spare.
  const _charPool = [];
  const _POOL_SIZE = 24;

  function _acquireCharInstance() {
    const inst = _charPool.length > 0 ? _charPool.pop() : _createCharInstance();
    // _releaseCharInstance stops all actions, leaving the skinned mesh on its
    // rest (T-pose) until the scene3d render loop issues its first crossfade.
    // Immediately play the idle clip here, and tick the mixer once so the
    // skeleton is posed before the caller adds the group to the scene —
    // otherwise the newcomer flashes as a T-pose for one frame while the
    // crossfade-from-nothing ramps up.
    const startClip = 'lobby_idle';
    if (inst.actions?.[startClip]) {
      inst.actions[startClip].reset().play();
      inst.currentAnim = startClip;
      inst.mixer?.update(0);
    }
    return inst;
  }

  function _releaseCharInstance(entry) {
    entry.mixer.stopAllAction();
    entry.currentAnim = null;
    entry.deathAnim = null;
    // Detach hand gun before recycling so the pool instance is clean.
    if (entry.handGun) {
      entry.handGun.bone.remove(entry.handGun.mesh);
      entry.handGun = null;
    }
    // Remove name label and chat bubble so the recycled group is clean.
    const toStrip = entry.group.children.filter(
      c => c.userData.isNameLabel || c.userData.isChatBubble
    );
    for (const c of toStrip) { entry.group.remove(c); disposeGroup(c); }
    scene.remove(entry.group);
    _charPool.push({ group: entry.group, mixer: entry.mixer, actions: entry.actions, currentAnim: null });
  }

  // ── Hand gun attachment ────────────────────────────────────────────────────
  // Find a bone by the bare name after any namespace prefix.
  // Mixamo FBX-with-mesh uses 'mixamorig:RightHand' (colon namespace).
  // Animation-only FBX uses 'mixamorigRightHand' (no colon).
  // We strip everything up to and including the colon/last non-alpha char so both match.
  function _findBone(root, bareName) {
    const target = bareName.toLowerCase();
    let found = null;
    // First pass: exact match
    root.traverse(o => {
      if (found || !o.isBone) return;
      if (o.name === bareName) found = o;
    });
    if (found) return found;
    // Second pass: match bare name after namespace prefix (strips 'mixamorig:' or 'mixamorig')
    root.traverse(o => {
      if (found || !o.isBone) return;
      const bare = o.name.replace(/^mixamorig[^a-zA-Z]*/i, '').toLowerCase();
      const tgt  = target.replace(/^mixamorig[^a-zA-Z]*/i, '');
      if (bare === tgt) found = o;
    });
    if (!found) console.warn('[scene3d] hand-gun: bone not found:', bareName);
    return found;
  }

  // Log all bone names once (dev helper — fires the first time a character attaches).
  let _boneNamesLogged = false;
  function _logBoneNames(root) {
    if (_boneNamesLogged) return;
    _boneNamesLogged = true;
    const names = [];
    root.traverse(o => { if (o.isBone) names.push(o.name); });
    console.log('[scene3d] skeleton bone names:', names.join(', '));
  }

  // Attach or detach the X-Gun world-mesh from a character's right hand bone.
  // Call with show=true when the character is in a mission and alive,
  // show=false to remove the gun (lobby, dead, civilian).
  //
  // Scale maths: the gun template has scale = _worldGunScale (~0.32/maxDim) so it
  // renders as ~0.32m in world space.  The Mixamo FBX root is scaled 0.01, so the
  // bone's local-space unit is 0.01 world-m.  Multiplying by 1/0.01 = 100 cancels
  // the FBX scale and leaves the gun at its correct ~0.32m world size.
  //
  // Bone local units: 1 unit = 0.01 world metres (FBX 0.01 scale).
  // RightHand bone axes (confirmed live):
  //   +X = world up      (-X = world down)
  //   +Y = toward wrist  (pulls grip back into palm from fingertips)
  //   +Z = toward left hand (across body); -Z = toward right hand side
  // Rz(-π/2) rotates GLB so barrel points along the bone's forward axis.
  const _HAND_GUN_POS = new THREE.Vector3(-10, 16, -10);
  const _HAND_GUN_ROT = new THREE.Euler(0, 0, -Math.PI / 2);
  // Barrel tip offset in the hand-gun mesh's LOCAL space (pre-scale). The
  // hand gun uses `_worldGunTemplate` which is the raw GLB: barrel points
  // down -Z with the gun centred at origin. After _HAND_GUN_ROT (Z=-π/2)
  // the local +Y axis swings forward along the barrel. This offset nudges
  // the spawn point up/forward so bullets emerge from the barrel tip, not
  // the centre of the gun mesh.
  const _HAND_GUN_BARREL_TIP = new THREE.Vector3(0, 0.55, 0);

  function _setHandGun(entry, show) {
    if (!entry.isFbx) return;
    if (!show) {
      if (entry.handGun) {
        entry.handGun.bone.remove(entry.handGun.mesh);
        entry.handGun = null;
      }
      return;
    }
    if (!_worldGunTemplate) return; // GLB not loaded yet
    if (entry.handGun) return;      // already attached

    _logBoneNames(entry.group);
    const bone = _findBone(entry.group, 'RightHand');
    if (!bone) return;

    const gunMesh = _worldGunTemplate.clone(true);
    // Cancel accumulated FBX 0.01 scale so the gun appears ~0.32m in world space.
    gunMesh.scale.setScalar(_worldGunScale * 100);
    gunMesh.position.copy(_HAND_GUN_POS);
    gunMesh.rotation.copy(_HAND_GUN_ROT);
    gunMesh.traverse(o => { o.frustumCulled = false; });
    // Anchor at the barrel tip — bullets fired from this character spawn here
    // so they visually leave the gun's muzzle instead of the character's chest.
    const barrelTip = new THREE.Object3D();
    barrelTip.position.copy(_HAND_GUN_BARREL_TIP);
    gunMesh.add(barrelTip);
    bone.add(gunMesh);
    entry.handGun = { bone, mesh: gunMesh, tip: barrelTip };
    console.log('[scene3d] hand-gun attached to bone:', bone.name, 'scale:', (_worldGunScale * 100).toFixed(3));
  }

  // Apply an aim-offset twist to the upper-body bones each frame AFTER the
  // animation mixer runs. The mixer overwrites bone rotations every frame from
  // the clip's tracks, so adding rotation here sticks for this frame only —
  // next frame's mixer update re-bases, and we re-add. That's what we want.
  //
  // Bones are cached per-entry (`entry.aimBones`) so we don't re-traverse the
  // skeleton every frame. `_findBone` handles the `mixamorig:` prefix.
  //
  // Pitch (look up/down) → local X on each spine bone (forward/back bend).
  // Yaw  (body twist)    → local Y on each spine bone (rotate around spine).
  // Weights sum to ~1 across the chain so the total reaches the aim.
  const _AIM_PITCH_LIMIT = Math.PI * 0.33;   // ±60°
  const _AIM_YAW_LIMIT   = Math.PI * 0.55;   // ±100° (feet catch up beyond this)
  function _applyAimOffset(entry, h) {
    if (!entry.isFbx) return;
    if (h.alive === false || h._isCivilian) return;
    // Lazy cache of the bone chain.
    if (!entry.aimBones) {
      const spine1 = _findBone(entry.group, 'Spine1');
      const spine2 = _findBone(entry.group, 'Spine2');
      const neck   = _findBone(entry.group, 'Neck');
      if (!spine1 && !spine2 && !neck) return;
      entry.aimBones = { spine1, spine2, neck };
    }
    const { spine1, spine2, neck } = entry.aimBones;

    // Delta between aim and feet. If aim fields are missing (legacy peers),
    // fall back to 0 twist and only use pitch.
    const aimYaw   = h.aimYaw   != null ? h.aimYaw   : (h.facing || 0);
    const aimPitch = h.aimPitch != null ? h.aimPitch : 0;
    let yawDelta = aimYaw - (h.facing || 0);
    while (yawDelta >  Math.PI) yawDelta -= 2 * Math.PI;
    while (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;
    // Clamp so we don't twist into impossible poses.
    if (yawDelta >  _AIM_YAW_LIMIT) yawDelta =  _AIM_YAW_LIMIT;
    if (yawDelta < -_AIM_YAW_LIMIT) yawDelta = -_AIM_YAW_LIMIT;
    let pitch = aimPitch;
    if (pitch >  _AIM_PITCH_LIMIT) pitch =  _AIM_PITCH_LIMIT;
    if (pitch < -_AIM_PITCH_LIMIT) pitch = -_AIM_PITCH_LIMIT;

    // Distribute across the chain (weights sum to 1).
    // Yaw: mostly Spine2 (below shoulders), some Spine1.
    // Pitch: mostly Spine2 + Neck so the head tracks.
    // Spine bones are oriented such that +Y rotation twists the torso opposite
    // to world yaw, and +X rotation pitches backward — negate both so the
    // upper body tracks aim naturally.
    if (spine1) {
      spine1.rotation.y -= yawDelta * 0.30;
      spine1.rotation.x -= pitch    * 0.25;
    }
    if (spine2) {
      spine2.rotation.y -= yawDelta * 0.50;
      spine2.rotation.x -= pitch    * 0.40;
    }
    if (neck) {
      neck.rotation.y -= yawDelta * 0.20;
      neck.rotation.x -= pitch    * 0.35;
    }
  }

  function _resampleClip(clip, fps) {
    const dt = 1 / fps;
    const duration = clip.duration;
    const count = Math.ceil(duration * fps) + 1;
    const newTimes = new Float32Array(count);
    for (let i = 0; i < count; i++) newTimes[i] = Math.min(i * dt, duration);
    clip.tracks = clip.tracks.map(track => {
      const stride = track.getValueSize();
      const interp = track.createInterpolant(new Float32Array(stride));
      const newValues = new Float32Array(count * stride);
      for (let i = 0; i < count; i++) {
        const r = interp.evaluate(newTimes[i]);
        for (let j = 0; j < stride; j++) newValues[i * stride + j] = r[j];
      }
      return new track.constructor(track.name, newTimes, newValues);
    });
  }

  const _CHAR_BASE = 'assets/models/character/male1/male1.fbx';
  const _CHAR_ANIMS = {
    lobby_idle:       'assets/models/character/male1/Lobby/male1_idle.fbx',
    lobby_walk:       'assets/models/character/male1/Lobby/male1_walking.fbx',
    lobby_walk_back:  'assets/models/character/male1/Lobby/male1_walking_backwards.fbx',
    lobby_strafe_l:   'assets/models/character/male1/Lobby/male1_left_strafe_walking.fbx',
    lobby_strafe_r:   'assets/models/character/male1/Lobby/male1_right_strafe_walking.fbx',
    lobby_jog:        'assets/models/character/male1/Lobby/jog_forward.fbx',
    lobby_jog_back:   'assets/models/character/male1/Lobby/jog_backward.fbx',
    lobby_jog_diag_fl:'assets/models/character/male1/Lobby/jog_forward_diagonal_left.fbx',
    lobby_jog_diag_fr:'assets/models/character/male1/Lobby/jog_forward_diagonal_right.fbx',
    lobby_jog_diag_bl:'assets/models/character/male1/Lobby/jog_backward_diagonal_left.fbx',
    lobby_jog_diag_br:'assets/models/character/male1/Lobby/jog_backward_diagonal_right.fbx',
    lobby_jog_sl:     'assets/models/character/male1/Lobby/jog_strafe_left.fbx',
    lobby_jog_sr:     'assets/models/character/male1/Lobby/jog_strafe_right.fbx',
    lobby_run:        'assets/models/character/male1/Lobby/male1_standard_run.fbx',
    lobby_run_back:   'assets/models/character/male1/Lobby/male1_standard_run_backwards.fbx',
    lobby_sprint_l:   'assets/models/character/male1/Lobby/male1_running_left_strafe.fbx',
    lobby_sprint_r:   'assets/models/character/male1/Lobby/male1_running_right_strafe.fbx',
    lobby_jump:       'assets/models/character/male1/Lobby/male1_jump_standing.fbx',
    lobby_jump_fwd:   'assets/models/character/male1/Lobby/male1_jump_forwards.fbx',
    lobby_jump_back:  'assets/models/character/male1/Lobby/male1_jump_backwards.fbx',
    pistol_idle:          'assets/models/character/male1/Mission/pistol idle.fbx',
    pistol_walk:          'assets/models/character/male1/Mission/pistol walk.fbx',
    pistol_walk_back:     'assets/models/character/male1/Mission/pistol walk backward.fbx',
    pistol_run:           'assets/models/character/male1/Mission/pistol run.fbx',
    pistol_strafe_l:      'assets/models/character/male1/Mission/pistol_strafe_left.fbx',
    pistol_strafe_r:      'assets/models/character/male1/Mission/pistol_strafe_right.fbx',
    pistol_walk_arc_l:    'assets/models/character/male1/Mission/Pistol Walk Arc Left.fbx',
    pistol_walk_arc_r:    'assets/models/character/male1/Mission/Pistol Walk Arc Right.fbx',
    pistol_run_arc_l:     'assets/models/character/male1/Mission/Pistol Run Arc Left.fbx',
    pistol_run_arc_r:     'assets/models/character/male1/Mission/Pistol Run Arc Right.fbx',
    pistol_run_back_arc_l:'assets/models/character/male1/Mission/Pistol Run Backward Arc Left.fbx',
    pistol_run_back_arc_r:'assets/models/character/male1/Mission/Pistol Run Backward Arc Right.fbx',
    pistol_walk_back_arc_l:'assets/models/character/male1/Mission/Pistol Walk Backward Arc Left.fbx',
    pistol_walk_back_arc_r:'assets/models/character/male1/Mission/Pistol Walk Backward Arc Right.fbx',
    pistol_jump:          'assets/models/character/male1/Mission/pistol_jump_standing.fbx',
    pistol_jump_fwd:      'assets/models/character/male1/Mission/pistol_jump_moving.fbx',
    pistol_shoot:         'assets/models/character/male1/Mission/pistol shooting.fbx',
    death_1:  'assets/models/character/male1/Dying/player_dying1.fbx',
    death_2:  'assets/models/character/male1/Dying/player_dying2.fbx',
    death_3:  'assets/models/character/male1/Dying/player_dying3.fbx',
    death_4:  'assets/models/character/male1/Dying/player_dying4.fbx',
    death_5:  'assets/models/character/male1/Dying/player_dying5.fbx',
    death_6:  'assets/models/character/male1/Dying/player_dying6.fbx',
    death_7:  'assets/models/character/male1/Dying/player_dying7.fbx',
    death_8:  'assets/models/character/male1/Dying/player_dying8.fbx',
    death_9:  'assets/models/character/male1/Dying/player_dying9.fbx',
    death_10: 'assets/models/character/male1/Dying/player_dying10.fbx',
    death_11: 'assets/models/character/male1/Dying/player_dying11.fbx',
    death_12: 'assets/models/character/male1/Dying/player_dying12.fbx',
    death_13: 'assets/models/character/male1/Dying/player_dying13.fbx',
  };

  // Load an additional character variant from a GLB or FBX URL.
  // Call this any time after scene3d is created — the variant is added to the
  // pool as soon as it loads and picked randomly from then on.
  function _loadCharVariant(url) {
    if (url.endsWith('.glb') || url.endsWith('.gltf')) {
      new GLTFLoader().load(url, gltf => {
        _charVariants.push(gltf.scene);
      }, undefined, () => console.warn('[char] GLB variant load failed:', url));
    } else {
      new FBXLoader().load(url, obj => {
        _charVariants.push(obj);
      }, undefined, () => console.warn('[char] FBX variant load failed:', url));
    }
  }

  (function loadCharacter() {
    const loader = new FBXLoader();
    // Load male2 in parallel — shares male1 animation clips.
    _loadCharVariant('assets/models/character/male2/male2.fbx');
    loader.load(_CHAR_BASE, base => {
      const clips = {};

      const names = Object.keys(_CHAR_ANIMS);
      let remaining = names.length;
      const done = () => {
        if (--remaining === 0) {
          // Strip root-bone position tracks so Mixamo root motion doesn't fight
          // the game's group.position.set() call each frame (causes jitter).
          for (const [name, clip] of Object.entries(clips)) {
            clip.tracks = clip.tracks.filter(t => {
              const bone = t.name.split('.')[0].toLowerCase();
              if (t.name.endsWith('.position') && (bone.includes('hips') || bone === 'root')) {
                const needsY = name.startsWith('death_');
                if (needsY) {
                  // Keep Y for vertical motion (fall); zero XZ to prevent horizontal drift
                  for (let i = 0; i < t.values.length; i += 3) {
                    t.values[i]   = 0; // X
                    t.values[i+2] = 0; // Z
                  }
                  return true;
                }
                return false; // strip entirely for all other clips
              }
              return true;
            });
            // Jump clips: resample at 120fps to smooth sparse Mixamo keyframes.
            // Other one-shots: 60fps is sufficient.
            if (name.includes('jump')) _resampleClip(clip, 120);
            else if (name === 'pistol_shoot' ||
                name.startsWith('death_')) _resampleClip(clip, 60);
          }
          // Normalize track names: strip Mixamo namespace so clips retarget
          // to any Mixamo skeleton (FBX uses 'mixamorig:Hips', GLB uses 'Hips').
          for (const clip of Object.values(clips)) {
            for (const track of clip.tracks) {
              const dot = track.name.indexOf('.');
              if (dot > 0) track.name = _normBone(track.name.slice(0, dot)) + track.name.slice(dot);
            }
          }
          _charClips = clips;
          _charVariants.unshift(base); // male1 is always index 0
          // Fill the instance pool one entry per rAF frame so no single frame
          // pays the full skeletonClone cost.  The first entry also triggers a
          // shader compile so GPU programs are ready before any character renders.
          let _poolBuilt = 0;
          (function _fillPool() {
            if (_poolBuilt >= _POOL_SIZE) return;
            const inst = _createCharInstance();
            if (_poolBuilt === 0) {
              // Compile GPU shaders now using the first instance. Prefer
              // compileAsync — the skinned character shader is one of the
              // heaviest programs in the scene and the sync compile here is
              // a major contributor to the startup stall. three captures the
              // scene state synchronously at the call site, so removing the
              // temp instance right after is safe and prevents it getting
              // yanked out later if it's already been handed to a human.
              scene.add(inst.group);
              if (typeof renderer.compileAsync === 'function') {
                renderer.compileAsync(scene, camera).catch(() => {
                  try { renderer.compile(scene, camera); } catch (e) { /**/ }
                });
              } else {
                try { renderer.compile(scene, camera); } catch (e) { /**/ }
              }
              scene.remove(inst.group);
            }
            _charPool.push(inst);
            _poolBuilt++;
            requestAnimationFrame(_fillPool);
          })();
        }
      };
      for (const name of names) {
        loader.load(_CHAR_ANIMS[name], animFbx => {
          if (animFbx.animations.length > 0) {
            const clip = animFbx.animations[0];
            clip.name = name;
            clips[name] = clip;
          }
          done();
        }, undefined, err => { console.warn('[char] anim load failed:', name); done(); });
      }
    }, undefined, () => console.error('[char] base mesh load failed'));
  })();

  function _createCharInstance() {
    const template = _charVariants[Math.floor(Math.random() * _charVariants.length)];
    const clone = skeletonClone(template);
    clone.scale.setScalar(0.01); // Mixamo FBX is in cm
    // Normalize bone names to match the normalized clip track names.
    clone.traverse(o => { if (o.isBone) o.name = _normBone(o.name); });
    clone.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        // DoubleSide prevents hair/thin geometry from vanishing when viewed from behind
        mat.side = THREE.DoubleSide;
        // Kill any emissive baked into the FBX — prevents the character self-glowing.
        if (mat.emissive) mat.emissive.set(0, 0, 0);
        mat.emissiveIntensity = 0;
        if (mat.alphaMap) {
          // Hair: alpha-cutout mode with minimal threshold so near-fully-transparent
          // edge pixels are the only ones discarded.  transparent=false keeps depth
          // writing on so the solid hair strands correctly occlude geometry behind them
          // and render densely like the source FBX in Blender.
          mat.alphaTest   = 0.01;
          mat.transparent = false;
          mat.depthWrite  = true;
          o.renderOrder   = 0;
        } else if (mat.transparent && (mat.opacity == null || mat.opacity >= 0.99)) {
          // FBX loader marks some fully-opaque materials as transparent — undo that
          // so they write to the depth buffer and don't get depth-sort artefacts.
          mat.transparent = false;
          mat.depthWrite  = true;
        }
      }
    });
    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};
    for (const [name, clip] of Object.entries(_charClips)) {
      const action = mixer.clipAction(clip);
      action.enabled = true;
      actions[name] = action;
    }
    const startClip = 'lobby_idle';
    actions[startClip]?.play();
    return { group: clone, mixer, actions, currentAnim: startClip };
  }

  function _pickGroundAnim(phase, h) {
    const moving    = Math.abs(h.moveFwd || 0) > 0.05 || Math.abs(h.moveSide || 0) > 0.05;
    // While the player is aiming down sights, force the "walking" gait
    // regardless of sprint input so the 3rd-person model reads as carefully
    // aimed instead of sprinting with a scope up. Applies to both the local
    // player (via _adsActive) and remote peers (via pose-broadcast h.ads).
    const adsOverride = (h._id === '__player__' && _adsActive) || !!h.ads;
    const sprinting = adsOverride ? false : !!h.sprinting;
    const walking   = adsOverride ? true  : !!h.walking;
    const fwd  = h.moveFwd  || 0;
    const side = h.moveSide || 0;
    const pureStrafe = Math.abs(fwd) < 0.3;

    if (phase !== 'MISSION') {
      if (!moving) return 'lobby_idle';
      if (sprinting) {
        // Back-diagonals: reuse the jog back-diagonal clips (no dedicated
        // sprint-back-diagonal animation exists; the jog variant reads fine
        // at sprint speed).
        if (fwd < -0.15 && side < -0.15) return 'lobby_jog_diag_bl';
        if (fwd < -0.15 && side >  0.15) return 'lobby_jog_diag_br';
        if (fwd < -0.2)  return 'lobby_run_back';
        // Use running-strafe animations any time sprinting with meaningful
        // sideways input, including forward+side diagonals (not just pure strafe).
        if (side < -0.3) return 'lobby_sprint_l';
        if (side >  0.3) return 'lobby_sprint_r';
        return 'lobby_run';
      }
      if (walking) {
        if (fwd < -0.2)  return 'lobby_walk_back';
        if (side < -0.3 && pureStrafe) return 'lobby_strafe_l';
        if (side >  0.3 && pureStrafe) return 'lobby_strafe_r';
        return 'lobby_walk';
      }
      // jog (default) — full diagonal detection
      if (side < -0.3 && pureStrafe) return 'lobby_jog_sl';
      if (side >  0.3 && pureStrafe) return 'lobby_jog_sr';
      if (fwd < -0.15 && side < -0.15) return 'lobby_jog_diag_bl';
      if (fwd < -0.15 && side >  0.15) return 'lobby_jog_diag_br';
      if (fwd < -0.2)                  return 'lobby_jog_back';
      if (fwd >  0.15 && side < -0.15) return 'lobby_jog_diag_fl';
      if (fwd >  0.15 && side >  0.15) return 'lobby_jog_diag_fr';
      return 'lobby_jog';
    }
    if (!moving) return 'pistol_idle';
    // Back diagonals — dedicated arc clips for both sprint and walk pacing.
    if (fwd < -0.15 && side < -0.15) return sprinting ? 'pistol_run_back_arc_l' : 'pistol_walk_back_arc_l';
    if (fwd < -0.15 && side >  0.15) return sprinting ? 'pistol_run_back_arc_r' : 'pistol_walk_back_arc_r';
    if (fwd < -0.2 && !pureStrafe) return 'pistol_walk_back';
    if (side < -0.3 && pureStrafe) return 'pistol_strafe_l';
    if (side >  0.3 && pureStrafe) return 'pistol_strafe_r';
    // Forward diagonals — separate arc clips for walk vs sprint pacing.
    if (fwd > 0.15 && side < -0.15) return sprinting ? 'pistol_run_arc_l' : 'pistol_walk_arc_l';
    if (fwd > 0.15 && side >  0.15) return sprinting ? 'pistol_run_arc_r' : 'pistol_walk_arc_r';
    return sprinting ? 'pistol_run' : 'pistol_walk';
  }

  function _pickJumpAnim(phase, h) {
    const fwd  = h.jumpMoveFwd  || 0;
    const side = h.jumpMoveSide || 0;
    const inputBack = fwd < -0.15 && Math.abs(fwd) >= Math.abs(side);
    const inputAny  = Math.abs(fwd) > 0.1 || Math.abs(side) > 0.1;
    if (phase !== 'MISSION') {
      if (inputBack) return 'lobby_jump_back';
      if (inputAny)  return 'lobby_jump_fwd';
      return 'lobby_jump';
    }
    return inputAny ? 'pistol_jump_fwd' : 'pistol_jump';
  }

  function _crossfadeAnim(entry, name, oneShot = false, force = false) {
    if (!force && entry.currentAnim === name) return;
    const prev = entry.actions[entry.currentAnim];
    const next = entry.actions[name];
    if (!next) return;
    if (oneShot) {
      // One-shots (jump, shoot) must not fade in. A fadeIn ramps the new
      // action's weight 0→1 while the previous action fades out 1→0, and the
      // total weight dips below 1 in the middle — three.js fills that deficit
      // with the bind pose, which shows as a T-pose flash at the start of the
      // new anim. Instead, put the new action at full weight immediately and
      // just fade the previous one out underneath it.
      //
      // Only fade the previous when it's actually a different action — on a
      // force-restart (e.g. rapid fire → same pistol_shoot re-triggered), prev
      // === next, and fading it out would drop the sole-acting weight to 0,
      // exposing bind pose all over again.
      if (prev && prev !== next) prev.fadeOut(0.08);
      next.stopFading();                                 // cancel any prior fade-out on next
      next.reset().setLoop(THREE.LoopOnce, Infinity);
      next.clampWhenFinished = true;
      next.setEffectiveWeight(1).play();
    } else {
      const fadeTime = 0.2;
      if (prev) prev.fadeOut(fadeTime);
      next.reset().setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
      next.fadeIn(fadeTime).play();
    }
    entry.currentAnim = name;
  }

  // Entity pools
  const humans = new Map();   // id → { group, mixer?, actions?, currentAnim?, specSeed, suit, isFbx }
  const aliens = new Map();
  const _scanController = createScanController(scene);
  const props = new Map();
  let gantzBall = null;
  let ballDisplay = null;
  // Energy-bullet pool. Each projectile is a small glowing sphere with an
  // attached point light. The bullet flies from origin toward endpoint at a
  // fixed speed, and is destroyed on arrival (the endpoint is the first
  // collision point reported by the game-side hitscan, so the bullet stops at
  // walls, props, players, civilians, aliens — i.e. everything listed in
  // _buildFireTargets + activeColliders).
  const bullets = [];  // { mesh, light, dx, dy, dz, remaining }
  const BULLET_SPEED   = 80;   // m/s
  const BULLET_RADIUS  = 0.06;
  const BULLET_MUZZLE_Y = 1.35; // approx gun height off the ground
  const BULLET_MAX_DIST = 50;   // bullets fly this far before despawning,
                                // regardless of what they visually pass through
  const _bulletGeom = new THREE.SphereGeometry(BULLET_RADIUS, 12, 10);
  const _bulletHaloGeom = new THREE.SphereGeometry(BULLET_RADIUS * 2.4, 12, 10);
  // Shared bullet materials. Reusing a single MeshBasicMaterial avoids the
  // per-shot program-cache churn that caused a hitch on the first several
  // shots. Color is applied per-instance via `mesh.material = <clone>` only
  // when it differs from the default.
  const _bulletCoreMat = new THREE.MeshBasicMaterial({ color: 0x66ddff });
  const _bulletHaloMat = new THREE.MeshBasicMaterial({
    color: 0x66ddff, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // Point-light pool. Adding a new THREE.PointLight to the scene forces a
  // shader recompile on every lit material because the lightsHash changes;
  // removing one does the same. Instead we allocate a fixed pool up front
  // and just toggle intensity/position — the lightsHash stays constant, so
  // no recompile hitches when firing.
  // Kept small on purpose: every pooled light iterates in the lit fragment
  // shader on every skinned character / wall pixel even when its intensity
  // is 0 and it's parked below the map, so a large pool literally scales
  // per-frame fragment cost. 4 covers the normal in-flight bullet count
  // for single-shot and small spreads; any extra bullets render without a
  // light which is visually negligible for a single frame.
  const BULLET_LIGHT_POOL_SIZE = 4;
  const _bulletLightPool = [];
  for (let i = 0; i < BULLET_LIGHT_POOL_SIZE; i++) {
    const pl = new THREE.PointLight(0x66ddff, 0, 3.0, 2);
    pl.position.set(0, -1000, 0); // parked far below the map
    pl.userData._inUse = false;
    scene.add(pl);
    _bulletLightPool.push(pl);
  }
  function _acquireBulletLight() {
    for (const pl of _bulletLightPool) {
      if (!pl.userData._inUse) {
        pl.userData._inUse = true;
        return pl;
      }
    }
    return null; // pool exhausted — bullet renders without light
  }
  function _releaseBulletLight(pl) {
    if (!pl) return;
    pl.intensity = 0;
    pl.position.set(0, -1000, 0);
    pl.userData._inUse = false;
  }

  // Returns the viewmodel muzzle's current world-space position. Used by
  // game.js so the local FP bullet actually emerges from the gun barrel
  // instead of the middle of the screen.
  const _muzzleWorldV = new THREE.Vector3();
  const _muzzleWorldV2 = new THREE.Vector3();
  function getMuzzleWorldPosition() {
    // Make sure the viewWeapon's world matrix reflects this frame's camera
    // transform (camera is updated once per render before bullets spawn).
    _barrelTip.updateWorldMatrix(true, false);
    muzzleLight.updateWorldMatrix(true, false);
    // Hip: _barrelTip (visible barrel end). ADS: muzzleLight (calibrated to
    // sit on the screen center / crosshair). Lerp by smoothstepped _adsT so
    // aim-down-sights fire reads as coming from the middle of the screen.
    const e = _adsT * _adsT * (3 - 2 * _adsT);
    _muzzleWorldV.setFromMatrixPosition(_barrelTip.matrixWorld);   // hip
    _muzzleWorldV2.setFromMatrixPosition(muzzleLight.matrixWorld); // ads
    const x = _muzzleWorldV.x + (_muzzleWorldV2.x - _muzzleWorldV.x) * e;
    const y = _muzzleWorldV.y + (_muzzleWorldV2.y - _muzzleWorldV.y) * e;
    const z = _muzzleWorldV.z + (_muzzleWorldV2.z - _muzzleWorldV.z) * e;
    return { x, y, z };
  }

  function spawnBullet(x1, y1, z1, x2, y2, z2, colorHex) {
    // Shared materials; color is set on the pooled light and passed via the
    // material's color uniform only if it actually differs from the default
    // (most shots use the default X-Gun cyan).
    const mesh = new THREE.Mesh(_bulletGeom, _bulletCoreMat);
    mesh.position.set(x1, y1, z1);
    const halo = new THREE.Mesh(_bulletHaloGeom, _bulletHaloMat);
    mesh.add(halo);
    scene.add(mesh);

    // Grab a pooled point light (no scene graph add/remove, so no shader
    // program churn). The light is parented to the scene, not the mesh, so
    // we update its position each frame alongside the bullet.
    const light = _acquireBulletLight();
    if (light) {
      const col = new THREE.Color(colorHex || '#66ddff');
      light.color.copy(col);
      light.intensity = 2.2;
      light.position.set(x1, y1, z1);
    }

    // Direction comes from the endpoint payload; distance is fixed —
    // bullets pass through level geometry and despawn at max range or on
    // hitting a living character.
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const dist = Math.hypot(dx, dy, dz) || 0.001;
    bullets.push({
      mesh, light,
      dx: dx / dist, dy: dy / dist, dz: dz / dist,
      remaining: BULLET_MAX_DIST,
    });
  }

  // Characters bullets should stop on (living civilians / aliens / players).
  // Walls and props are deliberately excluded — bullets pass through level
  // geometry until they reach BULLET_MAX_DIST.
  // ── Gib / viscera particle pool (X-Gun detonation) ─────────────────────
  // When an alien detonates after an X-Gun mark-countdown, spawn a short-
  // lived burst of small meshes flying outward with gravity. No physics
  // collisions beyond a ground-plane stick at y=0.
  const _gibs = [];                                        // { mesh, vx, vy, vz, life, ttl, spin }
  const _gibSplats = [];                                   // flat ground blood pools
  const _gibBoxGeom    = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const _gibSphereGeom = new THREE.SphereGeometry(0.12, 8, 6);
  const _gibShardGeom  = new THREE.BoxGeometry(0.08, 0.28, 0.08);
  const _gibChunkGeom  = new THREE.BoxGeometry(0.34, 0.26, 0.30);   // meaty torso chunk
  const _gibStringGeom = new THREE.BoxGeometry(0.04, 0.04, 0.55);   // viscera / entrails
  const _gibSplatGeom  = new THREE.CircleGeometry(1, 20);
  const _gibMistGeom   = new THREE.SphereGeometry(1, 14, 10);
  const GIB_GRAVITY    = 18;
  const GIB_GROUND_Y   = 0.02;
  function spawnGibs(x, y, opts = {}) {
    const centerY = opts.centerY != null ? opts.centerY : 1.1;
    const power = opts.power || 1;
    // Tighter explosion: slightly fewer chunks, much less outward travel so
    // the burst reads as a focused splatter around the kill point, not a
    // confetti cloud filling the room.
    const count = Math.round((opts.count || 28) * 1.4);

    // ── Blood mist: short-lived expanding red fog at the detonation point.
    {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x5a000a),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(_gibMistGeom, mat);
      mesh.position.set(x, centerY, y);
      mesh.scale.setScalar(0.2);
      scene.add(mesh);
      _gibs.push({
        mesh, mat,
        vx: 0, vy: 0, vz: 0, life: 0,
        ttl: 0.85,
        spin: { x: 0, y: 0, z: 0 },
        grounded: true,
        isMist: true,
        mistPeak: (0.9 + Math.random() * 0.4) * power,
      });
    }

    // ── Ground splats: a few overlapping dark-red pools, persistent.
    const splatCount = 2 + Math.floor(power);
    for (let s = 0; s < splatCount; s++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(`hsl(${348 + Math.random() * 12}, ${70 + Math.random() * 20}%, ${10 + Math.random() * 8}%)`),
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(_gibSplatGeom, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI * 2;
      const jitter = 0.28 * power;
      mesh.position.set(
        x + (Math.random() - 0.5) * jitter,
        0.012 + s * 0.003,
        y + (Math.random() - 0.5) * jitter,
      );
      mesh.scale.setScalar(0.05);
      scene.add(mesh);
      _gibSplats.push({
        mesh, mat, life: 0,
        growTo: (0.30 + Math.random() * 0.30) * (1 + 0.35 * power),
        ttl: 9 + Math.random() * 4,
      });
    }

    // ── Chunks + shards + viscera flying outward.
    for (let i = 0; i < count; i++) {
      const pick = Math.random();
      let geom;
      if      (pick < 0.32) geom = _gibSphereGeom;
      else if (pick < 0.56) geom = _gibBoxGeom;
      else if (pick < 0.78) geom = _gibShardGeom;
      else if (pick < 0.92) geom = _gibStringGeom;
      else                  geom = _gibChunkGeom;

      // Two palettes: arterial red (bright) + dark viscera (maroon/purple).
      const dark = Math.random() < 0.38;
      const hue = dark ? 328 + Math.random() * 20 : 350 + Math.random() * 15;
      const sat = dark ? 55 + Math.random() * 25 : 80 + Math.random() * 20;
      const lgt = dark ? 10 + Math.random() * 14 : 22 + Math.random() * 22;
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(`hsl(${hue}, ${sat}%, ${lgt}%)`),
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geom, mat);
      const jitter = 0.22;
      mesh.position.set(
        x + (Math.random() - 0.5) * jitter,
        centerY + (Math.random() - 0.5) * 0.4,
        y + (Math.random() - 0.5) * jitter,
      );
      const ang = Math.random() * Math.PI * 2;
      const speed = (1.8 + Math.random() * 3.2) * power;
      const upBias = 2.2 + Math.random() * 2.8;
      const vx = Math.cos(ang) * speed;
      const vz = Math.sin(ang) * speed;
      const vy = upBias + Math.random() * 1.6;
      const ttl = 1.1 + Math.random() * 1.2;
      const scl = 0.7 + Math.random() * 1.1;
      mesh.scale.setScalar(scl);
      mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      scene.add(mesh);
      _gibs.push({
        mesh, mat, vx, vy, vz, life: 0, ttl,
        spin: {
          x: (Math.random() - 0.5) * 14,
          y: (Math.random() - 0.5) * 14,
          z: (Math.random() - 0.5) * 14,
        },
        grounded: false,
      });
    }
  }
  function _stepGibs(dt) {
    for (let i = _gibs.length - 1; i >= 0; i--) {
      const g = _gibs[i];
      g.life += dt;
      if (g.isMist) {
        const t = g.life / g.ttl;
        const s = 0.2 + (g.mistPeak - 0.2) * Math.min(1, t * 2.8);
        g.mesh.scale.setScalar(s);
        g.mat.opacity = Math.max(0, 0.6 * (1 - t) * (1 - t));
        if (g.life >= g.ttl) {
          scene.remove(g.mesh);
          g.mat.dispose();
          _gibs.splice(i, 1);
        }
        continue;
      }
      if (!g.grounded) {
        g.vy -= GIB_GRAVITY * dt;
        g.mesh.position.x += g.vx * dt;
        g.mesh.position.y += g.vy * dt;
        g.mesh.position.z += g.vz * dt;
        g.mesh.rotation.x += g.spin.x * dt;
        g.mesh.rotation.y += g.spin.y * dt;
        g.mesh.rotation.z += g.spin.z * dt;
        if (g.mesh.position.y <= GIB_GROUND_Y) {
          g.mesh.position.y = GIB_GROUND_Y;
          g.grounded = true;
          g.vx *= 0.2; g.vz *= 0.2; g.vy = 0;
          // Impact splat: tiny pool under whatever just landed.
          if (Math.random() < 0.45) {
            const mat = new THREE.MeshBasicMaterial({
              color: new THREE.Color(`hsl(${348 + Math.random() * 12}, ${70 + Math.random() * 20}%, ${12 + Math.random() * 8}%)`),
              transparent: true,
              opacity: 0.8,
              depthWrite: false,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            });
            const mesh = new THREE.Mesh(_gibSplatGeom, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.z = Math.random() * Math.PI * 2;
            mesh.position.set(g.mesh.position.x, 0.011, g.mesh.position.z);
            mesh.scale.setScalar(0.05);
            scene.add(mesh);
            _gibSplats.push({
              mesh, mat, life: 0,
              growTo: 0.15 + Math.random() * 0.25,
              ttl: 6 + Math.random() * 3,
            });
          }
        }
      }
      const remaining = g.ttl - g.life;
      if (remaining < 0.6) {
        g.mesh.material.opacity = Math.max(0, remaining / 0.6);
      }
      if (g.life >= g.ttl) {
        scene.remove(g.mesh);
        g.mesh.material.dispose();
        _gibs.splice(i, 1);
      }
    }

    // Ground blood pools: quick grow-in, long persistence, fade at end.
    for (let i = _gibSplats.length - 1; i >= 0; i--) {
      const sp = _gibSplats[i];
      sp.life += dt;
      const growT = Math.min(1, sp.life / 0.25);
      sp.mesh.scale.setScalar(sp.growTo * (0.3 + 0.7 * growT));
      const remaining = sp.ttl - sp.life;
      if (remaining < 2.5) {
        sp.mat.opacity = Math.max(0, (remaining / 2.5) * 0.88);
      }
      if (sp.life >= sp.ttl) {
        scene.remove(sp.mesh);
        sp.mat.dispose();
        _gibSplats.splice(i, 1);
      }
    }
  }

  const BULLET_HIT_RADIUS = 0.45;              // fudge so near-misses still pop
  const BULLET_SELF_IGNORE_DIST = 0.9;         // ignore hits on shooter for
                                               // the first ~1m of travel
  function _stepBullets(dt, state) {
    const civs    = state?.civilians || [];
    const aliens  = state?.aliens    || [];
    const remotes = state?.remotes   || [];
    const self    = state?.player;

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const step = Math.min(b.remaining, BULLET_SPEED * dt);
      b.mesh.position.x += b.dx * step;
      b.mesh.position.y += b.dy * step;
      b.mesh.position.z += b.dz * step;
      if (b.light) b.light.position.copy(b.mesh.position);
      b.remaining -= step;
      b.traveled  = (b.traveled || 0) + step;

      // Collision vs living characters. XZ is a circle test (footprint);
      // the bullet's Y must also be inside the character's vertical extent
      // or a shot aimed well above/below the target despawns on frame 1
      // (bullet starts at the shooter's muzzle near the target's footprint
      // but climbs out immediately) — that's why high-angle shots weren't
      // visible to other peers: the remote bullet was culled the instant
      // it spawned because we only compared XZ.
      let hitChar = false;
      const bx = b.mesh.position.x, by = b.mesh.position.y, bz = b.mesh.position.z;
      const checkHit = (e, extra = 0) => {
        if (!e || e.alive === false) return false;
        const r = (e.radius || 0.4) + BULLET_HIT_RADIUS + extra;
        const dx = e.x - bx, dy = e.y - bz;
        if ((dx * dx + dy * dy) > r * r) return false;
        // Vertical extent: humans ~0..1.9m, aliens up to ~2.5m. Feet at 0
        // (add jumpY for jumping players). A small fudge under the feet
        // keeps leg shots landing.
        const top = e.kind === 'alien' ? 2.5 : 1.9;
        const bot = -0.2 + (e.jumpY || 0);
        return by >= bot && by <= top + (e.jumpY || 0);
      };
      for (const c of civs)    { if (checkHit(c)) { hitChar = true; break; } }
      if (!hitChar) for (const a of aliens)  { if (checkHit(a)) { hitChar = true; break; } }
      if (!hitChar) for (const r of remotes) { if (checkHit(r)) { hitChar = true; break; } }
      if (!hitChar && self && b.traveled > BULLET_SELF_IGNORE_DIST) {
        if (checkHit(self)) hitChar = true;
      }

      if (hitChar || b.remaining <= 0.001) {
        scene.remove(b.mesh);
        _releaseBulletLight(b.light);
        // Materials/geometry are shared across all bullets — nothing to
        // dispose per-bullet. The mesh itself is GC'd by removal from scene.
        bullets.splice(i, 1);
      }
    }
  }

  function getOrCreateHuman(id, spec, opts) {
    let entry = humans.get(id);
    const suit = !!opts?.suit;
    const charReady = !!(_charTemplate && _charClips);

    // Don't create any mesh until the FBX character + clips are ready. The old
    // procedural fallback used to render here during the few hundred ms of FBX
    // load; it was visible on cold-refreshes as a low-poly stand-in of the
    // real model. Returning null skips the entry entirely — the render loop
    // has a `continue` guard for this case.
    if (!charReady) return entry || null;

    // Rebuild if not yet FBX (was procedural fallback) or suit changed.
    // Exception: if a transfer scan is running on this entry, defer the swap
    // — swapping would throw away the entry's patched materials and orphan
    // the scan. The next render after the scan completes will pick up the
    // FBX promotion cleanly.
    const scanRunning = !!(entry && entry.__scan && entry.__scan.state === 'running');
    if ((!entry || !entry.isFbx || entry.suit !== suit) && !scanRunning) {
      const isFreshEntry = !entry;
      if (entry) {
        _releaseCharInstance(entry); // return to pool — never dispose shared FBX materials
      }
      const inst = _acquireCharInstance(); // instant from pool; clone only if pool drained
      scene.add(inst.group);
      // Hide brand-new entries for a brief grace window. A pose carrying a
      // scan descriptor can arrive one frame before the scan relay actually
      // attaches the scan to the entry — without this gate the mesh renders
      // for one frame as an unscanned full body. The scan's start() flips
      // visible=true as soon as uScanActive=1 discards the body via shader;
      // the render loop falls back to visible=true after the grace elapses
      // for peers who don't scan in (civilians, existing peers).
      if (isFreshEntry) inst.group.visible = false;
      // Grace window: 150ms is plenty for peers (their scan relay lands on the
      // next pose tick, max 66ms). For the LOCAL player, scheduleInitialScan in
      // game.js can wait up to 6s for FBX+shader settle before firing; without
      // a matching grace the local mesh reveals as a full un-scanned body the
      // moment the 150ms window elapses. Scan.start() zeroes __firstShowAt as
      // soon as it fires, so extending the ceiling costs nothing in the happy
      // path — it just prevents a premature reveal if the scan is delayed.
      const graceMs = id === '__player__' ? 7000 : 150;
      entry = { group: inst.group, mixer: inst.mixer, actions: inst.actions, currentAnim: inst.currentAnim, lastJumpId: 0, lastCrouchId: 0, lastFireId: 0, specSeed: spec.seed, suit, isFbx: true, labelText: null, labelColor: null, bubbleText: null, handGun: null, __firstShowAt: isFreshEntry ? (performance.now() + graceMs) : 0 };
      humans.set(id, entry);
    }
    return entry;
  }

  // Compensate for the FBX character's 0.01 parent scale so the sprite ends
  // up at its designed world-space position and size. makeNameLabel/
  // makeChatBubble author position + scale in metres assuming a unit-scaled
  // parent; an FBX root is scaled to 0.01 (cm → m) which would otherwise
  // shrink the pill to ~1cm tall at ground level and make it invisible.
  function _compensateForParentScale(sprite, entry) {
    if (!entry.isFbx) return;
    const k = 100; // inverse of 0.01
    sprite.position.multiplyScalar(k);
    sprite.scale.multiplyScalar(k);
  }

  function updateNameLabel(entry, text, color, visible) {
    const textStr = String(text || '');
    const colorStr = String(color || '');
    // Rebuild label if text/color changed
    if (entry.labelText !== textStr || entry.labelColor !== colorStr) {
      const old = entry.group.children.find(c => c.userData.isNameLabel);
      if (old) { entry.group.remove(old); disposeGroup(old); }
      if (textStr) {
        const label = makeNameLabel(textStr, colorStr);
        _compensateForParentScale(label, entry);
        entry.group.add(label);
      }
      entry.labelText = textStr;
      entry.labelColor = colorStr;
    }
    // Toggle visibility
    const label = entry.group.children.find(c => c.userData.isNameLabel);
    if (label) label.visible = !!visible;
  }

  function updateChatBubble(entry, text, alpha) {
    const textStr = String(text || '');
    // Remove stale bubble if text changed or cleared
    if (entry.bubbleText !== textStr) {
      const old = entry.group.children.find(c => c.userData.isChatBubble);
      if (old) { entry.group.remove(old); disposeGroup(old); }
      if (textStr) {
        const bubble = makeChatBubble(textStr);
        _compensateForParentScale(bubble, entry);
        entry.group.add(bubble);
      }
      entry.bubbleText = textStr;
    }
    // Update opacity for fade-out
    const bubble = entry.group.children.find(c => c.userData.isChatBubble);
    if (bubble) {
      bubble.visible = alpha > 0;
      bubble.material.opacity = Math.min(1, alpha);
    }
  }

  function getOrCreateAlien(id, spec) {
    let entry = aliens.get(id);
    if (!entry || entry.specSeed !== spec.seed) {
      if (entry) { scene.remove(entry.group); disposeGroup(entry.group); }
      const group = buildAlienMesh(spec);
      scene.add(group);
      entry = { group, specSeed: spec.seed };
      aliens.set(id, entry);
    }
    return entry.group;
  }

  function getOrCreateProp(id, type, spec) {
    let entry = props.get(id);
    if (!entry) {
      const group = buildPropMesh(type, spec);
      scene.add(group);
      entry = { group, type };
      props.set(id, entry);
    }
    return entry.group;
  }

  function ensureGantzBall(visible) {
    if (visible && !gantzBall) {
      gantzBall = buildGantzBallMesh();
      gantzBall.scale.setScalar(0.8);
      scene.add(gantzBall);
      ballDisplay = buildGantzBallDisplay();
      ballDisplay.mesh.scale.setScalar(0.8);
      scene.add(ballDisplay.mesh);
    } else if (!visible && gantzBall) {
      scene.remove(gantzBall);
      disposeGroup(gantzBall);
      gantzBall = null;
      if (ballDisplay) {
        scene.remove(ballDisplay.mesh);
        ballDisplay.mesh.geometry.dispose();
        ballDisplay.mesh.material.map.dispose();
        ballDisplay.mesh.material.dispose();
        ballDisplay = null;
      }
    }
  }

  function prune(map, keepIds) {
    for (const [id, entry] of map) {
      if (!keepIds.has(id)) {
        if (entry.isFbx) {
          _releaseCharInstance(entry); // return to pool; never dispose shared FBX materials
        } else {
          scene.remove(entry.group);
          disposeGroup(entry.group);
          entry.mixer?.stopAllAction();
        }
        map.delete(id);
      }
    }
  }

  function updateEntityTransform(group, e, isFbx, dt) {
    const jy = e.jumpY || 0;
    // Lerp at a rate high enough to be imperceptible at 60 fps (factor ≈ 1)
    // but which smoothly interpolates sub-tick movement at higher refresh rates.
    // This eliminates the "fuzzy" jitter caused by physics-tick position snapping.
    const lerpFactor = dt !== undefined ? Math.min(1, 60 * dt) : 1;
    group.position.x += (e.x - group.position.x) * lerpFactor;
    group.position.y += (jy - group.position.y) * lerpFactor;
    group.position.z += (e.y - group.position.z) * lerpFactor;
    group.rotation.y = facingToRotY(e.facing || 0);
    group.rotation.x = 0;

    if (!isFbx) {
      // Procedural walk bob + arm swing for primitive meshes
      const phase = e.walkPhase || 0;
      const bobAmp = e.sprinting ? 0.07 : 0.04;
      group.position.y = jy + Math.abs(Math.sin(phase)) * bobAmp;
      const parts = group.userData.parts;
      if (parts) {
        const swingAmp = e.sprinting ? 0.55 : 0.3;
        const swing = Math.sin(phase) * swingAmp;
        if (parts.armL) parts.armL.rotation.x = swing;
        if (parts.armR) parts.armR.rotation.x = -swing;
      }
      if (e.alive === false) {
        group.rotation.x = 1.2;
        group.position.y = 0.2;
      }
    }
  }

  function render(state, dt = 1 / 60) {
    // Room switching
    if (state.phase === 'MISSION') {
      if (currentRoomKind !== 'mission' || currentRoomSeed !== state.missionSeed) {
        setRoom('mission', state.missionMap);
        scene.background.set(0x04050a);
        scene.fog.color.set(0x04050a);
        scene.fog.near = 300; scene.fog.far = 1200;
      }
    } else {
      if (currentRoomKind !== 'lobby') {
        setRoom('lobby', null, state.lobbySeed);
        const ud = currentRoomGroup?.userData ?? {};
        scene.background.set(ud.bgColor ?? 0x04050a);
        scene.fog.color.set(ud.fogColor ?? ud.bgColor ?? 0x04050a);
        scene.fog.near = ud.fogNear ?? 300;
        scene.fog.far  = ud.fogFar  ?? 1200;
      }
    }

    // Animate lobby weather every frame
    if (currentRoomKind === 'lobby') {
      const wg = currentRoomGroup?.userData.weatherGroup;
      if (wg) {
        const wd = wg.userData;
        const wt = wd.weatherType;

        // ── Streak-based rain / rainstorm / thunderstorm ──────────────────
        if (wt === 'rain' || wt === 'thunderstorm') {
          const pos = wd.geo.attributes.position.array;
          const dy  = wd.vel * dt;
          const N   = pos.length / 6;
          for (let i = 0; i < N; i++) {
            const o = i * 6;
            pos[o + 1] += dy; pos[o + 4] += dy;
            if (pos[o + 4] < wd.Y_BOT) {
              // Reset to a random point in the full column — keeps distribution
              // uniform permanently and prevents streaks bunching into waves.
              const ny = wd.Y_BOT + Math.random() * wd.HEIGHT;
              pos[o + 1] = ny + wd.STREAK; pos[o + 4] = ny;
            }
          }
          wd.geo.attributes.position.needsUpdate = true;
        }

        // ── Point-based snow ──────────────────────────────────────────────
        if (wt === 'snow') {
          wd.time += dt;
          const t = wd.time, pos = wd.geo.attributes.position.array, ph = wd.phase;
          const N = pos.length / 3;
          for (let i = 0; i < N; i++) {
            const o = i * 3;
            pos[o + 1] += wd.vel * dt;
            pos[o]     += Math.sin(t * 0.45 + ph[i]) * 0.28 * dt;
            pos[o + 2] += Math.cos(t * 0.30 + ph[i]) * 0.14 * dt;
            if (pos[o + 1] < wd.Y_BOT) {
              pos[o + 1] = wd.Y_TOP + Math.random() * wd.HEIGHT * 0.10;
              pos[o]     = wd.X_MIN + Math.random() * (wd.X_MAX - wd.X_MIN);
              pos[o + 2] = wd.Z_MIN + Math.random() * (wd.Z_MAX - wd.Z_MIN);
            }
          }
          wd.geo.attributes.position.needsUpdate = true;
        }

        // ── Blizzard — heavy snow with gusting crosswind ──────────────────
        if (wt === 'blizzard') {
          wd.time += dt;
          const t = wd.time, pos = wd.geo.attributes.position.array, ph = wd.phase;
          const wind = Math.sin(t * 0.4) * 5.0 + Math.sin(t * 1.1) * 2.5; // gusty
          const N = pos.length / 3;
          for (let i = 0; i < N; i++) {
            const o = i * 3;
            pos[o + 1] += wd.vel * dt;
            pos[o + 2] += (wind + Math.sin(t * 0.9 + ph[i]) * 1.2) * dt;
            pos[o]     += Math.sin(t * 0.5 + ph[i]) * 0.5 * dt;
            if (pos[o + 1] < wd.Y_BOT) {
              pos[o + 1] = wd.Y_TOP + Math.random() * wd.HEIGHT * 0.08;
              pos[o]     = wd.X_MIN + Math.random() * (wd.X_MAX - wd.X_MIN);
              pos[o + 2] = wd.Z_MIN + Math.random() * (wd.Z_MAX - wd.Z_MIN);
            }
            // Wrap Z so blizzard particles don't permanently drift offscreen
            if (pos[o + 2] > wd.Z_MAX) pos[o + 2] = wd.Z_MIN + Math.random() * 20;
            if (pos[o + 2] < wd.Z_MIN) pos[o + 2] = wd.Z_MAX - Math.random() * 20;
          }
          wd.geo.attributes.position.needsUpdate = true;
        }

        // ── Thunderstorm lightning ────────────────────────────────────────
        if (wt === 'thunderstorm') {
          wd.lightningCooldown -= dt;
          if (wd.lightningDoubleDelay > 0) {
            wd.lightningDoubleDelay -= dt;
            if (wd.lightningDoubleDelay <= 0) wd.lightningFlash = 0.05 + Math.random() * 0.06;
          }
          if (wd.lightningCooldown <= 0) {
            wd.lightningFlash    = 0.09 + Math.random() * 0.10;
            wd.lightningCooldown = 1.5  + Math.random() * 7.0;
            _lightningStrikeCount++;
            if (Math.random() < 0.45) wd.lightningDoubleDelay = 0.10 + Math.random() * 0.18;
            // Randomise strike position across the city
            const midZ = currentRoomGroup.userData._midZ ?? 0;
            wd.lightningLight.position.set(
              35 + Math.random() * 80,
              55 + Math.random() * 70,
              midZ + (Math.random() - 0.5) * 400,
            );
          }

          const skyMat = currentRoomGroup?.userData.skyMat;
          if (wd.lightningFlash > 0) {
            wd.lightningFlash -= dt;
            const fl  = Math.max(0, wd.lightningFlash);
            const t   = Math.min(1, fl * 16); // 0→1 flash strength
            // Exterior light floods buildings
            wd.lightningLight.intensity = fl * 220;
            // Interior flash light floods the room through the window
            if (wd.flashLight) wd.flashLight.intensity = t * 14;
            // Sky sphere brightens — MeshBasicMaterial.color acts as HDR multiplier
            // under ACESFilmicToneMapping, values > 1 render as blown-out bright
            if (skyMat) skyMat.color.setScalar(1 + t * 5);
          } else {
            wd.lightningLight.intensity = 0;
            if (wd.flashLight) wd.flashLight.intensity = 0;
            if (skyMat) skyMat.color.setScalar(1); // restore normal sky
          }
        }
      }
    }


    // Animate Jam Portal shimmer (hallway back wall)
    if (currentRoomKind === 'lobby') {
      const ps = currentRoomGroup?.userData.portalSurface;
      const pl = currentRoomGroup?.userData.portalLight;
      if (ps && pl) {
        const t  = performance.now() * 0.001;
        // Cycle hue: cyan → violet → blue → cyan
        const r  = 0.30 * (1 + Math.sin(t * 0.80));
        const g  = 0.70 + 0.25 * Math.sin(t * 0.55 + 1.0);
        const b  = 0.90 + 0.10 * Math.sin(t * 0.70 + 2.5);
        ps.material.color.setRGB(r, g, b);
        ps.material.opacity = 0.70 + 0.14 * Math.sin(t * 2.3);
        pl.color.setRGB(r, g, b);
        pl.intensity = 1.8 + 0.6 * Math.sin(t * 2.3);
      }
    }

    // Gantz ball visible when not in mission
    ensureGantzBall(state.phase !== 'MISSION');
    if (gantzBall && state.gantzBallPos) {
      gantzBall.position.set(state.gantzBallPos.x, 0.96, state.gantzBallPos.y);

      // ── Opening animation ────────────────────────────────────────────────
      // Panels are curved sphere segments that TRANSLATE straight outward.
      // Left panel → -X, right panel → +X, back panel → -Z.
      // When panels slide out the gaps in the static shell expose the hollow interior.
      const op = state.gantzOpenProgress || 0;
      const ud = gantzBall.userData;
      const SLIDE = 2.2; // metres panels travel when fully open
      // Scales and positions each dynamic rod so it always bridges from the
      // sphere surface to the panel face, regardless of how far the panel has slid.
      function syncRods(panel, slideD) {
        const rc = panel?.userData?.rodConfig;
        if (!rc) return;
        const { rods, isX, slideSign } = rc;
        const axis = isX ? 'x' : 'z';
        for (const { mesh, exitRadius } of rods) {
          // Both ends of the rod are inset 8 cm inside their respective sphere
          // surfaces (ball side and panel side) so the shell geometry cleanly
          // hides the cut-off ends from any angle.  Using exitRadius for both
          // sides works because the panel IS the same sphere arc (same R).
          const r = exitRadius - 0.08;
          const sphereExitLocal = slideSign * (r - slideD); // ball-side end
          const panelFaceLocal  = slideSign * r;            // panel-side end
          const rodLen    = Math.abs(sphereExitLocal - panelFaceLocal);
          const rodCenter = (sphereExitLocal + panelFaceLocal) / 2;
          mesh.scale[axis]    = Math.max(0.001, rodLen);
          mesh.position[axis] = rodCenter;
          mesh.visible = slideD > 0.02;
        }
      }

      if (op > 0) {
        // Quadratic ease-out
        const t = 1 - Math.pow(1 - op, 2);
        const d = SLIDE * t;

        // Slide each panel along its axis
        if (ud.leftPanel)  ud.leftPanel.position.set(-d, 0, 0);
        if (ud.rightPanel) ud.rightPanel.position.set( d, 0, 0);
        if (ud.backPanel)  ud.backPanel.position.set(0, 0, -d);

        // Stretch rods to always connect sphere surface → panel face
        syncRods(ud.leftPanel,  d);
        syncRods(ud.rightPanel, d);
        syncRods(ud.backPanel,  d);

        // Interior light illuminates the human
        if (ud.interiorLight) {
          const pulse = op >= 1 ? 0.85 + 0.15 * Math.sin((state.time || 0) * 3.2) : 1;
          ud.interiorLight.intensity = t * 2.2 * pulse;
        }

        // Human figure visible as soon as the animation begins
        if (ud.humanGroup) ud.humanGroup.visible = true;

      } else {
        // Fully closed — panels back to origin, rods/human hidden
        if (ud.leftPanel)  ud.leftPanel.position.set(0, 0, 0);
        if (ud.rightPanel) ud.rightPanel.position.set(0, 0, 0);
        if (ud.backPanel)  ud.backPanel.position.set(0, 0, 0);

        // Hide all rods
        for (const panel of [ud.leftPanel, ud.rightPanel, ud.backPanel]) {
          panel?.userData?.rodConfig?.rods?.forEach(r => { r.mesh.visible = false; });
        }

        if (ud.interiorLight) ud.interiorLight.intensity = 0;
        if (ud.humanGroup) ud.humanGroup.visible = false;
      }
    }
    // Lock the display sphere to face into the room (toward lobby centre, +Z)
    if (ballDisplay && gantzBall) {
      ballDisplay.mesh.position.copy(gantzBall.position);
      ballDisplay.mesh.rotation.y = 0;
    }

    // Humans (player + civilians + remotes).
    // Always include the local player so its FBX instance stays resident in the
    // scene — toggling into third-person just flips `.visible`, with no shader
    // compile / scene-add hitch on the first TP switch. In first-person mode
    // the mesh is hidden below (see `isLocalFP` visibility handling).
    const keepHumans = new Set();
    const humanEntries = [
      ...(state.player ? [{ ...state.player, _id: '__player__', _suit: !!state.player.suit }] : []),
      ...(state.civilians || []).map(c => ({ ...c, _id: c.id, _suit: false, _isCivilian: true })),
      ...(state.remotes || []).map(r => ({ ...r, _id: r.peerId, _suit: !!r.suit })),
    ];
    for (const h of humanEntries) {
      if (!h.spec) continue;
      const entry = getOrCreateHuman(h._id, h.spec, { suit: h._suit });
      // FBX character assets not loaded yet — skip rendering this human
      // entirely rather than falling back to a procedural stand-in.
      if (!entry) continue;
      // Fallback reveal for entries hidden by the scan-pending gate — if no
      // scan has attached before the grace window expires, show the mesh.
      if (!entry.group.visible && entry.__firstShowAt && performance.now() >= entry.__firstShowAt) {
        entry.group.visible = true;
        entry.__firstShowAt = 0;
      }
      updateEntityTransform(entry.group, h, entry.isFbx, dt);
      // Civilians: use the vx/vy stamped by planCivilian — direct, no position-delta fragility.
      // They move at walk speed (1.5–2.6 m/s) so keep the walk tier to avoid foot-sliding.
      if (h._isCivilian && entry.isFbx) {
        const spd   = Math.sqrt((h.vx || 0) ** 2 + (h.vy || 0) ** 2);
        const moving = spd > 0.1;
        h.moveFwd   = moving ? 1.0 : 0;
        h.moveSide  = 0;
        h.walking   = moving;   // lobby_walk tier matches their actual movement pace
        h.sprinting = false;
      }
      if (entry.isFbx && entry.mixer) {
        if (h.alive === false) {
          // Pick a random death clip once when the character first dies; keep it after.
          if (!entry.deathAnim) {
            const n = Math.floor(Math.random() * 13) + 1;
            entry.deathAnim = `death_${n}`;
          }
          _crossfadeAnim(entry, entry.deathAnim, true);
        } else {
          // Civilians always use lobby animations regardless of mission phase
          const phase     = h._isCivilian ? 'LOBBY' : state.phase;
          const jumpId    = h.jumpId    || 0;
          const fireId    = h.fireId    || 0;
          const cur       = entry.currentAnim || '';
          const curAction = entry.actions[cur];
          const curRunning = curAction?.isRunning();
          const isJumpAnim    = cur.includes('jump');
          const isShootAnim   = cur === 'pistol_shoot';

          if (jumpId !== entry.lastJumpId) {
            entry.lastJumpId = jumpId;
            entry.jumpStartT = state.t || performance.now() / 1000;
            const jumpName = _pickJumpAnim(phase, h);
            _crossfadeAnim(entry, jumpName, true, true);
          } else if (isJumpAnim && curRunning) {
            // Physics-first exit: the moment jumpY hits 0, crossfade back to
            // ground. Timescale match above should make this near-coincide
            // with the clip's own end. Short hold guards against f1 rounding.
            const now = state.t || performance.now() / 1000;
            const held = now - (entry.jumpStartT || 0);
            if ((h.jumpY || 0) === 0 && held > 0.15) {
              _crossfadeAnim(entry, _pickGroundAnim(phase, h));
            }
          } else if (phase === 'MISSION' && fireId !== entry.lastFireId) {
            // New shot fired. Only play the pistol shoot animation when the
            // character is standing still and on the ground — while moving or
            // airborne the shoot clip overrides the movement/jump pose and
            // looks jarring. We still record the fireId so a later shot while
            // idle doesn't get treated as a stale one.
            entry.lastFireId = fireId;
            const moving = Math.abs(h.moveFwd || 0) > 0.05 || Math.abs(h.moveSide || 0) > 0.05;
            const airborne = (h.jumpY || 0) > 0;
            if (!moving && !airborne) {
              _crossfadeAnim(entry, 'pistol_shoot', true, true);
            } else {
              _crossfadeAnim(entry, _pickGroundAnim(phase, h));
            }
          } else if (phase === 'MISSION' && isShootAnim && curRunning) {
            // Interrupt the shoot clip the moment the player starts moving —
            // running while a standing-aim fire pose plays looks broken.
            const movingNow = Math.abs(h.moveFwd || 0) > 0.05 || Math.abs(h.moveSide || 0) > 0.05;
            if (movingNow) {
              _crossfadeAnim(entry, _pickGroundAnim(phase, h));
            }
            // else: let shoot finish
          } else {
            _crossfadeAnim(entry, _pickGroundAnim(phase, h));
          }
        }
        entry.mixer.update(dt);
        // Upper-body aim: after the mixer applies animation, add an aim offset
        // to Spine1/Spine2/Neck so the torso/head twist toward where the player
        // is actually looking. Twist is split across the chain for a natural
        // bend; feet (group.rotation.y) handle base yaw.
        _applyAimOffset(entry, h);
      }
      // Attach X-Gun mesh to right hand bone during missions; remove in lobby/death.
      const showHandGun = state.phase === 'MISSION' && h.alive !== false && !h._isCivilian;
      _setHandGun(entry, showHandGun);

      // Show name label for remotes and third-person local; hide for dead or local FP
      const isLocalFP = h._id === '__player__' && state.firstPerson;
      // Hide the local player mesh in first-person instead of removing it from
      // the scene — keeps the skinned-mesh shader/draw-state warm so toggling
      // to third-person doesn't hitch on a fresh scene.add + shader compile.
      //
      // Respect the scan-pending gate: getOrCreateHuman hides a brand-new entry
      // until either scan.start() flips it on (with uScanActive=1 discarding
      // the body via shader) or the grace window elapses — overwriting
      // visible=true here every frame would surface the full unscanned model
      // for exactly one frame before the scan relay runs next tick.
      const scanGateActive = entry.__firstShowAt && performance.now() < entry.__firstShowAt;
      if (!scanGateActive) entry.group.visible = !isLocalFP;
      // One-time: warm the shader programs AND the shadow-map depth pass for
      // the local-player skinned mesh against the real scene. `renderer.compile`
      // alone doesn't always cover skinning-depth variants for the shadow pass
      // — the hitch shows up the first time the shadow map has to render this
      // mesh. To guarantee every program is live, we do a throwaway full
      // render with the mesh temporarily visible. The user sees at most one
      // frame of their own character in front of the FP camera (near the
      // camera origin, mostly inside the head), which is imperceptible; what
      // matters is that the first real FP→TP toggle is then free.
      if (h._id === '__player__' && !entry.compiledOnce) {
        const wasVisible = entry.group.visible;
        entry.group.visible = true;
        renderer.shadowMap.needsUpdate = true;
        renderer.compile(scene, camera);
        renderer.render(scene, camera);           // forces shadow + main pass compile
        renderer.shadowMap.needsUpdate = true;    // let real frame rebuild shadows normally
        entry.group.visible = wasVisible;
        entry.compiledOnce = true;
      }
      const showLabel = !isLocalFP && h.alive !== false && !!h.username;
      updateNameLabel(entry, h.username, h.color, showLabel);
      updateChatBubble(entry, h.alive !== false ? (h.chatText || '') : '', h.chatAlpha || 0);
      keepHumans.add(h._id);
    }
    prune(humans, keepHumans);

    // Aliens
    const keepAliens = new Set();
    const now = state.time || (performance.now() / 1000);
    for (const a of state.aliens || []) {
      if (!a.spec) continue;
      const g = getOrCreateAlien(a.id, a.spec);
      if (g.userData._sc == null) g.userData._sc = a.spec.size;
      const _alf = 1 - Math.exp(-14 * dt);
      // Base ground Y — floaters hover above 0
      const baseY = g.userData.bodyPlan === 'floater' ? 0.0 : 0.0;
      g.position.x += (a.x - g.position.x) * _alf;
      g.position.z += (a.y - g.position.z) * _alf;
      g.position.y += (baseY - g.position.y) * _alf;
      g.rotation.y = facingToRotY(a.facing || 0);

      if (a.alive === false) {
        // X-Gun detonation vaporizes the alien — the gib burst handles the
        // visual, so just hide the mesh.
        g.visible = false;
      } else {
        g.visible = true;
        // Attack pulse: rising edge on attackCooldown freshly set = new attack.
        const maxCD = 1.6; // biggest archetype cooldown — ok upper bound
        const cd = a.attackCooldown || 0;
        const prevCD = g.userData._prevCD || 0;
        if (cd > prevCD + 0.1) {
          // new attack triggered this frame
          g.userData._attackPulse = 1.0;
        }
        g.userData._prevCD = cd;
        animateAlienMesh(g, a, now, dt);
        // Floater hover offset applied after animate sets _hoverOffset
        if (g.userData.bodyPlan === 'floater' && g.userData._hoverOffset != null) {
          g.position.y += g.userData._hoverOffset;
        }
        // Only reset x rotation if not driven by attack (quadruped rears up)
        if (g.userData.bodyPlan !== 'quadruped') g.rotation.x = 0;
      }
      keepAliens.add(a.id);
    }
    prune(aliens, keepAliens);

    // Props (lobby + mission)
    const keepProps = new Set();
    const propList = state.phase === 'MISSION' ? (state.missionProps || []) : (state.lobbyProps || []);
    for (const p of propList) {
      const pid = `${p.type || p.spec?.type}:${p.x}:${p.y}`;
      const g = getOrCreateProp(pid, p.type || p.spec?.type, p.spec);
      g.position.set(p.x, 0, p.y);
      keepProps.add(pid);
    }
    prune(props, keepProps);

    // Bullets: spawn new projectiles for each fired shot, then step existing
    // ones forward. Each shot payload carries the 2D origin (x1, y1) and the
    // hitscan endpoint (x2, y2); we lift both to the muzzle height so the
    // projectile reads as leaving the gun rather than the floor.
    if (state.newTracers) {
      for (const t of state.newTracers) {
        // If the shooter provided a 3D muzzle origin (local FP shot), use it
        // so the bullet emerges from the actual gun barrel. Otherwise fall
        // back to the 2D shot origin lifted to a default gun height.
        const ox = (t.ox != null) ? t.ox : t.x1;
        const oy = (t.oy != null) ? t.oy : BULLET_MUZZLE_Y;
        const oz = (t.oz != null) ? t.oz : t.y1;
        const ex = (t.ex != null) ? t.ex : t.x2;
        const ey = (t.ey != null) ? t.ey : BULLET_MUZZLE_Y;
        const ez = (t.ez != null) ? t.ez : t.y2;
        spawnBullet(
          ox, oy, oz,
          ex, ey, ez,
          t.color || '#66ddff',
        );
      }
    }
    _stepBullets(dt, state);
    _stepGibs(dt);
    _scanController.update(humans);

    // Camera
    const focus = state.focus || state.player;
    if (focus) {
      // Step the FP↔TP transition value toward the scroll target.
      {
        const step = TP_TRANS_RATE * dt;
        if (_tpMix < _tpTarget)      _tpMix = Math.min(_tpTarget, _tpMix + step);
        else if (_tpMix > _tpTarget) _tpMix = Math.max(_tpTarget, _tpMix - step);
      }

      if (_tpMix > 0.001) {
        // ── THIRD-PERSON (spring arm, Fortnite-style) ─────────────────────
        // When _tpMix < 1 we're mid-transition: the final camera state is a
        // smoothstep blend between the FP solution and the TP solution, so
        // both FP→TP and TP→FP glides are perfectly smooth.

        const yaw   = state.yaw   || 0;
        const pitch = Math.max(TP_PITCH_MIN, Math.min(TP_PITCH_MAX, -(state.pitch || 0)));

        // Direction vectors (game 2D x,y → Three.js x,z)
        const sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw);
        const fwdX   = -sinYaw, fwdZ = -cosYaw;   // forward in XZ
        const rtX    =  cosYaw, rtZ  = -sinYaw;   // right   in XZ

        // Raw pivot = player's shoulder/chest height (the orbit centre)
        const rawPivotX = focus.x;
        const rawPivotY = TP_PIVOT_H + (state.jumpY || 0);
        const rawPivotZ = focus.y;

        // Smooth the pivot position — this is the root fix for jitter.
        // Both the camera arm origin AND the look-at target derive from this
        // smoothed value, so they can never diverge and cause judder.
        if (_tpSnap) {
          _tpSmoothPivot.set(rawPivotX, rawPivotY, rawPivotZ);
        } else {
          _tpSmoothPivot.lerp(
            new THREE.Vector3(rawPivotX, rawPivotY, rawPivotZ),
            Math.min(1, TP_LERP * dt)
          );
        }
        const pivotX = _tpSmoothPivot.x;
        const pivotY = _tpSmoothPivot.y;
        const pivotZ = _tpSmoothPivot.z;

        // ADS transition — smoothstep 0→1
        _tpADST += (_tpADS ? 1 : -1) * TP_ADS_SPEED * dt;
        _tpADST  = Math.max(0, Math.min(1, _tpADST));
        const _tpADSE = _tpADST * _tpADST * (3 - 2 * _tpADST); // smoothstep easing

        // Lerp arm length + shoulder offset between hip and ADS values
        const armLength = TP_ARM_LENGTH + (TP_ARM_LENGTH_ADS - TP_ARM_LENGTH) * _tpADSE;
        const shoulderX = TP_SHOULDER_X + (TP_SHOULDER_X_ADS - TP_SHOULDER_X) * _tpADSE;

        // Spherical spring arm: pitch angles camera up/down while keeping orbit
        const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
        const backDir  = new THREE.Vector3(
          sinYaw * cosPitch,   // X
          sinPitch,            // Y  (rises with positive pitch)
          cosYaw * cosPitch    // Z
        );

        // Ideal cam = smoothed pivot + arm + shoulder offset
        const idealX = pivotX + backDir.x * armLength + rtX * shoulderX;
        const idealY = pivotY + backDir.y * armLength;
        const idealZ = pivotZ + backDir.z * armLength + rtZ * shoulderX;

        // Wall collision: ray from smoothed pivot → ideal camera position
        const roomKey = (currentRoomKind || 'lobby') + (currentRoomSeed || '');
        if (roomKey !== _tpCollidableKey) {
          _rebuildTPCollidables();
          _tpCollidableKey = roomKey;
        }
        const pivotV  = new THREE.Vector3(pivotX, pivotY, pivotZ);
        const idealV  = new THREE.Vector3(idealX, idealY, idealZ);
        const toIdeal = new THREE.Vector3().subVectors(idealV, pivotV);
        const armLen  = toIdeal.length();
        const armDir  = toIdeal.clone().normalize();
        _tpRaycaster.set(pivotV, armDir);
        _tpRaycaster.near = 0.15;
        _tpRaycaster.far  = armLen;
        const hits    = _tpRaycaster.intersectObjects(_tpCollidables, false);
        let   safePos = idealV;
        for (const h of hits) {
          const sd = h.distance - 0.3;
          if (sd < armLen) {
            safePos = pivotV.clone().addScaledVector(armDir, Math.max(0.3, sd));
            break;
          }
        }

        // Snap on the very first TP frame (fresh entry) so smoothed values
        // don't carry over stale state from a previous TP session.
        if (_tpSnap) {
          _tpSmoothPos.copy(safePos);
          _tpSnap = false;
        }

        // Smooth follow — lerp gives the camera arm its "weight". During ADS
        // the arm becomes (nearly) rigid so fast mouse swings can't leave the
        // character behind the camera's FOV; lerps TP_LERP → 40 across _tpADSE.
        const followLerp = TP_LERP + (40 - TP_LERP) * _tpADSE;
        _tpSmoothPos.lerp(safePos, Math.min(1, followLerp * dt));

        // TP look-at target: forward + matching shoulder offset (prevents the
        // camera from tilting left to compensate for its rightward position).
        const tpLookX = pivotX + fwdX * TP_LOOK_FWD + rtX * shoulderX;
        const tpLookY = pivotY;
        const tpLookZ = pivotZ + fwdZ * TP_LOOK_FWD + rtZ * shoulderX;
        const tpFov   = TP_FOV + (TP_FOV_ADS - TP_FOV) * _tpADSE;

        // ── FP solution (for blending during transition) ────────────────
        const bob    = state.bob || 0;
        const fpEyeY = EYE_HEIGHT + bob + (state.jumpY || 0);
        const fpPitch = state.pitch || 0;
        const cosFPp  = Math.cos(fpPitch), sinFPp = Math.sin(fpPitch);
        // FP forward from YXZ Euler (pitch, yaw, 0) applied to -Z
        const fpFwdX = -sinYaw * cosFPp;
        const fpFwdY =  sinFPp;
        const fpFwdZ = -cosYaw * cosFPp;
        const LOOK_DIST = 10;
        const fpLookX = focus.x + fpFwdX * LOOK_DIST;
        const fpLookY = fpEyeY  + fpFwdY * LOOK_DIST;
        const fpLookZ = focus.y + fpFwdZ * LOOK_DIST;
        const fpFov   = _fpFov;

        // Smoothstep the blend weight so FP↔TP eases in/out of the motion.
        const e = _tpMix * _tpMix * (3 - 2 * _tpMix);

        camera.position.set(
          focus.x + (_tpSmoothPos.x - focus.x) * e,
          fpEyeY  + (_tpSmoothPos.y - fpEyeY)  * e,
          focus.y + (_tpSmoothPos.z - focus.y) * e
        );
        camera.lookAt(
          fpLookX + (tpLookX - fpLookX) * e,
          fpLookY + (tpLookY - fpLookY) * e,
          fpLookZ + (tpLookZ - fpLookZ) * e
        );
        camera.fov = fpFov + (tpFov - fpFov) * e;
        camera.updateProjectionMatrix();

        // Viewmodel: visible during the first chunk of the transition so there's
        // no hard pop, then hidden once the camera is past the halfway point.
        // Also hidden entirely outside of missions (no gun in the lobby).
        viewWeapon.visible = (e < 0.4) && (state.playerAlive !== false) && (state.phase === 'MISSION');
        if (viewWeapon.visible) _drawGantzScreen(dt, state);
        muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);

      } else {
        // ── FIRST-PERSON ──────────────────────────────────────────────────
        const bob = state.bob || 0;
        camera.position.set(focus.x, EYE_HEIGHT + bob + (state.jumpY || 0), focus.y);
        camera.rotation.order = 'YXZ';
        camera.rotation.y = state.yaw || 0;
        camera.rotation.x = state.pitch || 0;
        camera.rotation.z = 0;
        viewWeapon.visible = (state.playerAlive !== false) && (state.phase === 'MISSION');
        // Update Gantz HUD screen texture every frame
        if (viewWeapon.visible) _drawGantzScreen(dt, state);
        // Muzzle flash — light decays every frame
        muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);

        // ── ADS transition ────────────────────────────────────────────────
        _adsT += (_adsActive && viewWeapon.visible ? 1 : -1) * dt * 8;
        _adsT = Math.max(0, Math.min(1, _adsT));
        const _adsE = _adsT * _adsT * (3 - 2 * _adsT); // smoothstep

        // ── Viewmodel animation ──────────────────────────────────────────
        const wd = viewWeapon.userData;
        wd.idleTime = (wd.idleTime || 0) + dt;

        // Spring-decay all recoil axes
        const sp = dt * 1.2;
        wd.recoil     = Math.max(0, (wd.recoil     || 0) - sp * 0.6);
        wd.recoilY    = Math.max(0, (wd.recoilY    || 0) - sp * 0.8);
        wd.recoilRot  = Math.max(0, (wd.recoilRot  || 0) - sp * 0.8);
        wd.recoilRoll = (wd.recoilRoll || 0) * Math.max(0, 1 - sp * 1.2);

        // Idle sway + walk bob — suppressed during ADS
        const hipAmt  = 1 - _adsE;
        const swayX   = Math.sin(wd.idleTime * 0.7) * 0.004 * hipAmt;
        const swayY   = Math.sin(wd.idleTime * 0.4) * 0.003 * hipAmt;
        const walkBob = (state.bob || 0) * 0.4 * hipAmt;

        // Lerp between hip-fire and ADS position.
        // ADS: side-profile centred on screen, barrel aligned with crosshair.
        viewWeapon.position.set(
          0.46 + (0.128 - 0.46) * _adsE + swayX,
          -0.38 + (-0.31 - -0.38) * _adsE + swayY + walkBob + (wd.recoilY || 0),
          -0.55 + (-0.45 - -0.55) * _adsE + (wd.recoil || 0),
        );
        viewWeapon.rotation.set(
          -0.15 * _adsE + (wd.recoilRot  || 0),
          -0.35 * _adsE,
          -0.04 * _adsE + (wd.recoilRoll || 0) * hipAmt,
        );

        // Muzzle light stays at barrel tip (hip and ADS both use same x since tip = -0.188).
        muzzleLight.position.x = MUZZLE_TIP.x;

        // ── Barrel panel extension ───────────────────────────────────────
        // Lazily resolve panel refs on first render after GLB loads
        if (!_panelL || !_panelR || !_panelB) {
          viewWeapon.traverse(n => {
            if (n.name === 'Object_7') _panelL = n;
            if (n.name === 'Object_8') _panelR = n;
            if (n.name === 'Object_6') _panelB = n;
          });
        }
        // Two layers: ADS hold (smooth open while aiming) + fire spike (quick kick on shoot)
        _barrelExtend = Math.max(0, _barrelExtend - dt * 6); // fire spike decays
        const _be   = _barrelExtend * _barrelExtend * (3 - 2 * _barrelExtend); // smoothstep fire
        if (_panelL) _panelL.position.x = -0.08 * _be; // fire spike only
        if (_panelR) _panelR.position.x =  0.08 * _be; // fire spike only
        if (_panelB) _panelB.position.x =  0.08 * _be; // fire spike only

        // FOV narrows 17° during ADS (subtle zoom)
        const fovTarget = _fpFov - 17 * _adsE;
        camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 10);
        camera.updateProjectionMatrix();
      }
      // ── FLY CAM overrides any FP/TP camera ──────────────────────────────
      if (_flyCamActive) {
        _flyCamTick(dt);
        camera.position.copy(_flyCamPos);
        camera.rotation.order = 'YXZ';
        camera.rotation.y = _flyCamYaw;
        camera.rotation.x = _flyCamPitch;
        camera.rotation.z = 0;
        camera.fov = _fpFov;
        camera.updateProjectionMatrix();
        viewWeapon.visible = false;
      }
    }


    // Pass 1 — main scene on layer 0 (viewmodel + vm lights excluded).
    camera.layers.set(0);
    renderer.render(scene, camera);
    // Pass 2 — viewmodel on layer 2, lit only by vm lights. Disable autoClear
    // AND null out scene.background (three.js still clears to bg color on
    // render() even with autoClear=false), then only clear depth so the gun
    // draws on top of the scene without z-fighting at low ADS FOV.
    const _prevAutoClear = renderer.autoClear;
    const _prevBackground = scene.background;
    const _prevFog = scene.fog;
    renderer.autoClear = false;
    scene.background = null;
    scene.fog = null; // fog would darken the gun as if it were at scene depth
    renderer.clearDepth();
    camera.layers.set(VIEWMODEL_LAYER);
    renderer.render(scene, camera);
    scene.background = _prevBackground;
    scene.fog = _prevFog;
    renderer.autoClear = _prevAutoClear;
    camera.layers.set(0); // restore for any post-render layer-sensitive logic
  }

  function triggerMuzzleFlash() {
    muzzleLight.intensity = 20.0;
    // Trigger barrel panel extension
    _barrelExtend = 1;
    // ADS tightens recoil — scale down to 50% at full ADS
    const adsScale = 1 - 0.5 * _adsT;
    viewWeapon.userData.recoil     = 0.22  * adsScale;  // z kick back
    viewWeapon.userData.recoilY    = 0.10  * adsScale;  // gun kicks up
    viewWeapon.userData.recoilRot  = 0.45  * adsScale;  // barrel pitches up
    viewWeapon.userData.recoilRoll = -0.10;              // roll suppressed by hipAmt anyway
  }

  // Camera forward vector projected to the XZ (game) plane.
  // Returns { x, y } where y is the 2D-y (= world Z).
  const _forwardV = new THREE.Vector3();
  function getCameraForwardXZ() {
    camera.getWorldDirection(_forwardV);
    let x = _forwardV.x, z = _forwardV.z;
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, y: z / len };
  }

  // Full 3D camera forward (includes pitch). Used by the local shooter to
  // make bullets fly exactly along the crosshair direction, not along the
  // muzzle→hitpoint line (those two diverge slightly because the muzzle is
  // offset from the camera).
  function getCameraForward3D() {
    camera.getWorldDirection(_forwardV);
    return { x: _forwardV.x, y: _forwardV.y, z: _forwardV.z };
  }

  // Camera origin projected to the XZ (game) plane. Used together with
  // getCameraForwardXZ() by game.js to run a 2D hitscan from the camera's
  // actual world position — this is what the crosshair is looking along.
  // In FP camera ≈ player head so origin ≈ player; in TP the camera sits
  // behind+right of the player and the hitscan picks up the correct target.
  function getCameraOriginXZ() {
    return { x: camera.position.x, y: camera.position.z };
  }

  // Full 3D camera position.
  function getCameraOrigin3D() {
    return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  }

  // Mouse raycast against ground plane (y = 0)
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  function screenToGround(screenX, screenY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = (screenX / rect.width) * 2 - 1;
    ndc.y = -(screenY / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, pt)) {
      return { x: pt.x, y: pt.z };
    }
    return null;
  }

  // Raycast a screen click against the ball display sphere, returning UV coords.
  const _ballRaycaster = new THREE.Raycaster();
  const _ballNdc = new THREE.Vector2();
  function raycastBallDisplay(screenX, screenY) {
    if (!ballDisplay) return null;
    const rect = canvas.getBoundingClientRect();
    _ballNdc.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    _ballNdc.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    _ballRaycaster.setFromCamera(_ballNdc, camera);
    const hits = _ballRaycaster.intersectObject(ballDisplay.mesh);
    return hits.length ? hits[0].uv : null;
  }

  // Project a world-space point to CSS screen coordinates.
  // Returns { x, y, behind } where behind=true means it's behind the camera.
  const _projV = new THREE.Vector3();
  function worldToScreen(wx, wy, wz) {
    _projV.set(wx, wy, wz).project(camera);
    return {
      x: (_projV.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-_projV.y * 0.5 + 0.5) * canvas.clientHeight,
      behind: _projV.z > 1,
    };
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  addEventListener('resize', resize);
  resize();

  // Pre-warm the bullet materials so the first shot doesn't pay the shader
  // program compile cost. We add a throwaway bullet mesh to the scene just
  // long enough for renderer.compile() to include it in its walk, then
  // remove it. Pooled lights already force the scene's lightsHash to its
  // final value, so compile() here produces the exact programs every lit
  // material will need at runtime.
  {
    const warmCore = new THREE.Mesh(_bulletGeom, _bulletCoreMat);
    const warmHalo = new THREE.Mesh(_bulletHaloGeom, _bulletHaloMat);
    warmCore.position.set(0, -2000, 0); warmCore.add(warmHalo);
    scene.add(warmCore);
    if (typeof renderer.compileAsync === 'function') {
      renderer.compileAsync(scene, camera).catch(() => {
        try { renderer.compile(scene, camera); } catch (e) { /**/ }
      });
    } else {
      try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
    }
    scene.remove(warmCore);
  }

  return {
    render,
    screenToGround,
    getCameraForwardXZ,
    getCameraForward3D,
    getCameraOriginXZ,
    getCameraOrigin3D,
    getMuzzleWorldPosition,
    // Returns the world-space position of a remote peer's (or NPC's) hand
    // gun, so their fired bullets can visually emerge from their weapon
    // instead of their chest. Returns null if the peer hasn't been
    // instantiated yet or doesn't have a gun attached.
    getRemoteMuzzleWorldPosition(id) {
      const entry = humans.get(id);
      if (!entry || !entry.handGun) return null;
      const anchor = entry.handGun.tip || entry.handGun.mesh;
      anchor.updateWorldMatrix(true, false);
      _muzzleWorldV.setFromMatrixPosition(anchor.matrixWorld);
      return { x: _muzzleWorldV.x, y: _muzzleWorldV.y, z: _muzzleWorldV.z };
    },
    // DEV: live-tune the third-person hand-gun barrel tip anchor in local
    // gun-space. Example in console:
    //   __gantz.scene3d.setHandGunTipOffset(0, 0.7, 0)
    setHandGunTipOffset(x, y, z) {
      _HAND_GUN_BARREL_TIP.set(x, y, z);
      for (const entry of humans.values()) {
        if (entry.handGun && entry.handGun.tip) {
          entry.handGun.tip.position.set(x, y, z);
        }
      }
    },
    // DEV: live-tune the bullet spawn anchor. Example in console:
    //   __gantz.scene3d.setBarrelTipOffset(-0.188, 0.24, 0.05)
    setBarrelTipOffset(x, y, z) { _barrelTip.position.set(x, y, z); },
    triggerMuzzleFlash,
    spawnGibs,
    startTransferScan(id, opts) {
      const entry = id ? humans.get(id) : [...humans.values()][0];
      if (!entry) return false;
      _scanController.start(entry, opts);
      return true;
    },
    isTransferScanning(id) {
      const entry = id ? humans.get(id) : [...humans.values()][0];
      return entry ? _scanController.isScanning(entry) : false;
    },
    // True once the FBX character mesh + clips have loaded and the shared
    // instance pool has been primed. Initial-load scan waits for this so the
    // scan doesn't run on the procedural fallback and lose its material patch
    // when the pool swaps in later.
    isCharReady() {
      return !!(_charTemplate && _charClips && _charPool.length > 0);
    },
    worldToScreen,
    raycastBallDisplay,
    get ballDisplay() { return ballDisplay; },
    // Current lobby weather key ('rain' | 'snow' | 'blizzard' | 'thunderstorm'
    // | 'clear' | 'light_fog') while the lobby room is active;
    // null otherwise. Used by game.js to pick the matching ambient loop.
    getLobbyWeatherType() {
      if (currentRoomKind !== 'lobby') return null;
      return currentRoomGroup?.userData?.weatherType ?? null;
    },
    setLobbyWeatherType(type) {
      if (currentRoomKind !== 'lobby' || !currentRoomGroup) return;
      const oldWg = currentRoomGroup.userData.weatherGroup;
      if (oldWg) { currentRoomGroup.remove(oldWg); disposeGroup(oldWg); }
      const { group, fogNear, fogFar, fogColor } = buildWeatherGroup(type || 'clear');
      if (group) { currentRoomGroup.add(group); currentRoomGroup.userData.weatherGroup = group; }
      else currentRoomGroup.userData.weatherGroup = null;
      currentRoomGroup.userData.weatherType = type || null;
      const bg = currentRoomGroup.userData.bgColor ?? 0x04050a;
      scene.fog.color.set(fogColor ?? bg);
      scene.fog.near = fogNear;
      scene.fog.far  = fogFar;
    },
    getLightningStrikeCount() { return _lightningStrikeCount; },
    resize,
    get camera() { return camera; },
    get scene() { return scene; },
    // True while transitioning to or holding third-person, so game.js hides the
    // FP overlays and scene3d shows the local player mesh for the entire glide.
    isThirdPerson() { return _tpTarget === 1 || _tpMix > 0.001; },
    // Programmatically select the camera mode (e.g. phase-based defaults). The
    // existing smooth easing via `_tpMix` handles the transition; `_tpSnap`
    // mirrors the wheel-entry path so entering TP from a clean state doesn't
    // lerp in from a stale smooth pivot.
    setThirdPerson(on) {
      const want = on ? 1 : 0;
      if (_tpTarget === want) return;
      _tpTarget = want;
      if (want === 1 && _tpMix <= 0.001) _tpSnap = true;
      if (want === 0) _tpADS = false;
    },
    // True while the local player is holding right-mouse (aim-down-sights).
    // Exposed so game.js can gate sprint while aiming.
    isAds() { return _adsActive; },
    // DEV: live-tune the hand gun position/rotation from the browser console.
    // Example: scene3d.setHandGunOffset(0, 5, -3); scene3d.reattachHandGuns()
    setHandGunOffset(x, y, z) { _HAND_GUN_POS.set(x, y, z); },
    setHandGunRotation(x, y, z) { _HAND_GUN_ROT.set(x, y, z); },
    debugAnimState(id) {
      const e = id ? humans.get(id) : [...humans.values()][0];
      if (!e) return 'entry not found';
      return {
        currentAnim:  e.currentAnim,
        lastJumpId:   e.lastJumpId,
        hasLobbyJump: 'lobby_jump' in (e.actions || {}),
        actionKeys:   Object.keys(e.actions || {}),
      };
    },
    debugGunState() {
      const entries = [...humans.entries()].map(([id, e]) => ({
        id, isFbx: e.isFbx, hasGun: !!e.handGun, hasBone: !!_findBone(e.group, 'RightHand'),
      }));
      return { templateLoaded: !!_worldGunTemplate, worldGunScale: _worldGunScale, entries };
    },
    // Dev tool: create/update/remove wireframe box overlays for custom collision zones.
    // Game coords: (x, y) → 3D (X, 0, Z). Called each frame by devMode.update().
    setDevZones(zones) {
      if (!_devZoneMeshes) return;
      const inLobby = currentRoomKind === 'lobby';
      const seen = new Set();
      for (const z of zones) {
        seen.add(z._devId);
        const yLo = z.yMin ?? 0;
        const yHi = z.yMax ?? 3;
        let entry = _devZoneMeshes.get(z._devId);
        if (!entry) {
          const mat = new THREE.LineBasicMaterial({
            color: 0xff8800, transparent: true, opacity: 0.75,
            depthTest: true, depthWrite: false,
          });
          const mesh = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), mat);
          scene.add(mesh);
          entry = { mesh, mat, lastW: -1, lastH: -1, lastD: -1, lastKind: '' };
          _devZoneMeshes.set(z._devId, entry);
        }
        const sh = Math.max(0.01, yHi - yLo);
        const sw = z.kind === 'circle' ? (z.r || 1) : z.w;
        const sd = z.kind === 'circle' ? (z.r || 1) : z.h;
        const geomChanged = entry.lastW !== sw || entry.lastH !== sh || entry.lastD !== sd || entry.lastKind !== z.kind;
        if (geomChanged) {
          entry.mesh.geometry.dispose();
          if (z.kind === 'circle') {
            entry.mesh.geometry = new THREE.EdgesGeometry(new THREE.CylinderGeometry(sw, sw, sh, 16));
          } else {
            entry.mesh.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(sw, sh, sd));
          }
          entry.lastW = sw; entry.lastH = sh; entry.lastD = sd; entry.lastKind = z.kind;
        }
        const centerY = (yLo + yHi) / 2;
        entry.mesh.position.set(z.x, centerY, z.y);
        entry.mesh.visible = inLobby && !z.hidden;
        entry.mat.color.setHex(0xff8800);
        // Fill mesh for "visible colored wall"
        const wantFill = !!(z.wallColor);
        if (wantFill !== !!entry.fillMesh || geomChanged) {
          if (entry.fillMesh) { scene.remove(entry.fillMesh); entry.fillMesh.geometry.dispose(); entry.fillMesh.material.dispose(); entry.fillMesh = null; }
          if (wantFill) {
            const fillGeo = z.kind === 'circle'
              ? new THREE.CylinderGeometry(sw, sw, sh, 16)
              : new THREE.BoxGeometry(sw, sh, sd);
            const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(z.wallColor), transparent: true, opacity: z.wallOpacity ?? 0.28, depthWrite: true, side: THREE.DoubleSide });
            entry.fillMesh = new THREE.Mesh(fillGeo, fillMat);
            scene.add(entry.fillMesh);
            entry.lastFillColor = z.wallColor;
          }
        }
        if (entry.fillMesh) {
          const op = z.wallOpacity ?? 0.28;
          entry.fillMesh.position.set(z.x, centerY, z.y);
          entry.fillMesh.visible = inLobby;
          entry.fillMesh.material.opacity = op;
          entry.fillMesh.material.transparent = op < 0.99;
          entry.fillMesh.material.depthWrite = op >= 0.99;
          entry.fillMesh.material.color.set(z.wallColor);
        }
      }
      for (const [id, entry] of _devZoneMeshes) {
        if (!seen.has(id)) {
          scene.remove(entry.mesh);
          if (entry.fillMesh) { scene.remove(entry.fillMesh); entry.fillMesh.geometry.dispose(); entry.fillMesh.material.dispose(); }
          entry.mesh.geometry.dispose(); entry.mat.dispose();
          _devZoneMeshes.delete(id);
        }
      }
    },
    toggleEntityLabels(show) {
      for (const entry of [...humans.values(), ...aliens.values()]) {
        const label = entry.group?.children.find(c => c.userData.isNameLabel);
        if (label) label.visible = show;
      }
    },
    // Force-reattach all live hand guns with current offset/rotation values.
    // Also forces a detach+reattach so new rotation is applied from scratch.
    reattachHandGuns() {
      for (const entry of humans.values()) {
        if (entry.handGun) {
          entry.handGun.bone.remove(entry.handGun.mesh);
          entry.handGun = null;
        }
      }
      // _setHandGun will re-attach on next render tick
    },
    flyCam: {
      get active() { return _flyCamActive; },
      onMouseMove(dx, dy) {
        _flyCamYaw   -= dx * 0.0022;
        _flyCamPitch -= dy * 0.0022;
        _flyCamPitch  = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, _flyCamPitch));
      },
      enable() {
        _ensureFcListeners();
        _flyCamPos.set(camera.position.x, camera.position.y, camera.position.z);
        _flyCamYaw   = camera.rotation.y;
        _flyCamPitch = camera.rotation.x;
        _flyCamActive = true;
      },
      disable() {
        _flyCamActive = false;
        _flyCamKeys.clear();
        _cityDragId = null;
        renderer.domElement.style.cursor = '';
      },
      get speed() { return _flyCamSpeed; },
      set speed(v) { _flyCamSpeed = Math.max(1, Math.min(500, v)); },
    },
    cityBuilder: {
      _load(url, cb) {
        if (_cityGltfCache.has(url)) { cb(_cityGltfCache.get(url)); return; }
        const loader = new GLTFLoader();
        loader.load(url, gltf => {
          _cityGltfCache.set(url, gltf.scene);
          cb(gltf.scene);
        }, undefined, err => console.warn('[cityBuilder] load error', url, err));
      },
      getModelChildren(url, cb) {
        this._load(url, tmpl => {
          let children = tmpl.children;
          while (children.length === 1 && children[0].isObject3D && !children[0].isMesh) {
            children = children[0].children;
          }
          cb(children.map((c, i) => ({ index: i, name: c.name || `Object_${i}` })));
        });
      },
      place(placement) {
        const id = `cb${++_cityIdCounter}`;
        const { url, childName = null, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1 } = placement;
        const DEG = Math.PI / 180;
        const wrapper = new THREE.Group();
        wrapper.position.set(x, y, z);
        wrapper.rotation.set(rx * DEG, ry * DEG, rz * DEG);
        wrapper.scale.setScalar(scale);
        scene.add(wrapper);
        _cityObjects.set(id, { mesh: wrapper, placement: { url, childName, x, y, z, rx, ry, rz, scale, id } });
        this._load(url, tmpl => {
          if (!_cityObjects.has(id)) return;
          let source = tmpl;
          if (childName) {
            const found = tmpl.getObjectByName(childName);
            if (found) source = found;
          }
          const inst = source.clone(true);
          // Add to scene first so matrixWorld is valid for world-space bbox checks
          wrapper.add(inst);
          inst.updateWorldMatrix(true, true);
          inst.traverse(o => {
            if (!o.isMesh) return;
            // 3ds Max backdrop room meshes: Exterior_Material_#NNN_N / INTERIOR_Material_#NNN_N
            if (/Material_#\d+_\d+/i.test(o.name)) { o.visible = false; return; }
            // Size-based fallback for other models: hide if > 600m world-space in any axis
            if (o.geometry) {
              o.geometry.computeBoundingBox();
              const worldBB = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
              const dims = [worldBB.max.x-worldBB.min.x, worldBB.max.y-worldBB.min.y, worldBB.max.z-worldBB.min.z];
              if (Math.max(...dims) > 600) { o.visible = false; return; }
            }
            if (Array.isArray(o.material)) o.material = o.material.map(m => m.clone());
            else if (o.material) o.material = o.material.clone();
          });
          if (_citySelId === id && _citySelBox) _citySelBox.update();
        });
        return id;
      },
      remove(id) {
        const entry = _cityObjects.get(id);
        if (!entry) return;
        if (_citySelId === id) _citySetSel(null);
        scene.remove(entry.mesh);
        disposeGroup(entry.mesh);
        _cityObjects.delete(id);
      },
      update(id, patch) {
        const entry = _cityObjects.get(id);
        if (!entry) return;
        Object.assign(entry.placement, patch);
        const p = entry.placement;
        const DEG = Math.PI / 180;
        entry.mesh.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
        entry.mesh.rotation.set((p.rx ?? 0) * DEG, (p.ry ?? 0) * DEG, (p.rz ?? 0) * DEG);
        entry.mesh.scale.setScalar(p.scale ?? 1);
        if (_citySelId === id && _citySelBox) _citySelBox.update();
      },
      setSelection(id) { _citySetSel(id); },
      refreshSelection() { if (_citySelBox) _citySelBox.update(); },
      get onDragSelect() { return _cityOnDragSelect; },
      set onDragSelect(fn) { _cityOnDragSelect = fn; },
      get onDragEnd() { return _cityOnDragEnd; },
      set onDragEnd(fn) { _cityOnDragEnd = fn; },
      getAll() { return [..._cityObjects.values()].map(e => ({ ...e.placement })); },
      clearAll() {
        _citySetSel(null);
        for (const entry of _cityObjects.values()) { scene.remove(entry.mesh); disposeGroup(entry.mesh); }
        _cityObjects.clear();
      },
    },
    setFpFov(fov) {
      _fpFov = Math.max(50, Math.min(110, fov));
    },
    // Load an additional character variant (GLB or FBX) and add it to the random pool.
    // Drop a new Mixamo character GLB in assets/models/character/ and call this once.
    loadCharVariant(url) { _loadCharVariant(url); },
  };
}
