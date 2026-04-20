import { makeRng } from '../engine/rng.js';
import { generateAlienSpec, ARCHETYPES } from '../content/alienSpec.js';

// Choose an alien composition for a mission, returning an array of archetype names.
// Driven by mission index so difficulty ramps.
export function rollMissionComposition(seed, missionIndex) {
  const rng = makeRng((seed >>> 0) ^ 0xbeef01);
  const out = [];
  const base = Math.min(3, 1 + Math.floor(missionIndex / 2));
  for (let i = 0; i < base; i++) out.push('patroller');
  if (missionIndex >= 2 && rng.chance(0.55)) out.push('brute');
  if (missionIndex >= 3 && rng.chance(0.5)) {
    // add a swarm of 3-5
    const n = rng.int(3, 5);
    for (let i = 0; i < n; i++) out.push('swarmer');
  }
  if (out.length === 0) out.push('patroller');
  return out;
}

export function rollBonusBoss(seed, missionIndex) {
  const rng = makeRng((seed >>> 0) ^ 0xb055a1);
  // 30% chance once the player has done a couple of missions
  return missionIndex >= 2 && rng.chance(0.3);
}

export function spawnFromComposition(seed, bounds, composition) {
  const rng = makeRng((seed >>> 0) ^ 0x5a17);
  const aliens = [];
  composition.forEach((archetype, i) => {
    const a = ARCHETYPES[archetype];
    const x = rng.range(bounds.minX + 3, bounds.maxX - 3);
    const y = rng.range(bounds.minY + 6, bounds.maxY - 3);
    aliens.push({
      id: `alien-${i}`,
      kind: 'alien',
      archetype,
      spec: generateAlienSpec(`alien-${seed}-${i}-${archetype}`, archetype),
      x, y,
      facing: rng.range(0, Math.PI * 2),
      walkPhase: 0,
      radius: a.radius,
      speed: a.speed,
      hp: a.hp,
      alive: true,
      isBonusBoss: false,
      state: 'wander',
      target: null,
      wanderTarget: null,
      wanderRest: rng.range(0, 2),
      attackCooldown: 0,
      marked: false,
      markedAt: 0,
      markFlash: 0,
      markHitsTaken: 0,
      markHitsRequired: a.markHits,
    });
  });
  return aliens;
}

export function spawnBonusBoss(seed, bounds, idx) {
  const rng = makeRng((seed >>> 0) ^ 0xb055 ^ idx);
  const a = ARCHETYPES.boss;
  return {
    id: `boss-${idx}`,
    kind: 'alien',
    archetype: 'boss',
    spec: generateAlienSpec(`boss-${seed}-${idx}`, 'boss'),
    x: rng.range(bounds.minX + 5, bounds.maxX - 5),
    y: rng.range(bounds.minY + 6, bounds.maxY - 6),
    facing: rng.range(0, Math.PI * 2),
    walkPhase: 0,
    radius: a.radius,
    speed: a.speed,
    hp: a.hp,
    alive: true,
    isBonusBoss: true,
    state: 'wander',
    target: null,
    wanderTarget: null,
    wanderRest: 0,
    attackCooldown: 0,
    marked: false,
    markedAt: 0,
    markFlash: 0,
    markHitsTaken: 0,
    markHitsRequired: a.markHits,
  };
}

function nearestLivingTarget(alien, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    if (!c || c.alive === false) continue;
    const d = Math.hypot(c.x - alien.x, c.y - alien.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { target: best, distance: bestD };
}

export function planAlien(alien, dt, rng, bounds, targets) {
  if (!alien.alive) {
    alien.walkPhase *= Math.pow(0.05, dt);
    return { vx: 0, vy: 0 };
  }
  alien.markFlash += dt;
  if (alien.marked) {
    alien.walkPhase *= Math.pow(0.3, dt);
    return { vx: 0, vy: 0 };
  }
  if (alien.attackCooldown > 0) alien.attackCooldown -= dt;

  const arch = ARCHETYPES[alien.archetype];
  const { target, distance } = nearestLivingTarget(alien, targets);

  if (target && distance < arch.sightRange) {
    alien.state = 'chase';
    alien.target = target.id || null;
    if (distance <= arch.meleeRange) {
      if (alien.attackCooldown <= 0) {
        alien.attackCooldown = arch.attackCooldown;
        alien._pendingAttack = { targetId: target.id, damage: arch.meleeDamage };
      }
      alien.walkPhase *= Math.pow(0.1, dt);
      return { vx: 0, vy: 0 };
    }
    const dx = target.x - alien.x, dy = target.y - alien.y;
    const d = Math.hypot(dx, dy) || 1;
    alien.facing = Math.atan2(dy, dx);
    alien.walkPhase += dt * 8;
    return { vx: (dx / d) * alien.speed, vy: (dy / d) * alien.speed };
  }

  alien.state = 'wander';
  alien.target = null;
  if (alien.wanderTarget) {
    const dx = alien.wanderTarget.x - alien.x, dy = alien.wanderTarget.y - alien.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) {
      alien.wanderTarget = null;
      alien.wanderRest = 1 + rng.next() * 2;
      return { vx: 0, vy: 0 };
    }
    alien.facing = Math.atan2(dy, dx);
    alien.walkPhase += dt * 7;
    const sp = alien.speed * 0.55;
    return { vx: (dx / d) * sp, vy: (dy / d) * sp };
  }
  alien.walkPhase *= Math.pow(0.2, dt);
  alien.wanderRest -= dt;
  if (alien.wanderRest <= 0) {
    alien.wanderTarget = {
      x: bounds.minX + 2 + rng.next() * (bounds.maxX - bounds.minX - 4),
      y: bounds.minY + 2 + rng.next() * (bounds.maxY - bounds.minY - 4),
    };
  }
  return { vx: 0, vy: 0 };
}

// Returns array of aliens that died this tick.
export function tickMarked(aliens, dt, onDied) {
  for (const a of aliens) {
    if (!a.alive || !a.marked) continue;
    const markMs = (a._markTimeMs != null ? a._markTimeMs : 1500);
    if (performance.now() - a.markedAt >= markMs) {
      a.markHitsTaken = (a.markHitsTaken || 0) + 1;
      if (a.markHitsTaken >= (a.markHitsRequired || 1)) {
        a.alive = false;
        a.hp = 0;
        if (onDied) onDied(a);
      } else {
        // survived — unmark, flinch
        a.marked = false;
      }
    }
  }
}
