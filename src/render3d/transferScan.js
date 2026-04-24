// Gantz transfer scan — Stages 1+2.
//
// Dual-plane scan across each character entry:
//   • Leading (blueprint) plane: fragments ahead of it are `discard`ed.
//   • Trailing (flesh) plane: TRAIL_OFFSET metres behind leading; between the
//     two planes the mesh is drawn as a red nervous-system blueprint. Behind
//     trailing, the mesh renders normally.
//   • Both edges get a neon-blue glow line; the leading edge is brighter.
//   • Narrow muscle-noise cap right behind the leading plane sells the
//     cross-section depth.
//
// A neon-blue ray fan can optionally beam from a world-space source point
// (Gantz sphere / overhead satellite) to the target and fades in/out with
// the scan lifetime. Pass `opts.source = {x,y,z}` to enable.
//
// Stage 3 wires triggers + peer sync.

import * as THREE from 'https://esm.sh/three@0.160.0';

const EDGE_COLOR        = new THREE.Color('#6fe8ff');
const EDGE_WIDTH        = 0.02;
const CAP_THICKNESS     = 0.05;
const TRAIL_OFFSET      = 0.22;   // blueprint-band thickness (metres)
const DEFAULT_DURATION  = 2.5;
const SCAN_BOTTOM_Y     = -0.05;
const SCAN_TOP_Y        = 2.00;

const RAY_COUNT         = 14;
const RAY_R_SOURCE      = 0.0006; // radius at Gantz sphere end (hair-thin)
const RAY_R_TARGET      = 0.0035; // radius where beam meets print line (fans slightly)
const RAY_FADE_FRAC     = 0.25;   // fade-in / fade-out as fraction of duration
const RAY_PEAK_OPACITY  = 0.9;

// Orbit + vibration parameters — rays chase the intersection of the clip plane
// and the player's silhouette, rapidly sweeping around it. SILHOUETTE_R is
// where the *virtual aim* rotates (defining the ray's direction); BODY_R is
// the approximated body cylinder each beam is trimmed to, so endpoints land
// on the visible mesh surface rather than floating in air around it.
const SILHOUETTE_R      = 0.26;
const BODY_R            = 0.19;
const ORBIT_BASE_SPEED  = 7.0;    // rad/s, baseline orbit speed
const ORBIT_SPEED_VAR   = 5.0;    // rad/s, per-ray randomisation range
const VIB_FREQ_ANG      = 55.0;   // rad/s oscillation of theta jitter
const VIB_FREQ_Y        = 70.0;   // rad/s oscillation of vertical jitter
const VIB_AMP_ANG       = 0.10;   // radians — angular vibration of target
const VIB_AMP_Y         = 0.028;  // metres — vertical vibration of target

// ─── Procedural textures ──────────────────────────────────────────────

function _buildMuscleTexture() {
  const S = 256;
  const cvs = document.createElement('canvas');
  cvs.width = S; cvs.height = S;
  const g = cvs.getContext('2d');

  g.fillStyle = '#2a0205';
  g.fillRect(0, 0, S, S);

  for (let i = 0; i < 900; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const len = 10 + Math.random() * 28;
    const thick = 1 + Math.random() * 2.5;
    const ang = Math.random() * Math.PI;
    const hue = 350 + (Math.random() - 0.5) * 20;
    const lgt = 18 + Math.random() * 28;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = `hsl(${hue} 85% ${lgt}%)`;
    g.fillRect(-len / 2, -thick / 2, len, thick);
    g.restore();
  }
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 1 + Math.random() * 2.2;
    g.fillStyle = `hsl(${2 + Math.random() * 8} 90% ${45 + Math.random() * 20}%)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const grd = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
  grd.addColorStop(0, 'rgba(120, 10, 20, 0)');
  grd.addColorStop(1, 'rgba(30, 0, 3, 0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Denser, brighter muscle-fibre pattern for the blueprint band (bigger bands
// than the thin leading-edge cap so the band reads as "raw muscle" from a
// distance, not just noise).
function _buildFiberTexture() {
  const S = 256;
  const cvs = document.createElement('canvas');
  cvs.width = S; cvs.height = S;
  const g = cvs.getContext('2d');

  g.fillStyle = '#3a070c';
  g.fillRect(0, 0, S, S);

  // Long, mostly-aligned muscle fibre bands with slight directional wobble.
  for (let i = 0; i < 550; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const len = 30 + Math.random() * 70;
    const thick = 1.5 + Math.random() * 3;
    const ang = (Math.random() - 0.5) * 0.35;
    const hue = 352 + (Math.random() - 0.5) * 18;
    const lgt = 30 + Math.random() * 30;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = `hsl(${hue} 88% ${lgt}%)`;
    g.fillRect(-len / 2, -thick / 2, len, thick);
    g.restore();
  }
  // Bright cross-striation highlights along the fibres.
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const len = 8 + Math.random() * 14;
    const ang = (Math.random() - 0.5) * 0.35;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = `hsl(${2 + Math.random() * 6} 95% ${55 + Math.random() * 15}%)`;
    g.fillRect(-len / 2, -0.6, len, 1.2);
    g.restore();
  }
  // Capillary dots.
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 1 + Math.random() * 2.2;
    g.fillStyle = `hsl(${Math.random() * 10} 92% ${45 + Math.random() * 18}%)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Darkening vignette so repeats don't tile obviously.
  const grd = g.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, S * 0.75);
  grd.addColorStop(0, 'rgba(180, 30, 40, 0)');
  grd.addColorStop(1, 'rgba(20, 0, 3, 0.5)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _muscleTexShared = null;
let _fiberTexShared = null;
function _muscleTex() {
  if (!_muscleTexShared) _muscleTexShared = _buildMuscleTexture();
  return _muscleTexShared;
}
function _fiberTex() {
  if (!_fiberTexShared) _fiberTexShared = _buildFiberTexture();
  return _fiberTexShared;
}

// ─── Shader patch ─────────────────────────────────────────────────────

const FRAG_SCAN_SNIPPET = /* glsl */`
  if (uScanActive > 0.5) {
    float dy = vScanWorldPos.y - uScanPlaneY;
    // Always discard above the plane. Direction is encoded in plane motion only:
    //   dir=+1 materialize  → plane rises bottom→top → body reveals bottom-up
    //   dir=-1 dematerialize → plane falls top→bottom → body hides top-down
    // (If the discard condition depended on dir, dematerialize would become a
    // head-down reveal instead of the intended top-down hide.)
    if (dy > 0.0) discard;

    float behind = -dy; // >= 0: how far below the plane (visible side)

    // Blueprint band: between leading and trailing planes — swap to nervous-system.
    if (behind < uScanTrailOffset) {
      vec2 fUv = vScanWorldPos.xz * 4.5 + vec2(uScanPlaneY * 0.37, uScanPlaneY * 0.21);
      vec3 fCol = texture2D(uScanFiberTex, fUv).rgb;
      gl_FragColor.rgb = fCol;

      // Muscle-noise cap right behind the leading edge (strongest at surface).
      if (behind < uScanCapThickness) {
        vec2 capUv = vScanWorldPos.xz * 7.5 + vec2(0.0, uScanPlaneY * 0.5);
        vec3 capCol = texture2D(uScanCapTex, capUv).rgb;
        float capMix = 1.0 - behind / uScanCapThickness;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, capCol, capMix * 0.85);
      }
    }

    // Leading edge glow (bright).
    float edge = abs(dy);
    if (edge < uScanEdgeWidth) {
      float k = 1.0 - edge / uScanEdgeWidth;
      gl_FragColor.rgb += uScanEdgeColor * (k * k) * 3.4;
    }

    // Trailing edge glow (softer).
    float trailEdge = abs(behind - uScanTrailOffset);
    if (trailEdge < uScanEdgeWidth) {
      float k = 1.0 - trailEdge / uScanEdgeWidth;
      gl_FragColor.rgb += uScanEdgeColor * (k * k) * 1.4;
    }
  }
`;

const FRAG_UNIFORM_DECL = /* glsl */`
  uniform float uScanActive;
  uniform float uScanPlaneY;
  uniform float uScanDir;
  uniform vec3  uScanEdgeColor;
  uniform float uScanEdgeWidth;
  uniform float uScanCapThickness;
  uniform float uScanTrailOffset;
  uniform sampler2D uScanCapTex;
  uniform sampler2D uScanFiberTex;
  varying vec3 vScanWorldPos;
`;

const VERT_VARYING_DECL = /* glsl */`
  varying vec3 vScanWorldPos;
`;

function _patchMaterial(mat, scanUniforms) {
  if (!mat) return mat;
  // NOTE: Three.js Material.clone() deep-copies userData but does NOT copy
  // onBeforeCompile. Pooled character materials that were patched in a prior
  // scan come back with `__scanPatched: true` on their userData but no shader
  // hook, so skipping would leave the clone silently broken — the ray fan
  // still renders (independent meshes) but the model's blueprint band never
  // activates. Re-patch whenever we own a fresh clone.
  if (mat.userData.__scanPatched && typeof mat.onBeforeCompile === 'function'
      && mat.onBeforeCompile.__isScanPatch) {
    return mat; // truly patched (not a stale flag from a clone)
  }
  mat.userData.__scanPatched = true;

  const prevOnBeforeCompile = mat.onBeforeCompile;
  // Tag the hook itself so a later _patchMaterial call can distinguish a real
  // patched material from a clone that merely inherited the userData flag.
  const hook = (shader, renderer) => {
    if (prevOnBeforeCompile) prevOnBeforeCompile(shader, renderer);
    shader.uniforms.uScanActive       = scanUniforms.uScanActive;
    shader.uniforms.uScanPlaneY       = scanUniforms.uScanPlaneY;
    shader.uniforms.uScanDir          = scanUniforms.uScanDir;
    shader.uniforms.uScanEdgeColor    = scanUniforms.uScanEdgeColor;
    shader.uniforms.uScanEdgeWidth    = scanUniforms.uScanEdgeWidth;
    shader.uniforms.uScanCapThickness = scanUniforms.uScanCapThickness;
    shader.uniforms.uScanTrailOffset  = scanUniforms.uScanTrailOffset;
    shader.uniforms.uScanCapTex       = scanUniforms.uScanCapTex;
    shader.uniforms.uScanFiberTex     = scanUniforms.uScanFiberTex;

    shader.vertexShader = VERT_VARYING_DECL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n  vScanWorldPos = worldPosition.xyz;'
    );

    shader.fragmentShader = FRAG_UNIFORM_DECL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      FRAG_SCAN_SNIPPET + '\n#include <dithering_fragment>'
    );
  };
  hook.__isScanPatch = true;
  mat.onBeforeCompile = hook;

  mat.needsUpdate = true;
  return mat;
}

function _attach(entry) {
  if (entry.__scan) return entry.__scan;
  const uniforms = {
    uScanActive:       { value: 0 },
    uScanPlaneY:       { value: 0 },
    uScanDir:          { value: 1 },
    uScanEdgeColor:    { value: EDGE_COLOR.clone() },
    uScanEdgeWidth:    { value: EDGE_WIDTH },
    uScanCapThickness: { value: CAP_THICKNESS },
    uScanTrailOffset:  { value: TRAIL_OFFSET },
    uScanCapTex:       { value: _muscleTex() },
    uScanFiberTex:     { value: _fiberTex() },
  };

  entry.group.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map(m => _patchMaterial(m.clone(), uniforms));
    } else if (o.material) {
      o.material = _patchMaterial(o.material.clone(), uniforms);
    }
  });

  entry.__scan = {
    uniforms,
    state: 'idle',
    direction: 1,
    startT: 0,
    duration: DEFAULT_DURATION,
    onComplete: null,
    rays: null,
  };
  return entry.__scan;
}

// ─── Ray fan ──────────────────────────────────────────────────────────

// Unit-height, tapered cylinder shared across every ray in the fan. Cylinder
// local +Y points toward the target after orientation, so `radiusTop` is at
// the target (wider, covering the print line) and `radiusBottom` is at the
// source (thin, at the Gantz sphere). Per-ray aim is recomputed each frame in
// `_updateRayFanTransform` so the beams chase the clip-plane intersection.
function _buildRayFan(sourceVec3, withEmitter) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: EDGE_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const geometry = new THREE.CylinderGeometry(RAY_R_TARGET, RAY_R_SOURCE, 1, 5, 1, false);
  group.userData.material = material;
  group.userData.geometry = geometry;
  group.userData.source = sourceVec3.clone();

  for (let i = 0; i < RAY_COUNT; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    const sign = Math.random() < 0.5 ? -1 : 1;
    mesh.userData.offset = {
      phase:    (i / RAY_COUNT) * Math.PI * 2 + Math.random() * 0.5,
      angSpeed: (ORBIT_BASE_SPEED + Math.random() * ORBIT_SPEED_VAR) * sign,
      rMul:     0.85 + Math.random() * 0.3,
      vibOff1:  Math.random() * 100,
      vibOff2:  Math.random() * 100,
    };
    mesh.renderOrder = 999;
    group.add(mesh);
  }

  // Bright emitter glow at the sphere-surface origin — a tiny additive sphere
  // so the beams read as spawning from a single point on Gantz. Inner core is
  // near-white; outer halo softens the edge. Only built for ball-surface
  // sources; fixed-point (overhead satellite) scans skip this.
  if (withEmitter) {
    const emitterGroup = new THREE.Group();
    const coreGeom = new THREE.SphereGeometry(0.028, 12, 10);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#d8f5ff'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.renderOrder = 1000;
    emitterGroup.add(core);

    const haloGeom = new THREE.SphereGeometry(0.075, 14, 12);
    const haloMat = new THREE.MeshBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    halo.renderOrder = 1000;
    emitterGroup.add(halo);

    group.userData.emitter = { group: emitterGroup, core, halo, coreGeom, coreMat, haloGeom, haloMat };
    group.add(emitterGroup);
  }
  return group;
}

const _rayTmpDir    = new THREE.Vector3();
const _rayTmpMid    = new THREE.Vector3();
const _rayTmpTarget = new THREE.Vector3();
const _rayTmpCenter = new THREE.Vector3();
const _rayTmpAim    = new THREE.Vector3();
const _rayTmpSrcDir = new THREE.Vector3();
const _rayTmpQuat   = new THREE.Quaternion();
const _rayUp        = new THREE.Vector3(0, 1, 0);

// 2D (XZ) ray-vs-circle: parameterise the ray P(t) = src + t * (aim - src) and
// return the near `t` where it enters a circle of radius R at (px, pz). `t` is
// in units of |aim - src| so t=1 means "at the aim". Returns -1 on miss.
function _intersectBodyCircleXZ(sx, sz, dirX, dirZ, px, pz, R) {
  const ox = sx - px, oz = sz - pz;
  const a = dirX * dirX + dirZ * dirZ;
  if (a < 1e-8) return -1;
  const b = 2 * (dirX * ox + dirZ * oz);
  const c = ox * ox + oz * oz - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sqrtD = Math.sqrt(disc);
  const t1 = (-b - sqrtD) / (2 * a);
  if (t1 > 1e-4) return t1;
  const t2 = (-b + sqrtD) / (2 * a);
  return t2 > 1e-4 ? t2 : -1;
}

// Rays orbit the clip-plane / silhouette intersection: virtual aim rotates
// around the player perimeter at `silhouetteR` and drives the ray direction;
// the actual endpoint is the near-side intersection with the body cylinder of
// radius BODY_R, so beams stop on the visible mesh surface rather than
// overshooting into the air around it. Target Y locks to `planeY` with
// high-frequency jitter.
function _updateRayFanTransform(rays, centerXZ, planeY, silhouetteR, elapsedS) {
  const source = rays.userData.source;
  for (const mesh of rays.children) {
    const off = mesh.userData.offset;
    if (!off) continue;
    const vibAng = Math.sin(elapsedS * VIB_FREQ_ANG + off.vibOff1) * VIB_AMP_ANG;
    const vibY   = Math.sin(elapsedS * VIB_FREQ_Y + off.vibOff2) * VIB_AMP_Y;
    const theta  = off.phase + off.angSpeed * elapsedS + vibAng;
    const r      = silhouetteR * off.rMul;

    const aimX = centerXZ.x + Math.cos(theta) * r;
    const aimZ = centerXZ.z + Math.sin(theta) * r;
    const dirX = aimX - source.x;
    const dirZ = aimZ - source.z;

    // Trim to body surface on the near hemisphere.
    const tHit = _intersectBodyCircleXZ(
      source.x, source.z, dirX, dirZ, centerXZ.x, centerXZ.z, BODY_R
    );
    let endX, endZ;
    if (tHit > 0 && tHit < 1.5) {
      endX = source.x + dirX * tHit;
      endZ = source.z + dirZ * tHit;
    } else {
      endX = aimX;
      endZ = aimZ;
    }

    _rayTmpTarget.set(endX, planeY + vibY, endZ);
    _rayTmpDir.subVectors(_rayTmpTarget, source);
    const len = _rayTmpDir.length();
    if (len < 0.01) continue;
    _rayTmpMid.addVectors(source, _rayTmpTarget).multiplyScalar(0.5);
    mesh.position.copy(_rayTmpMid);
    _rayTmpQuat.setFromUnitVectors(_rayUp, _rayTmpDir.multiplyScalar(1 / len));
    mesh.quaternion.copy(_rayTmpQuat);
    mesh.scale.set(1, len, 1);
  }
}

function _updateRayFanOpacity(rays, t) {
  const mat = rays.userData.material;
  let k = 1;
  if (t < RAY_FADE_FRAC) k = t / RAY_FADE_FRAC;
  else if (t > 1 - RAY_FADE_FRAC) k = (1 - t) / RAY_FADE_FRAC;
  const fade = Math.max(0, Math.min(1, k));
  mat.opacity = fade * RAY_PEAK_OPACITY;

  const emitter = rays.userData.emitter;
  if (emitter) {
    // Core stays mostly solid so the point reads bright; halo bloom wider.
    emitter.coreMat.opacity = fade;
    emitter.haloMat.opacity = fade * 0.55;
    // Subtle pulse so the point doesn't sit dead-still.
    const pulse = 0.92 + 0.08 * Math.sin(performance.now() * 0.018);
    emitter.group.scale.setScalar(pulse);
  }
}

function _disposeRayFan(rays) {
  rays.userData.geometry?.dispose?.();
  rays.userData.material?.dispose?.();
  const emitter = rays.userData.emitter;
  if (emitter) {
    emitter.coreGeom.dispose();
    emitter.coreMat.dispose();
    emitter.haloGeom.dispose();
    emitter.haloMat.dispose();
  }
  rays.parent?.remove(rays);
}

// ─── Controller ───────────────────────────────────────────────────────

export function createScanController(scene) {
  return {
    /**
     * Start a scan on a character entry.
     *
     * @param {object} entry - humans.get(id) entry with .group
     * @param {object} opts
     *  - type: 'materialize' | 'dematerialize' (default 'materialize')
     *  - duration: seconds (default 2.5)
     *  - source: { x, y, z } — world-space origin of the ray fan (optional)
     *  - onComplete: callback when scan finishes
     */
    start(entry, opts = {}) {
      const scan = _attach(entry);
      const dir = opts.type === 'dematerialize' ? -1 : 1;

      if (scan.rays) { _disposeRayFan(scan.rays); scan.rays = null; }

      scan.state = 'running';
      scan.direction = dir;
      scan.startT = performance.now() / 1000;
      scan.duration = opts.duration ?? DEFAULT_DURATION;
      scan.onComplete = opts.onComplete || null;
      scan.uniforms.uScanActive.value = 1;
      scan.uniforms.uScanDir.value = dir;
      // Reveal the mesh now — if the entry was hidden by the scan-pending gate
      // in scene3d.getOrCreateHuman, uScanActive=1 with the plane at the feet
      // discards nearly all fragments via the shader, so flipping visibility
      // here does not show a full body frame.
      if (entry.group) {
        entry.group.visible = true;
        entry.__firstShowAt = 0;
      }

      const baseY = entry.group.position.y || 0;
      scan.uniforms.uScanPlaneY.value = baseY + (dir > 0 ? SCAN_BOTTOM_Y : SCAN_TOP_Y);

      // Source can be either a fixed world point (opts.source) or a sphere
      // surface (opts.sourceBall = {x,y,z,r}). In the ball case, the emission
      // origin each frame is the point on the sphere's surface facing the
      // current print line — so every beam leaves Gantz from one tiny spot.
      let initialSource = null;
      if (opts.sourceBall) {
        const c = opts.sourceBall;
        const guess = _rayTmpSrcDir
          .set(entry.group.position.x - c.x, 0, entry.group.position.z - c.z);
        if (guess.lengthSq() < 1e-6) guess.set(0, 0, 1);
        guess.normalize();
        initialSource = new THREE.Vector3(
          c.x + guess.x * c.r,
          c.y,
          c.z + guess.z * c.r,
        );
        scan.sourceBall = {
          center: new THREE.Vector3(c.x, c.y, c.z),
          radius: c.r,
        };
      } else if (opts.source) {
        initialSource = new THREE.Vector3(opts.source.x, opts.source.y, opts.source.z);
        scan.sourceBall = null;
      }
      if (initialSource && scene) {
        scan.rays = _buildRayFan(initialSource, !!opts.sourceBall);
        scene.add(scan.rays);
      }
    },

    /**
     * Drive per-frame plane + ray updates. Call from scene3d.render().
     */
    update(humans) {
      const nowS = performance.now() / 1000;
      for (const entry of humans.values()) {
        const scan = entry.__scan;
        if (!scan || scan.state !== 'running') continue;
        const t = Math.min(1, (nowS - scan.startT) / scan.duration);
        const baseY = entry.group.position.y || 0;
        const fromY = scan.direction > 0 ? SCAN_BOTTOM_Y : SCAN_TOP_Y;
        const toY   = scan.direction > 0 ? SCAN_TOP_Y : SCAN_BOTTOM_Y;
        scan.uniforms.uScanPlaneY.value = baseY + fromY + (toY - fromY) * t;

        if (scan.rays) {
          _rayTmpCenter.set(entry.group.position.x, 0, entry.group.position.z);
          const planeY = scan.uniforms.uScanPlaneY.value;
          // Ball-surface source: origin tracks the surface point facing the
          // current print line. Subtle but makes the emission spot drift
          // upward as the scan rises.
          if (scan.sourceBall) {
            _rayTmpAim.set(entry.group.position.x, planeY, entry.group.position.z);
            _rayTmpSrcDir.subVectors(_rayTmpAim, scan.sourceBall.center);
            const len = _rayTmpSrcDir.length();
            if (len > 1e-4) {
              _rayTmpSrcDir.multiplyScalar(1 / len);
              scan.rays.userData.source
                .copy(scan.sourceBall.center)
                .addScaledVector(_rayTmpSrcDir, scan.sourceBall.radius);
            }
          }
          const emitter = scan.rays.userData.emitter;
          if (emitter) emitter.group.position.copy(scan.rays.userData.source);
          _updateRayFanTransform(scan.rays, _rayTmpCenter, planeY, SILHOUETTE_R, nowS - scan.startT);
          _updateRayFanOpacity(scan.rays, t);
        }
        if (t >= 1) {
          scan.state = 'idle';
          scan.uniforms.uScanActive.value = 0;
          if (scan.rays) { _disposeRayFan(scan.rays); scan.rays = null; }
          const cb = scan.onComplete;
          scan.onComplete = null;
          if (cb) cb(entry);
        }
      }
    },

    isScanning(entry) {
      return !!(entry.__scan && entry.__scan.state === 'running');
    },
  };
}
