import { makeRng, hashString } from '../engine/rng.js';
import { generateHumanSpec } from './humanSpec.js';
import { generatePropSpec } from './propSpec.js';

const SHOP_NAMES = [
  'SAKURA', 'RYOKAI', 'YUKIMART', 'AOI RAMEN', 'NEONBAR',
  'HANA TEA', 'TOKYOMART', 'KATSU', 'HACHI', 'FUJI',
  'KINOKU', 'MIDORI', 'OHANA', 'AKIRA', 'KAZE',
];

const PROP_COLLIDERS = {
  bench:   s => ({ kind: 'aabb',   w: 1.65 * s, h: 0.52, tier: 'hard' }),
  vending: s => ({ kind: 'aabb',   w: 1.10 * s, h: 0.60, tier: 'hard' }),
  bollard: s => ({ kind: 'circle', r: 0.22 * s, tier: 'hard' }),
  trash:   s => ({ kind: 'circle', r: 0.42 * s, tier: 'prone' }),
  lamp:    () => null,
  sign:    () => null,
  crate:   s => ({ kind: 'circle', r: 0.52 * s, tier: 'hard' }),
};

function makeCol(type, spec, x, y) {
  const fn = PROP_COLLIDERS[type];
  if (!fn) return null;
  const base = fn(spec.scale || 1);
  if (!base) return null;
  return { ...base, x, y };
}

function isInsideBuilding(x, y, buildings, pad = 0.6) {
  for (const b of buildings) {
    const hw = b.w * 0.5 + pad;
    const hh = b.h * 0.5 + pad;
    if (x >= b.x - hw && x <= b.x + hw && y >= b.y - hh && y <= b.y + hh) return true;
  }
  return false;
}

export function generateMissionMap(seed, bounds) {
  const rng = makeRng(typeof seed === 'string' ? hashString(seed) : seed);
  const buildings = [];
  const props = [];
  const civilians = [];

  const xMin = bounds.minX + 2;
  const xMax = bounds.maxX - 2;
  const yMin = bounds.minY + 2;
  const yMax = bounds.maxY - 2;

  // Buildings on west and east edges
  const buildingDepth = 2.4;
  const buildingH = 4;
  const westX = bounds.minX + 0.5 + buildingDepth / 2;
  const eastX = bounds.maxX - 0.5 - buildingDepth / 2;

  for (let y = yMin + 2.5; y <= yMax - 2.5; y += buildingH + 0.6) {
    if (rng.chance(0.8)) {
      buildings.push({
        x: westX,
        y: y + rng.range(-0.3, 0.3),
        w: buildingDepth,
        h: buildingH,
        name: rng.pick(SHOP_NAMES),
      });
    }
    if (rng.chance(0.8)) {
      buildings.push({
        x: eastX,
        y: y + rng.range(-0.3, 0.3),
        w: buildingDepth,
        h: buildingH,
        name: rng.pick(SHOP_NAMES),
      });
    }
  }

  // Lamp posts along central corridor
  for (let y = yMin; y <= yMax; y += 3.5) {
    props.push({
      type: 'lamp', x: -5, y,
      spec: generatePropSpec('lamp', `lamp-w-${y}`, 'shop'),
      collider: null,
    });
    props.push({
      type: 'lamp', x:  5, y,
      spec: generatePropSpec('lamp', `lamp-e-${y}`, 'shop'),
      collider: null,
    });
  }

  // Street furniture
  for (let i = 0; i < 6; i++) {
    const x = rng.pick([-7, -6.5, 6.5, 7]);
    const y = rng.range(yMin + 1, yMax - 1);
    if (isInsideBuilding(x, y, buildings, 1.0)) continue;
    const spec = generatePropSpec('bench', `bench-${i}-${seed}`, 'shop');
    spec.rotation = 0;
    props.push({ type: 'bench', x, y, spec, collider: makeCol('bench', spec, x, y) });
  }

  for (let i = 0; i < 4; i++) {
    const x = rng.pick([-8, 8]);
    const y = rng.range(yMin + 1, yMax - 1);
    if (isInsideBuilding(x, y, buildings, 1.0)) continue;
    const spec = generatePropSpec('vending', `vend-${i}-${seed}`, 'shop');
    spec.rotation = 0;
    props.push({ type: 'vending', x, y, spec, collider: makeCol('vending', spec, x, y) });
  }

  // Bollards marking spawn pad entrance
  for (let x = -4.5; x <= 4.5; x += 1.5) {
    const spec = generatePropSpec('bollard', `bol-${x}`, 'shop');
    props.push({ type: 'bollard', x, y: yMin - 0.5 + 2.5, spec, collider: makeCol('bollard', spec, x, yMin - 0.5 + 2.5) });
  }

  // Trash piles
  for (let i = 0; i < 10; i++) {
    let x, y, tries = 0;
    do {
      x = rng.range(xMin, xMax);
      y = rng.range(yMin, yMax);
      tries++;
    } while (tries < 8 && isInsideBuilding(x, y, buildings));
    const spec = generatePropSpec('trash', `trash-${i}-${seed}`, 'shop');
    props.push({ type: 'trash', x, y, spec, collider: makeCol('trash', spec, x, y) });
  }

  // Signs (decorative)
  for (let i = 0; i < 6; i++) {
    const x = rng.range(xMin, xMax);
    const y = rng.range(yMin, yMax);
    if (isInsideBuilding(x, y, buildings)) continue;
    const spec = generatePropSpec('sign', `sign-${i}-${seed}`, 'shop');
    props.push({ type: 'sign', x, y, spec, collider: null });
  }

  // Civilians
  const CIV_BEHAVIORS = [
    { value: 'patrol', weight: 5 },
    { value: 'filmer', weight: 2 },
    { value: 'freezer', weight: 1 },
    { value: 'hero', weight: 1 },
  ];
  const civCount = 12;
  for (let i = 0; i < civCount; i++) {
    let x, y, tries = 0;
    do {
      x = rng.range(xMin + 1, xMax - 1);
      y = rng.range(yMin + 1, yMax - 1);
      tries++;
    } while (tries < 12 && isInsideBuilding(x, y, buildings, 0.5));
    civilians.push({
      id: `civ-${i}`,
      kind: 'civilian',
      spec: generateHumanSpec(`civ-${seed}-${i}`),
      x, y,
      facing: rng.range(0, Math.PI * 2),
      walkPhase: 0,
      radius: 0.32,
      speed: rng.range(1.5, 2.6),
      alive: true,
      behavior: rng.weighted(CIV_BEHAVIORS),
      wanderTarget: null,
      wanderRest: rng.range(0, 3),
      stuckTime: 0,
      freezeTimer: 0,
    });
  }

  return {
    theme: 'shopping_street',
    buildings,
    props,
    civilians,
    spawnPoint: { x: 0, y: yMin - 0.5, facing: Math.PI / 2 },
  };
}

// Civilian AI. Imports wanderer via caller to avoid cycles.
export function planCivilian(civ, dt, rng, bounds, planWanderer) {
  if (civ.behavior === 'freezer') {
    civ.walkPhase *= Math.pow(0.05, dt);
    return { vx: 0, vy: 0 };
  }
  if (civ.behavior === 'filmer') {
    civ.walkPhase *= Math.pow(0.05, dt);
    civ.freezeTimer -= dt;
    if (civ.freezeTimer <= 0) {
      civ.facing = rng.range(0, Math.PI * 2);
      civ.freezeTimer = rng.range(2, 5);
    }
    return { vx: 0, vy: 0 };
  }
  return planWanderer(civ, dt, rng, bounds);
}
