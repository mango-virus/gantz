import { generatePropSpec } from '../content/propSpec.js';
import { makeRng } from '../engine/rng.js';

// Bounds match the GLB room interior (world X/Z from scene measurements).
// Game coords: gameX = world X, gameY = world Z.
export const LOBBY_BOUNDS = { minX: -5.5, maxX: 4.0, minY: -8.7, maxY: 12.5 };
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
  const cy = (B.minY + B.maxY) / 2;
  const W  = B.maxX - B.minX;
  const H  = B.maxY - B.minY;
  return [
    { kind: 'aabb', x: B.maxX + t / 2, y: cy, w: t, h: H + 2 * t, tier: 'hard' },
    { kind: 'aabb', x: B.minX - t / 2, y: cy, w: t, h: H + 2 * t, tier: 'hard' },
    { kind: 'aabb', x: cx, y: B.minY - t / 2, w: W + 2 * t, h: t, tier: 'hard' },
    { kind: 'aabb', x: cx, y: B.maxY + t / 2, w: W + 2 * t, h: t, tier: 'hard' },
  ];
}

export function getGantzBallCollider() {
  return {
    kind: 'circle',
    x: GANTZ_BALL.x, y: GANTZ_BALL.y,
    r: GANTZ_BALL.radius * 0.8,  // mesh is scaled 0.8 in scene3d
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
