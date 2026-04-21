import { generatePropSpec } from '../content/propSpec.js';
import { makeRng } from '../engine/rng.js';

export const LOBBY_BOUNDS = { minX: -5, maxX: 5, minY: -8, maxY: 8 };
export const GANTZ_BALL = { x: 0, y: -4, radius: 1.2 };

const PROP_LAYOUT = [];

const PROP_COLLIDERS = {
  pillar:      s => ({ kind: 'circle', r: 0.38 * s,                tier: 'hard' }),
  crate:       s => ({ kind: 'circle', r: 0.52 * s,                tier: 'hard' }),
  bench:       s => ({ kind: 'aabb',   w: 1.65 * s, h: 0.52,       tier: 'hard' }),
  console:     s => ({ kind: 'circle', r: 0.70 * s,                tier: 'hard' }),
  lamp:        () => null,
  panel_light: () => null,
};

function makePropCollider(type, spec, x, y) {
  const fn = PROP_COLLIDERS[type];
  if (!fn) return null;
  const base = fn(spec.scale || 1);
  if (!base) return null;
  return { ...base, x, y };
}

export function buildLobbyProps() {
  return PROP_LAYOUT.map((p, i) => {
    const spec = generatePropSpec(p.type, `lobby-prop-${i}`);
    if (p.rotation != null) spec.rotation = p.rotation;
    const collider = makePropCollider(p.type, spec, p.x, p.y);
    return { spec, x: p.x, y: p.y, collider };
  });
}

export function buildLobbyWalls() {
  const B = LOBBY_BOUNDS;
  const t = 0.5;
  const cx = (B.minX + B.maxX) / 2;
  const W = B.maxX - B.minX + 2 * t;

  // Door positions and width (must match addDoor calls in factories.js)
  const DW  = 1.25;  // door width
  const DH  = DW / 2;
  // Left wall doors: game-Y positions (3D Z maps to game Y)
  const D0Y = 5.5, D1Y = -1.5;
  // Far/back wall doors: game-X position
  const D2X = 0;

  // Helper: create AABB segments for a wall with one or more door gaps.
  // wallX/wallY is the wall's constant axis value (with t/2 offset already applied).
  // isHoriz: true = wall runs along X (h is thin dimension), false = runs along Y (w is thin).
  // segments: array of [spanStart, spanEnd] ranges for the continuous axis.
  // Returns an array of AABB colliders with gaps cut for each door.
  function segmentsAlongY(wallX, wallY_ignored, wallW, spanMin, spanMax, gaps) {
    // gaps = sorted array of [gapLo, gapHi]
    const walls = [];
    let cursor = spanMin;
    for (const [lo, hi] of gaps) {
      if (cursor < lo) {
        const h = lo - cursor;
        walls.push({ kind: 'aabb', x: wallX, y: cursor + h / 2, w: wallW, h, tier: 'hard' });
      }
      cursor = hi;
    }
    if (cursor < spanMax) {
      const h = spanMax - cursor;
      walls.push({ kind: 'aabb', x: wallX, y: cursor + h / 2, w: wallW, h, tier: 'hard' });
    }
    return walls;
  }

  function segmentsAlongX(wallX_ignored, wallY, wallH, spanMin, spanMax, gaps) {
    const walls = [];
    let cursor = spanMin;
    for (const [lo, hi] of gaps) {
      if (cursor < lo) {
        const w = lo - cursor;
        walls.push({ kind: 'aabb', x: cursor + w / 2, y: wallY, w, h: wallH, tier: 'hard' });
      }
      cursor = hi;
    }
    if (cursor < spanMax) {
      const w = spanMax - cursor;
      walls.push({ kind: 'aabb', x: cursor + w / 2, y: wallY, w, h: wallH, tier: 'hard' });
    }
    return walls;
  }

  // Adjacent room wall positions — must match addAdjRoom calls in factories.js.
  // Game coords: x = 3D x, y = 3D z.  WT3D = lobby 3D wall thickness (0.15 m).
  const WT3D   = 0.15;
  const LW_OUT = B.minX - WT3D;  // left wall outer face  (-5.15)
  const FW_OUT = B.minY - WT3D;  // far  wall outer face  (-8.15)
  const BW_OUT = B.maxY + WT3D;  // back wall outer face  (+8.15)
  const WA     = 0.3;            // adj-room wall AABB thickness

  // Bedroom (door 0, rw=5.5, rd=3.0, cz=5.5):  x∈[-10.65, -5.15]  y∈[4.0, 7.0]
  const D0_cx = LW_OUT - 5.5 / 2;   // -7.9
  const D0_xf = D0_cx - 5.5 / 2;    // -10.65 (far wall x)
  const D0_cx_lat = (D0_xf + B.minX) / 2;  // lateral wall centre x, extended to lobby inner face
  const D0_lat_w  = B.minX - D0_xf;         // lateral wall width

  // Bathroom (door 1, rw=5.0, rd=2.5, cz=-1.5): x∈[-10.15, -5.15]  y∈[-2.75, -0.25]
  const D1_cx = LW_OUT - 5.0 / 2;   // -7.65
  const D1_xf = D1_cx - 5.0 / 2;    // -10.15
  const D1_cx_lat = (D1_xf + B.minX) / 2;
  const D1_lat_w  = B.minX - D1_xf;

  // Kitchen (door 2, rw=5.0, rd=4.0, cx=0):    x∈[-2.5, 2.5]   y∈[-12.15, -8.15]
  const D2_zf = FW_OUT - 4.0 / 2;   // -10.15 (far wall z = game-y)
  const D2_cy_lat = (D2_zf - 4.0 / 2 + B.minY) / 2;  // lateral wall centre y
  const D2_lat_h  = B.minY - (D2_zf - 4.0 / 2);

  // Hallway  (door 3, rw=5.0, rd=4.0, cx=0):   x∈[-2.5, 2.5]   y∈[+8.15, +12.15]
  const D3_zf = BW_OUT + 4.0 / 2;   // +10.15 (far wall z)
  const D3_cy_lat = (D3_zf + 4.0 / 2 + B.maxY) / 2;
  const D3_lat_h  = (D3_zf + 4.0 / 2) - B.maxY;

  return [
    // Right wall — no doors, stays solid
    { kind: 'aabb', x: B.maxX + t / 2, y: 0, w: t, h: B.maxY - B.minY, tier: 'hard' },

    // Left wall — two door gaps (Door 0 at y=5.5, Door 1 at y=-1.5)
    ...segmentsAlongY(
      B.minX - t / 2, 0, t,
      B.minY, B.maxY,
      [
        [D1Y - DH, D1Y + DH],   // Door 1 gap
        [D0Y - DH, D0Y + DH],   // Door 0 gap
      ],
    ),

    // Far wall (minY) — one door gap at x=0 (Door 2)
    ...segmentsAlongX(
      0, B.minY - t / 2, t,
      B.minX - t, B.maxX + t,
      [[D2X - DH, D2X + DH]],
    ),

    // Back wall (maxY) — one door gap at x=0 (Door 3)
    ...segmentsAlongX(
      0, B.maxY + t / 2, t,
      B.minX - t, B.maxX + t,
      [[D2X - DH, D2X + DH]],
    ),

    // ── Adjacent room walls (3 enclosed sides each) ──────────────────────────
    // Bedroom (door 0) — rd=7.0, spans y∈[D0Y-3.5, D0Y+3.5]=[2.0, 9.0]
    { kind: 'aabb', x: D0_xf,      y: D0Y,       w: WA,        h: 7.0,       tier: 'hard' },  // far wall
    { kind: 'aabb', x: D0_cx_lat,  y: D0Y - 3.5, w: D0_lat_w, h: WA,        tier: 'hard' },  // south wall
    { kind: 'aabb', x: D0_cx_lat,  y: D0Y + 3.5, w: D0_lat_w, h: WA,        tier: 'hard' },  // north wall

    // Bathroom (door 1) — rd=5.0, spans y∈[D1Y-2.5, D1Y+2.5]=[-4.0, 1.0]
    { kind: 'aabb', x: D1_xf,      y: D1Y,       w: WA,        h: 5.0,       tier: 'hard' },  // far wall
    { kind: 'aabb', x: D1_cx_lat,  y: D1Y - 2.5, w: D1_lat_w, h: WA,        tier: 'hard' },  // south wall
    { kind: 'aabb', x: D1_cx_lat,  y: D1Y + 2.5, w: D1_lat_w, h: WA,        tier: 'hard' },  // north wall

    // Kitchen (door 2)
    { kind: 'aabb', x: 0,          y: D2_zf - 2.0, w: 5.0,     h: WA,        tier: 'hard' },  // far wall
    { kind: 'aabb', x: -2.5,       y: D2_cy_lat,   w: WA,       h: D2_lat_h, tier: 'hard' },  // left wall
    { kind: 'aabb', x:  2.5,       y: D2_cy_lat,   w: WA,       h: D2_lat_h, tier: 'hard' },  // right wall

    // Hallway (door 3)
    { kind: 'aabb', x: 0,          y: D3_zf + 2.0, w: 5.0,     h: WA,        tier: 'hard' },  // far wall
    { kind: 'aabb', x: -2.5,       y: D3_cy_lat,   w: WA,       h: D3_lat_h, tier: 'hard' },  // left wall
    { kind: 'aabb', x:  2.5,       y: D3_cy_lat,   w: WA,       h: D3_lat_h, tier: 'hard' },  // right wall
  ];
}

export function getGantzBallCollider() {
  return {
    kind: 'circle',
    x: GANTZ_BALL.x, y: GANTZ_BALL.y,
    r: GANTZ_BALL.radius,
    tier: 'hard',
  };
}

export function spawnLobbyNPCs(hydratedRoster) {
  const rng = makeRng('lobby-npc-layout');
  return hydratedRoster.npcs.map(r => {
    const x = rng.range(LOBBY_BOUNDS.minX + 1.5, LOBBY_BOUNDS.maxX - 1.5);
    const y = rng.range(LOBBY_BOUNDS.minY + 1.5, LOBBY_BOUNDS.maxY - 1.5);
    return {
      id: r.id,
      kind: 'npc_wanderer',
      spec: r.spec,
      name: r.name,
      personality: r.personality,
      points: r.points || 0,
      x, y,
      facing: rng.range(0, Math.PI * 2),
      walkPhase: 0,
      radius: 0.35,
      alive: r.alive !== false,
      ready: true,
      speed: rng.range(1.8, 2.8),
      wanderTarget: null,
      wanderRest: rng.range(0, 2),
      stuckTime: 0,
    };
  });
}

export function planWanderer(npc, dt, rng, bounds) {
  const b = bounds || LOBBY_BOUNDS;
  if (npc.wanderTarget) {
    const dx = npc.wanderTarget.x - npc.x;
    const dy = npc.wanderTarget.y - npc.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.25) {
      npc.wanderTarget = null;
      npc.wanderRest = 1 + rng.next() * 3;
      return { vx: 0, vy: 0 };
    }
    npc.facing = Math.atan2(dy, dx);
    npc.walkPhase += dt * 9;
    return { vx: (dx / d) * npc.speed, vy: (dy / d) * npc.speed };
  }
  npc.walkPhase *= Math.pow(0.05, dt);
  npc.wanderRest -= dt;
  if (npc.wanderRest <= 0) {
    npc.wanderTarget = {
      x: b.minX + 1.5 + rng.next() * (b.maxX - b.minX - 3),
      y: b.minY + 1.5 + rng.next() * (b.maxY - b.minY - 3),
    };
  }
  return { vx: 0, vy: 0 };
}

export function checkStuckWanderer(npc, prevX, prevY, dt, rng) {
  if (!npc.wanderTarget) { npc.stuckTime = 0; return; }
  const moved = Math.hypot(npc.x - prevX, npc.y - prevY);
  const expected = npc.speed * dt * 0.5;
  if (moved < expected) {
    npc.stuckTime += dt;
    if (npc.stuckTime > 0.4) {
      npc.wanderTarget = null;
      npc.wanderRest = 0.5 + rng.next() * 1.5;
      npc.stuckTime = 0;
    }
  } else {
    npc.stuckTime = 0;
  }
}

export function drawLobby(r) {
  const B = LOBBY_BOUNDS;
  const W = B.maxX - B.minX;
  const H = B.maxY - B.minY;

  r.drawRect(B.minX, B.minY, W, H, { fill: '#161929' });

  for (let x = Math.ceil(B.minX); x <= B.maxX; x++) {
    r.drawLine(x, B.minY, x, B.maxY, { stroke: '#0a0c18', lineWidth: 0.015, alpha: 0.8 });
  }
  for (let y = Math.ceil(B.minY); y <= B.maxY; y++) {
    r.drawLine(B.minX, y, B.maxX, y, { stroke: '#0a0c18', lineWidth: 0.015, alpha: 0.8 });
  }

  r.drawRect(B.minX, B.minY, W, 0.35, { fill: '#0a0c18', alpha: 0.9 });
  r.drawRect(B.minX, B.maxY - 0.35, W, 0.35, { fill: '#0a0c18', alpha: 0.9 });
  r.drawRect(B.minX, B.minY, 0.35, H, { fill: '#0a0c18', alpha: 0.9 });
  r.drawRect(B.maxX - 0.35, B.minY, 0.35, H, { fill: '#0a0c18', alpha: 0.9 });

  const t = 0.5;
  r.drawRect(B.minX - t, B.minY - t, W + 2 * t, t, { fill: '#050710' });
  r.drawRect(B.minX - t, B.maxY,       W + 2 * t, t, { fill: '#050710' });
  r.drawRect(B.minX - t, B.minY,       t, H,         { fill: '#050710' });
  r.drawRect(B.maxX,     B.minY,       t, H,         { fill: '#050710' });

  r.drawLine(B.minX, B.minY, B.maxX, B.minY, { stroke: '#c8142b', lineWidth: 0.035, alpha: 0.55 });
  r.drawLine(B.minX, B.maxY, B.maxX, B.maxY, { stroke: '#c8142b', lineWidth: 0.035, alpha: 0.55 });
  r.drawLine(B.minX, B.minY, B.minX, B.maxY, { stroke: '#c8142b', lineWidth: 0.035, alpha: 0.55 });
  r.drawLine(B.maxX, B.minY, B.maxX, B.maxY, { stroke: '#c8142b', lineWidth: 0.035, alpha: 0.55 });
}
