import { makeRng, hashString } from '../engine/rng.js';

export function generatePropSpec(type, seed, theme = 'lobby') {
  const s = typeof seed === 'string' ? hashString(seed) : seed;
  const r = makeRng(s);
  return {
    kind: 'prop',
    type,
    seed: s,
    theme,
    rotation: r.range(0, Math.PI * 2),
    scale: r.range(0.9, 1.1),
    tint: r.range(-0.06, 0.06),
  };
}
