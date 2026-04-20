import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { generateHumanSpec } from '../content/humanSpec.js';
import { generatePropSpec } from '../content/propSpec.js';
import { generateAlienSpec } from '../content/alienSpec.js';

// ---- Scene setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);
scene.fog = new THREE.Fog(0x04050a, 18, 46);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(8, 7, 11);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 30;

// ---- Lighting ----
const ambient = new THREE.AmbientLight(0x1a1d2a, 1.2);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xbfc8ff, 0.45);
keyLight.position.set(8, 18, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -14; keyLight.shadow.camera.right = 14;
keyLight.shadow.camera.top = 14; keyLight.shadow.camera.bottom = -14;
keyLight.shadow.camera.near = 2; keyLight.shadow.camera.far = 40;
scene.add(keyLight);

const fillLight = new THREE.HemisphereLight(0x243050, 0x040506, 0.55);
scene.add(fillLight);

// Four red wall-trim point lights for Gantz vibes
const wallLights = [];
const corners = [[-9, 0.6, -7], [9, 0.6, -7], [-9, 0.6, 7], [9, 0.6, 7]];
for (const [x, y, z] of corners) {
  const l = new THREE.PointLight(0xc8142b, 2.0, 7, 2);
  l.position.set(x, y, z);
  scene.add(l);
  wallLights.push(l);
}

// ---- Lobby room ----
const ROOM = { w: 18, h: 14 };

// floor
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x1a1d2a, roughness: 0.85, metalness: 0.1,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// tile lines on the floor (decorative)
const lineMat = new THREE.LineBasicMaterial({ color: 0x0a0c18, transparent: true, opacity: 0.8 });
const linePoints = [];
for (let x = -ROOM.w / 2; x <= ROOM.w / 2; x += 1) {
  linePoints.push(new THREE.Vector3(x, 0.01, -ROOM.h / 2), new THREE.Vector3(x, 0.01, ROOM.h / 2));
}
for (let z = -ROOM.h / 2; z <= ROOM.h / 2; z += 1) {
  linePoints.push(new THREE.Vector3(-ROOM.w / 2, 0.01, z), new THREE.Vector3(ROOM.w / 2, 0.01, z));
}
const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
scene.add(new THREE.LineSegments(lineGeom, lineMat));

// walls
const wallMat = new THREE.MeshStandardMaterial({ color: 0x080a14, roughness: 0.9, metalness: 0.05 });
function makeWall(x, z, w, h, rotY = 0) {
  const geo = new THREE.BoxGeometry(w, 3.2, h);
  const m = new THREE.Mesh(geo, wallMat);
  m.position.set(x, 1.6, z);
  m.rotation.y = rotY;
  m.receiveShadow = true;
  m.castShadow = true;
  scene.add(m);
  return m;
}
makeWall(0, -ROOM.h / 2 - 0.25, ROOM.w + 1, 0.5);
makeWall(0,  ROOM.h / 2 + 0.25, ROOM.w + 1, 0.5);
makeWall(-ROOM.w / 2 - 0.25, 0, 0.5, ROOM.h);
makeWall( ROOM.w / 2 + 0.25, 0, 0.5, ROOM.h);

// red wall-trim strip at floor level
const trimMat = new THREE.MeshBasicMaterial({ color: 0xc8142b, transparent: true, opacity: 0.55 });
const trimGeo = new THREE.BoxGeometry(ROOM.w, 0.04, 0.04);
function addTrim(z) {
  const m = new THREE.Mesh(trimGeo, trimMat);
  m.position.set(0, 0.05, z);
  scene.add(m);
}
addTrim(-ROOM.h / 2 + 0.05);
addTrim( ROOM.h / 2 - 0.05);
const trimGeoZ = new THREE.BoxGeometry(0.04, 0.04, ROOM.h);
function addTrimZ(x) {
  const m = new THREE.Mesh(trimGeoZ, trimMat);
  m.position.set(x, 0.05, 0);
  scene.add(m);
}
addTrimZ(-ROOM.w / 2 + 0.05);
addTrimZ( ROOM.w / 2 - 0.05);

// ---- Gantz ball ----
const ballGroup = new THREE.Group();
scene.add(ballGroup);

const ballCore = new THREE.Mesh(
  new THREE.SphereGeometry(1.2, 48, 32),
  new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.35, metalness: 0.9 }),
);
ballCore.castShadow = true;
ballCore.receiveShadow = true;
ballGroup.add(ballCore);

// inner red glow (small emissive sphere visible through the ball illusion via a ring)
const ringMat = new THREE.MeshBasicMaterial({
  color: 0xc8142b, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
});
const ring = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.015, 8, 64), ringMat);
ring.rotation.x = Math.PI / 2;
ballGroup.add(ring);
const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.008, 8, 64), new THREE.MeshBasicMaterial({
  color: 0xff3040, transparent: true, opacity: 0.35,
}));
ring2.rotation.x = Math.PI / 2;
ballGroup.add(ring2);

const ballLight = new THREE.PointLight(0xc8142b, 3.0, 10, 1.6);
ballLight.position.set(0, 0, 0);
ballGroup.add(ballLight);

ballGroup.position.set(0, 1.3, -2);

// ---- Human renderer from spec ----
function colorToThree(hex) { return new THREE.Color(hex); }

function buildHuman3d(spec, opts = {}) {
  const group = new THREE.Group();
  const scale = (spec.height || 1.75) / 1.75;
  const buildMul = spec.build === 'slim' ? 0.92 : spec.build === 'heavy' ? 1.14 : 1.0;

  // body (torso + legs as simplified stack)
  const torsoGeom = new THREE.CapsuleGeometry(0.28 * buildMul, 0.55 * scale, 4, 12);
  const torsoMat = new THREE.MeshStandardMaterial({
    color: colorToThree(spec.outfit.top),
    roughness: 0.8, metalness: 0.05,
  });
  const torso = new THREE.Mesh(torsoGeom, torsoMat);
  torso.position.y = 1.0 * scale;
  torso.castShadow = true;
  group.add(torso);

  // legs
  const legGeom = new THREE.CylinderGeometry(0.13, 0.12, 0.7 * scale, 10);
  const legMat = new THREE.MeshStandardMaterial({
    color: colorToThree(spec.outfit.bottom),
    roughness: 0.85, metalness: 0.05,
  });
  for (const dx of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(dx, 0.35 * scale, 0);
    leg.castShadow = true;
    group.add(leg);
  }

  // shoes
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  for (const dx of [-0.12, 0.12]) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.28), shoeMat);
    shoe.position.set(dx, 0.04, 0.04);
    shoe.castShadow = true;
    group.add(shoe);
  }

  // arms
  const armMat = torsoMat;
  for (const dx of [-0.38 * buildMul, 0.38 * buildMul]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55 * scale, 4, 8), armMat);
    arm.position.set(dx, 1.05 * scale, 0);
    arm.castShadow = true;
    group.add(arm);
  }

  // head (skin)
  const headRadius = 0.16 * scale;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 20, 16),
    new THREE.MeshStandardMaterial({ color: colorToThree(spec.skin), roughness: 0.9 }),
  );
  head.position.y = 1.55 * scale;
  head.castShadow = true;
  group.add(head);

  // hair
  const hairColor = colorToThree(spec.hair?.color || '#1a1a1a');
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 });
  const style = spec.hair?.style || 'short';

  if (style !== 'bald') {
    // scalp cap — half-sphere on top of head
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(headRadius * 1.03, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hairMat,
    );
    cap.position.y = 1.55 * scale;
    group.add(cap);

    if (style === 'long') {
      // trail behind head
      const trail = new THREE.Mesh(
        new THREE.ConeGeometry(headRadius * 1.1, 0.55 * scale, 8, 1, true),
        hairMat,
      );
      trail.position.set(0, (1.55 - 0.15) * scale, -headRadius);
      trail.rotation.x = -Math.PI / 2.4;
      group.add(trail);
    } else if (style === 'ponytail') {
      const pony = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 0.35 * scale, 8),
        hairMat,
      );
      pony.position.set(0, (1.5) * scale, -headRadius * 0.9);
      pony.rotation.x = -Math.PI / 3;
      group.add(pony);
    } else if (style === 'topknot') {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.08 * scale, 10, 8), hairMat);
      knot.position.set(0, (1.55 + headRadius) * scale, -headRadius * 0.1);
      group.add(knot);
    } else if (style === 'messy') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const clump = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.35, 10, 8), hairMat);
        clump.position.set(
          Math.cos(a) * headRadius * 0.5,
          1.55 * scale + headRadius * 0.9,
          Math.sin(a) * headRadius * 0.5,
        );
        group.add(clump);
      }
    }
  }

  // Gantz suit overlay (dark shell with red piping) if suit === 'basic' and opts.suit set
  if (opts.suit) {
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x080810, roughness: 0.35, metalness: 0.65,
      transparent: true, opacity: 0.88,
    });
    const shell = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3 * buildMul, 0.6 * scale, 4, 12),
      shellMat,
    );
    shell.position.y = 1.0 * scale;
    group.add(shell);
    // red piping
    const pipe = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.7 * scale, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xc8142b }),
    );
    pipe.position.set(0, 1.0 * scale, 0.31 * buildMul);
    group.add(pipe);
  }

  return group;
}

// ---- Prop renderer from spec ----
function buildProp3d(type, spec, x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  if (type === 'pillar') {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 3.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x181c30, roughness: 0.6, metalness: 0.4 }),
    );
    col.position.y = 1.6;
    col.castShadow = true; col.receiveShadow = true;
    group.add(col);
    // red accent band
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.08, 16),
      new THREE.MeshBasicMaterial({ color: 0xc8142b, transparent: true, opacity: 0.6 }),
    );
    band.position.y = 0.2;
    group.add(band);
  } else if (type === 'bench') {
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.12, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x2a2418, roughness: 0.85 }),
    );
    seat.position.y = 0.42;
    seat.castShadow = true; seat.receiveShadow = true;
    group.add(seat);
    for (const dx of [-0.65, 0.65]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.42, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x1a140a, roughness: 0.9 }),
      );
      leg.position.set(dx, 0.21, 0);
      leg.castShadow = true;
      group.add(leg);
    }
  } else if (type === 'crate') {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 }),
    );
    crate.position.y = 0.4;
    crate.rotation.y = spec.rotation || 0;
    crate.castShadow = true; crate.receiveShadow = true;
    group.add(crate);
  } else if (type === 'console') {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.0, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1c2238, roughness: 0.55, metalness: 0.5 }),
    );
    base.position.y = 0.5;
    base.castShadow = true; base.receiveShadow = true;
    group.add(base);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x1ea5c8, transparent: true, opacity: 0.8 }),
    );
    screen.position.set(0, 0.7, 0.36);
    group.add(screen);
    group.rotation.y = spec.rotation || 0;
  } else if (type === 'lamp') {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x252840, roughness: 0.8 }),
    );
    pole.position.y = 1.4;
    pole.castShadow = true;
    group.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xe8c070 }),
    );
    bulb.position.y = 2.8;
    group.add(bulb);
    const lampLight = new THREE.PointLight(0xe8c070, 1.2, 6, 2);
    lampLight.position.y = 2.8;
    group.add(lampLight);
  } else if (type === 'vending') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 1.6, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x1a2a45, roughness: 0.6, metalness: 0.4 }),
    );
    body.position.y = 0.8;
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 1.15),
      new THREE.MeshBasicMaterial({ color: 0xe8c070, transparent: true, opacity: 0.7 }),
    );
    panel.position.set(0, 0.95, 0.305);
    group.add(panel);
  }
  return group;
}

// ---- Alien (simple demo) ----
function buildAlien3d(spec) {
  const group = new THREE.Group();
  const sc = spec.size;
  const primary = colorToThree(spec.skin.primary);
  const accent = colorToThree(spec.skin.accent);

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.5 * sc, 20, 14),
    new THREE.MeshStandardMaterial({ color: primary, roughness: 0.55, metalness: 0.2 }),
  );
  body.scale.set(1.2, 0.75, 1.0);
  body.position.y = 0.45 * sc;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // limbs
  for (let i = 0; i < spec.limbs; i++) {
    const a = (i / spec.limbs) * Math.PI * 2;
    const limb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14 * sc, 10, 8),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 }),
    );
    limb.position.set(Math.cos(a) * 0.55 * sc, 0.2 * sc, Math.sin(a) * 0.42 * sc);
    limb.castShadow = true;
    group.add(limb);
  }

  // eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffde55 });
  const eyeCount = spec.eyeCount;
  for (let i = 0; i < eyeCount; i++) {
    const ang = ((i / Math.max(1, eyeCount - 1)) - 0.5) * 0.9;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05 * sc, 8, 6), eyeMat);
    eye.position.set(Math.sin(ang) * 0.2 * sc, 0.55 * sc, 0.45 * sc);
    group.add(eye);
  }

  return group;
}

// ---- Scene population ----
const HUMAN_SPOTS = [
  { x: -2.5, z: 2.2, rot: 0.3, name: 'hunter-kenji', suit: true },
  { x: 2.8,  z: 2.5, rot: -0.4, name: 'hunter-aiko', suit: false },
  { x: -5.0, z: 0.0, rot: 0.7, name: 'hunter-rei', suit: true },
  { x: 4.8,  z: -0.6, rot: -0.9, name: 'hunter-takeshi', suit: false },
  { x: 0.0,  z: 3.8, rot: Math.PI, name: 'hunter-mika', suit: true },
  { x: -1.3, z: -5.2, rot: 0.0, name: 'hunter-hiro', suit: true },
];

const humans = [];
for (const s of HUMAN_SPOTS) {
  const spec = generateHumanSpec(s.name);
  const h = buildHuman3d(spec, { suit: s.suit });
  h.position.set(s.x, 0, s.z);
  h.rotation.y = s.rot;
  scene.add(h);
  humans.push({ mesh: h, spec, spot: s });
}

// Props
const PROPS = [
  { type: 'pillar', x: -8, z: -6 },
  { type: 'pillar', x:  8, z: -6 },
  { type: 'pillar', x: -8, z:  6 },
  { type: 'pillar', x:  8, z:  6 },
  { type: 'bench', x:  0, z:  6.2 },
  { type: 'bench', x: -5, z:  6.2 },
  { type: 'bench', x:  5, z:  6.2 },
  { type: 'console', x: -7.5, z: -3, rot: 0.5 },
  { type: 'console', x:  7.5, z: -3, rot: -0.5 },
  { type: 'lamp', x: -8, z:  0 },
  { type: 'lamp', x:  8, z:  0 },
  { type: 'crate', x: -8.2, z:  3 },
  { type: 'crate', x: -8.8, z:  3.7 },
  { type: 'crate', x:  8,   z:  3 },
  { type: 'vending', x:  6.5, z: -6 },
  { type: 'vending', x: -6.5, z: -6 },
];
for (const p of PROPS) {
  const spec = generatePropSpec(p.type, `preview-${p.type}-${p.x}-${p.z}`);
  if (p.rot != null) spec.rotation = p.rot;
  const mesh = buildProp3d(p.type, spec, p.x, p.z);
  scene.add(mesh);
}

// One alien cameo off to the side (showing the spec system drives aliens too)
const alienSpec = generateAlienSpec('preview-boss', 'patroller');
const alien = buildAlien3d(alienSpec);
alien.position.set(6, 0, -6);
alien.rotation.y = -0.5;
scene.add(alien);

// ---- Animation ----
let t = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = 1 / 60; t += dt;

  // Gantz ball animates: slow rotation + emissive pulse
  ballGroup.rotation.y += dt * 0.3;
  const pulse = 0.6 + 0.4 * Math.sin(t * 1.5);
  ringMat.opacity = 0.7 * pulse;
  ballLight.intensity = 2.0 + 1.6 * pulse;
  ring2.rotation.z += dt * 0.6;

  // wall lights subtle flicker
  for (let i = 0; i < wallLights.length; i++) {
    wallLights[i].intensity = 1.6 + 0.4 * Math.sin(t * 2 + i);
  }

  // Hunters idle breath
  for (const h of humans) {
    h.mesh.position.y = Math.sin(t * 1.1 + h.spec.seed * 0.001) * 0.02;
  }

  controls.update();
  renderer.render(scene, camera);
}

// ---- Resize ----
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Hide loading
const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.style.display = 'none';

tick();
