import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFLoader } from 'https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import {
  buildHumanMesh, buildAlienMesh, buildPropMesh, buildBuildingMesh,
  buildLobbyRoom, buildMissionRoom, buildGantzBallMesh, buildTracerMesh,
  buildGantzBallDisplay,
} from './factories.js';

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
  const CW = 256, CH = 52;
  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const ctx = c.getContext('2d');

  // Pill background
  const pad = 5;
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.beginPath();
  ctx.roundRect(pad, pad, CW - pad * 2, CH - pad * 2, 8);
  ctx.fill();

  // Name text
  const color = hexColor ? '#' + hexColor.replace('#', '') : '#00e05a';
  ctx.font = 'bold 20px ui-monospace,Menlo,Consolas,monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(String(text || '?').slice(0, 18), CW / 2, CH / 2);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.1, 0.22, 1);  // world-space size (metres)
  sprite.position.set(0, 2.15, 0); // above head in group-local space
  sprite.userData.isNameLabel = true;
  return sprite;
}

export function createScene3d({ canvas }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050a);
  scene.fog = new THREE.Fog(0x04050a, 300, 1200);

  const EYE_HEIGHT = 1.7;

  const camera = new THREE.PerspectiveCamera(72, canvas.clientWidth / canvas.clientHeight, 0.005, 4000);
  camera.position.set(0, 10, 8);

  // First-person weapon view model (parented to the camera). Only visible in FP.
  // FPS viewmodel placement (camera space, vertical FOV=72°):
  // At z=-0.55: screen half-height≈0.40m, screen half-width≈0.71m (16:9).
  // x=+0.48 → gun centre ≈ 84% right; y=-0.31 → grip near/below bottom edge.
  // Grip clips off-screen bottom-right; barrel faces upper-center — CS:GO style.
  const viewWeapon = new THREE.Group();
  viewWeapon.position.set(0.46, -0.38, -0.55);

  // Muzzle flash — blue-white to match X-Gun energy.
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0 }),
  );
  muzzle.position.set(-0.14, 0.24, -0.12);
  viewWeapon.add(muzzle);
  const muzzleLight = new THREE.PointLight(0x44aaff, 0, 4, 2);
  muzzleLight.position.copy(muzzle.position);
  viewWeapon.add(muzzleLight);

  // X-Gun materials.
  // GLB material names: M_01_base_negra (body), M_01_luz (lights), craneo_pantalla (screen).
  // Body: full PBR texture set (colour/normal/metalness/roughness/ao).
  // Accents/screen: MeshBasicMaterial (unlit) so they always glow.
  const _xgunAccentMat = new THREE.MeshBasicMaterial({ color: 0x003577 }); // dark steel blue
  const _xgunScreenMat = new THREE.MeshBasicMaterial({ color: 0x0077cc });
  const _ACCENT_KEYS   = ['luz'];
  const _SCREEN_KEYS   = ['pantalla', 'craneo'];
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

  // Dedicated gun lights — attached to viewWeapon, move with camera.
  // Intensities kept low so falloff doesn't visibly affect the game world.
  const _gunKeyLight = new THREE.PointLight(0xe8f0ff, 2.8, 1.4, 2); // cool-white key, upper-left
  _gunKeyLight.position.set(-0.30, 0.25, -0.05);
  viewWeapon.add(_gunKeyLight);
  const _gunFillLight = new THREE.PointLight(0x8899bb, 0.7, 1.2, 2); // blue-grey fill, right
  _gunFillLight.position.set(0.25, 0.0, -0.15);
  viewWeapon.add(_gunFillLight);
  const _gunRimLight = new THREE.PointLight(0x445577, 0.5, 0.9, 2);  // dark-blue rim, below-back
  _gunRimLight.position.set(0.10, -0.20, 0.20);
  viewWeapon.add(_gunRimLight);

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
      gun.position.set(0, 0, 0); // centre is now at origin — no offset needed
      // Barrel forward (-Z), grip hangs bottom-right. Roll slight CW so top of gun faces left.
      gun.rotation.set(0.10, -Math.PI / 2 + 0.35, -0.20);
      gun.frustumCulled = false;
      console.log(`[scene3d] X-Gun size: ${_sz.x.toFixed(2)}x${_sz.y.toFixed(2)}x${_sz.z.toFixed(2)} scale:${_s.toFixed(3)} ctr:${_ct.x.toFixed(2)},${_ct.y.toFixed(2)},${_ct.z.toFixed(2)}`);
      viewWeapon.add(gun);
    } catch (e) {
      console.error('[scene3d] X-Gun setup error:', e);
    }
  }, undefined, err => {
    console.warn('[scene3d] X-Gun GLB failed to load:', err);
  });

  camera.add(viewWeapon);
  scene.add(camera); // camera must be in scene graph for child meshes to render
  viewWeapon.visible = false;

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

  // Room switching
  let currentRoomKind = null;
  let currentRoomSeed = null;
  let currentRoomGroup = null;
  const buildingMeshes = new Map();

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
  }

  function setRoom(kind, missionMap) {
    clearRoom();
    currentRoomKind = kind;
    currentRoomSeed = missionMap?._seed ?? null;
    if (kind === 'lobby') {
      currentRoomGroup = buildLobbyRoom();
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
    if (currentRoomGroup) scene.add(currentRoomGroup);
  }

  // Entity pools
  const humans = new Map();   // id → { group, spec, opts }
  const aliens = new Map();
  const props = new Map();
  let gantzBall = null;
  let ballDisplay = null;
  const tracers = [];  // {mesh, age, ttl}

  function getOrCreateHuman(id, spec, opts) {
    let entry = humans.get(id);
    const suit = !!opts?.suit;
    if (!entry || entry.specSeed !== spec.seed || entry.suit !== suit) {
      if (entry) { scene.remove(entry.group); disposeGroup(entry.group); }
      const group = buildHumanMesh(spec, { suit });
      scene.add(group);
      entry = { group, specSeed: spec.seed, suit, labelText: null, labelColor: null, bubbleText: null };
      humans.set(id, entry);
    }
    return entry;
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
      scene.add(gantzBall);
      ballDisplay = buildGantzBallDisplay();
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
        scene.remove(entry.group);
        disposeGroup(entry.group);
        map.delete(id);
      }
    }
  }

  function updateEntityTransform(group, e) {
    const jy = e.jumpY || 0;
    group.position.set(e.x, jy, e.y);
    group.rotation.y = facingToRotY(e.facing || 0);
    // walk bob — faster + bigger when sprinting
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
    } else {
      group.rotation.x = 0;
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
        setRoom('lobby', null);
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

    // Animate lobby door pivots
    if (currentRoomKind === 'lobby') {
      const doors = currentRoomGroup?.userData.doors;
      const doorStates = state.doorStates; // array of progress values 0..1
      if (doors && doorStates) {
        const SPEED = 4.5; // radians per second (door swings in ~0.4 s)
        for (let i = 0; i < doors.length; i++) {
          const { pivot, openAngle } = doors[i];
          const target = (doorStates[i] || 0) * openAngle;
          const cur    = pivot.rotation.y;
          const diff   = target - cur;
          if (Math.abs(diff) > 0.0005) {
            const step = Math.sign(diff) * Math.min(Math.abs(diff), SPEED * dt);
            pivot.rotation.y = cur + step;
          } else {
            pivot.rotation.y = target;
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
      gantzBall.position.set(state.gantzBallPos.x, 1.2, state.gantzBallPos.y);

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
    // In first-person mode, skip the local player mesh (camera is in their head).
    const keepHumans = new Set();
    const humanEntries = [
      ...(state.player && !state.firstPerson ? [{ ...state.player, _id: '__player__', _suit: !!state.player.suit }] : []),
      ...(state.civilians || []).map(c => ({ ...c, _id: c.id, _suit: false })),
      ...(state.remotes || []).map(r => ({ ...r, _id: r.peerId, _suit: !!r.suit })),
    ];
    for (const h of humanEntries) {
      if (!h.spec) continue;
      const entry = getOrCreateHuman(h._id, h.spec, { suit: h._suit });
      updateEntityTransform(entry.group, h);
      // Show name label for remotes and third-person local; hide for dead or local FP
      const isLocalFP = h._id === '__player__' && state.firstPerson;
      const showLabel = !isLocalFP && h.alive !== false && !!h.username;
      updateNameLabel(entry, h.username, h.color, showLabel);
      updateChatBubble(entry, h.alive !== false ? (h.chatText || '') : '', h.chatAlpha || 0);
      keepHumans.add(h._id);
    }
    prune(humans, keepHumans);

    // Aliens
    const keepAliens = new Set();
    for (const a of state.aliens || []) {
      if (!a.spec) continue;
      const g = getOrCreateAlien(a.id, a.spec);
      g.position.set(a.x, 0, a.y);
      g.rotation.y = facingToRotY(a.facing || 0);
      const mark = g.userData.markRing;
      if (mark) {
        mark.material.opacity = a.marked ? (0.4 + 0.5 * Math.abs(Math.sin(a.markFlash * 8 || state.time * 8))) : 0;
      }
      if (a.alive === false) g.rotation.x = 1.4;
      else g.rotation.x = 0;
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

    // Tracers: add new, age old
    if (state.newTracers) {
      for (const t of state.newTracers) {
        const m = buildTracerMesh(t.x1, t.y1, t.x2, t.y2, t.color || '#ff2030');
        scene.add(m);
        tracers.push({ mesh: m, age: 0, ttl: t.ttl || 0.18 });
      }
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.age += dt;
      const a = Math.max(0, 1 - t.age / t.ttl);
      t.mesh.userData.mat.opacity = a;
      if (a <= 0) {
        scene.remove(t.mesh);
        disposeGroup(t.mesh);
        tracers.splice(i, 1);
      }
    }

    // Camera
    const focus = state.focus || state.player;
    if (focus) {
      if (state.firstPerson) {
        const bob = state.bob || 0;
        camera.position.set(focus.x, EYE_HEIGHT + bob + (state.jumpY || 0), focus.y);
        camera.rotation.order = 'YXZ';
        camera.rotation.y = state.yaw || 0;
        camera.rotation.x = state.pitch || 0;
        camera.rotation.z = 0;
        viewWeapon.visible = (state.phase === 'MISSION' || state.phase === 'LOBBY') && (state.playerAlive !== false);
        // Muzzle flash decays every frame
        const mMat = muzzle.material;
        mMat.opacity = Math.max(0, (mMat.opacity || 0) - dt * 8);
        muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 30);

        // ── Viewmodel animation ──────────────────────────────────────────
        const wd = viewWeapon.userData;
        wd.idleTime = (wd.idleTime || 0) + dt;

        // Spring-decay all recoil axes
        const sp = dt * 9;
        wd.recoil     = Math.max(0, (wd.recoil     || 0) - sp * 0.7);
        wd.recoilY    = Math.max(0, (wd.recoilY    || 0) - sp);
        wd.recoilRot  = Math.max(0, (wd.recoilRot  || 0) - sp);
        wd.recoilRoll = (wd.recoilRoll || 0) * Math.max(0, 1 - sp * 1.2);

        // Idle sway — subtle breathing motion
        const swayX = Math.sin(wd.idleTime * 0.7) * 0.004;
        const swayY = Math.sin(wd.idleTime * 0.4) * 0.003;

        // Walk bob — piggyback on camera head-bob (state.bob is vertical amplitude)
        const walkBob = (state.bob || 0) * 0.4;

        viewWeapon.position.set(
          0.46 + swayX,
          -0.38 + swayY + walkBob - (wd.recoilY || 0),
          -0.55 + (wd.recoil || 0),
        );
        // Pitch barrel up + slight roll on fire, spring back to neutral
        viewWeapon.rotation.set(
          -(wd.recoilRot  || 0),
           0,
           (wd.recoilRoll || 0),
        );
      } else {
        viewWeapon.visible = false;
        const desired = new THREE.Vector3(focus.x, 10, focus.y + 9);
        const k = Math.min(1, dt * 5);
        camera.position.lerp(desired, k);
        camera.lookAt(focus.x, 0.8, focus.y);
      }
    }

    renderer.render(scene, camera);
  }

  function triggerMuzzleFlash() {
    muzzle.material.opacity = 0.9;
    muzzleLight.intensity = 4.0;
    // Full recoil kick — z push back, y rise, pitch barrel up, slight roll
    viewWeapon.userData.recoil    = 0.08;   // z kick back
    viewWeapon.userData.recoilY   = 0.035;  // gun rises on fire
    viewWeapon.userData.recoilRot = 0.22;   // barrel pitches up
    viewWeapon.userData.recoilRoll = -0.07; // slight CCW roll
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

  return {
    render,
    screenToGround,
    getCameraForwardXZ,
    triggerMuzzleFlash,
    worldToScreen,
    raycastBallDisplay,
    get ballDisplay() { return ballDisplay; },
    resize,
    get camera() { return camera; },
    get scene() { return scene; },
  };
}
