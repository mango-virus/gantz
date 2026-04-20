import { makeRng, hashString } from '../engine/rng.js';
import * as P from './palettes.js';

const HAIR_STYLES = ['short', 'messy', 'long', 'ponytail', 'buzz', 'bald', 'topknot'];
const BUILDS = [
  { value: 'slim', weight: 3 },
  { value: 'average', weight: 5 },
  { value: 'heavy', weight: 2 },
];
const PATTERNS = [
  { value: 'none', weight: 6 },
  { value: 'stripe', weight: 2 },
  { value: 'logo', weight: 1 },
];

export function generateHumanSpec(seed) {
  const s = typeof seed === 'string' ? hashString(seed) : seed;
  const r = makeRng(s);
  return {
    kind: 'human',
    seed: s,
    build: r.weighted(BUILDS),
    height: r.range(1.55, 1.92),
    skin: r.pick(P.SKIN),
    hair: {
      style: r.pick(HAIR_STYLES),
      color: r.pick(P.HAIR),
    },
    outfit: {
      top: r.pick(P.OUTFIT_TOPS),
      bottom: r.pick(P.OUTFIT_BOTTOMS),
      accent: r.pick(P.ACCENTS),
      pattern: r.weighted(PATTERNS),
    },
  };
}
