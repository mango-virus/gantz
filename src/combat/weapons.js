export const WEAPONS = {
  xgun: {
    id: 'xgun',
    name: 'X-Gun',
    rarity: 'common',
    range: 40,
    cooldown: 1.5,
    markTime: 3.0,
    mode: 'single',
    tracerColor: '#66ddff',
    hudMode: 'cycle',
    hint: 'Mark a target. They bloat and detonate in 3s.',
  },
  xshot: {
    id: 'xshot',
    name: 'X-Shotgun',
    rarity: 'common',
    range: 12,
    cooldown: 1.2,
    markTime: 1.3,
    mode: 'spread',
    spreadCount: 5,
    spreadAngle: 0.6,
    tracerColor: '#ff8030',
    hint: 'Cone spread. Close range.',
  },
  xsword: {
    id: 'xsword',
    name: 'X-Sword',
    rarity: 'rare',
    range: 2.2,
    cooldown: 0.35,
    markTime: 0.6,
    mode: 'single',
    tracerColor: '#50e0ff',
    hint: 'Short reach, fast fuse.',
  },
  xsniper: {
    id: 'xsniper',
    name: 'X-Sniper',
    rarity: 'rare',
    range: 100,
    cooldown: 1.8,
    markTime: 2.5,
    mode: 'single',
    tracerColor: '#e040ff',
    hint: 'Long range, slow fuse.',
  },
  ygun: {
    id: 'ygun',
    name: 'Y-Gun',
    rarity: 'rare',
    range: 20,
    cooldown: 1.0,
    markTime: 4.0,
    mode: 'single',
    tracerColor: '#ffde55',
    hint: 'Pins the target for 4s. Slow kill.',
  },
};

export const COMMON_WEAPON_POOL = ['xgun', 'xshot'];
export const RARE_WEAPON_POOL = ['xsword', 'xsniper', 'ygun'];

export const SUITS = {
  basic:    { name: 'Gantz Suit (Basic)',    maxHp: 100, speedMul: 1.0, tier: 1 },
  advanced: { name: 'Gantz Suit (Advanced)', maxHp: 200, speedMul: 1.15, tier: 2 },
  elite:    { name: 'Gantz Suit (Elite)',    maxHp: 300, speedMul: 1.3,  tier: 3 },
};

export function baseLoadout() {
  return { weapon1: 'xgun', weapon2: null, item1: null, item2: null, suit: 'basic' };
}

export function rollRandomWeapon(rng, tier) {
  const pool = tier === 'rare' ? RARE_WEAPON_POOL : COMMON_WEAPON_POOL;
  return pool[Math.floor(rng.next() * pool.length)];
}

export function rollSuitUpgrade(rng, currentTier) {
  const t = SUITS[currentTier]?.tier || 1;
  // 70% chance to bump one tier; 30% to stay same
  if (t >= 3) return currentTier;
  return rng.chance(0.7) ? (t === 1 ? 'advanced' : 'elite') : currentTier;
}
