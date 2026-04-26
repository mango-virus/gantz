import { makeRng, hashString } from '../engine/rng.js';
import { generateHumanSpec } from './humanSpec.js';

// NOTE: The shopping-street procedural map (buildings + street furniture) was
// removed in favour of the hand-authored Kabukichō level (see
// `src/content/kabukichoLevel.js` and `kabukicho-preview.html`).
// This generator now only seeds civilian agents — buildings/props come from
// the new level module and are integrated by the renderer separately.

export const KABUKICHO_BOUNDS = { minX: -125, maxX: 125, minY: -125, maxY: 125 };

export function generateMissionMap(seed, bounds) {
  const rng = makeRng(typeof seed === 'string' ? hashString(seed) : seed);
  const buildings = [];
  const props = [];
  const civilians = [];

  const xMin = bounds.minX + 4;
  const xMax = bounds.maxX - 4;
  const yMin = bounds.minY + 4;
  const yMax = bounds.maxY - 4;

  const CIV_BEHAVIORS = [
    { value: 'patrol', weight: 5 },
    { value: 'filmer', weight: 2 },
    { value: 'freezer', weight: 1 },
    { value: 'hero', weight: 1 },
  ];
  const civCount = 12;
  for (let i = 0; i < civCount; i++) {
    const x = rng.range(xMin + 1, xMax - 1);
    const y = rng.range(yMin + 1, yMax - 1);
    civilians.push({
      id: `civ-${i}`,
      kind: 'civilian',
      spec: generateHumanSpec(`civ-${seed}-${i}`),
      x, y,
      facing: rng.range(0, Math.PI * 2),
      walkPhase: 0,
      radius: 0.5,
      speed: rng.range(0.7, 1.1),
      alive: true,
      behavior: rng.weighted(CIV_BEHAVIORS),
      wanderTarget: null,
      wanderRest: rng.range(0, 3),
      stuckTime: 0,
      freezeTimer: 0,
    });
  }

  return {
    theme: 'kabukicho',
    buildings,
    props,
    civilians,
    spawnPoint: { x: 0, y: 100, facing: -Math.PI / 2 },
  };
}

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
