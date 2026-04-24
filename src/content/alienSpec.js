import { makeRng, hashString } from '../engine/rng.js';

// Pool of mission alien names — one is drawn per archetype per mission.
export const ALIEN_NAMES = [
  // -- User-supplied originals --
  'Onion Alien',
  'Tanaka Alien',
  'Buddhist Temple Aliens',
  'Shorty Alien',
  'Kappe Alien',
  'Dinosaur Aliens',
  'Ring Alien',
  'Nurarihyon',
  'Daidarabotchi',
  'Tengu',
  'The Giants',
  'Kuchisake Alien',
  'Aka Manto Alien',
  'Hikiko Alien',
  'Daruma Alien',
  'Karakasa Alien',
  'Mannequin Alien',
  'Salaryman Alien',
  'Cactus Alien',
  'Construction Alien',
  'Chef Alien',
  'Insects of the Void',
  'Deep Sea Horror Alien',
  'Sabertooth Alien',
  'The Architect',
  'Mirror Alien',
  'The Symphony Alien',
  // -- Extended pool --
  'Tofu Alien',
  'Oni Alien',
  'Kitsune Alien',
  'Gashadokuro',
  'Jorōgumo',
  'Enenra',
  'Noh Mask Alien',
  'Pachinko Alien',
  'Subway Alien',
  'Vending Machine Alien',
  'Sumo Alien',
  'Bathhouse Alien',
  'The Collector',
  'Lanternfish Alien',
  'The Sculptor',
  'Centipede Alien',
  'Bamboo Alien',
  'Clockwork Alien',
  'The Hollow',
  'Neon Alien',
  'The Weeping One',
  'Kirin Alien',
  'Origami Alien',
  'The Pale Stranger',
  'Thunderhead Alien',
  'Paper Lantern Alien',
  'The Cartographer',
  'Shrine Maiden Alien',
  'The Revenant',
  'Umbra',
  'Torii Alien',
];

// Pick `count` unique names from ALIEN_NAMES using a seeded RNG.
export function pickAlienNames(seed, count) {
  const rng = makeRng((seed >>> 0) ^ 0xc0ffee);
  const pool = ALIEN_NAMES.slice();
  const out = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng.next() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

const BODY_PLANS = ['biped', 'quadruped', 'serpent', 'floater', 'insectoid'];
const SKIN_PATTERNS = ['smooth', 'scaled', 'mottled', 'striped', 'chitinous'];
const WEAPONS = ['none', 'claws', 'projectile', 'whip', 'ram'];

export const ARCHETYPES = {
  patroller: {
    name: 'Patroller',
    hp: 100, markHits: 1, speed: 2.4, radius: 0.55,
    meleeRange: 0.9, meleeDamage: 25, sightRange: 8, attackCooldown: 1.2,
    points: 100,
    hint: 'wanders · lunges at close range',
    sizeMul: 1.0,
  },
  brute: {
    name: 'Brute',
    hp: 200, markHits: 2, speed: 1.7, radius: 0.72,
    meleeRange: 1.2, meleeDamage: 45, sightRange: 10, attackCooldown: 1.6,
    points: 150,
    hint: 'heavy · soaks two X-gun marks',
    sizeMul: 1.35,
  },
  swarmer: {
    name: 'Swarmer',
    hp: 45, markHits: 1, speed: 3.5, radius: 0.42,
    meleeRange: 0.75, meleeDamage: 15, sightRange: 7, attackCooldown: 0.8,
    points: 60,
    hint: 'small · fast · travels in packs',
    sizeMul: 0.85,
  },
  boss: {
    name: 'Unknown',
    hp: 600, markHits: 3, speed: 2.2, radius: 0.95,
    meleeRange: 1.5, meleeDamage: 60, sightRange: 14, attackCooldown: 1.4,
    points: 400,
    hint: 'Gantz did not announce this one',
    sizeMul: 1.9,
  },
};

export function generateAlienSpec(seed, archetype = 'patroller') {
  const s = typeof seed === 'string' ? hashString(seed) : seed;
  const r = makeRng(s);
  const sizeMul = ARCHETYPES[archetype]?.sizeMul || 1;
  return {
    kind: 'alien',
    seed: s,
    archetype,
    body: r.pick(BODY_PLANS),
    size: r.range(0.75, 2.25) * sizeMul,
    bulk: r.range(0.8, 1.4),   // width scalar — makes some aliens stocky, others lanky
    height: r.range(0.85, 1.3), // vertical stretch
    limbLen: r.range(0.85, 1.25),
    limbs: archetype === 'swarmer' ? r.int(3, 5) : r.int(3, 6),
    skin: {
      pattern: r.pick(SKIN_PATTERNS),
      primary: archetype === 'boss'
        ? `hsl(${r.int(340, 360)}, 70%, 25%)`
        : `hsl(${r.int(0, 360)}, ${r.int(30, 80)}%, ${r.int(12, 38)}%)`,
      accent: archetype === 'boss'
        ? '#ffd040'
        : `hsl(${r.int(0, 360)}, ${r.int(40, 90)}%, ${r.int(30, 58)}%)`,
    },
    eyeCount: archetype === 'boss' ? 6 : r.int(1, 4),
    weapon: r.pick(WEAPONS),
  };
}
