import { generateHumanSpec } from './humanSpec.js';
import { makeRng } from '../engine/rng.js';

const STORAGE_KEY = 'gantz:roster';
const INITIAL_SEED = 'gantz-initial-cohort-v1';
const INITIAL_COUNT = 4;

const PERSONALITIES = ['veteran', 'rookie', 'jokester', 'loner', 'coward', 'zealot'];

const FIRST_NAMES = [
  'Kenji', 'Aiko', 'Takeshi', 'Hana', 'Ryu', 'Yuki', 'Daisuke', 'Sora',
  'Jiro', 'Emiko', 'Haruki', 'Megumi', 'Satoshi', 'Kaede', 'Hiro', 'Rei',
  'Akira', 'Ami', 'Yuto', 'Naoko', 'Mika', 'Koji', 'Nori', 'Saya',
  'Ichiro', 'Yumi', 'Tomo', 'Fuji', 'Ken', 'Rina',
];

function makeRecruitRecord(id, seed) {
  const r = makeRng(seed);
  const name = r.pick(FIRST_NAMES);
  const personality = r.pick(PERSONALITIES);
  return {
    id,
    seed,
    name,
    personality,
    points: 0,
    gear: { weapons: [], items: [], suit: null },
    alive: true,
  };
}

export function createInitialRoster() {
  const npcs = [];
  for (let i = 0; i < INITIAL_COUNT; i++) {
    const id = `recruit-${String(i + 1).padStart(3, '0')}`;
    npcs.push(makeRecruitRecord(id, `${INITIAL_SEED}-${i}`));
  }
  return { version: 1, npcs, createdAt: 0 };
}

export function loadRoster() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.npcs)) return null;
    if (typeof data.version !== 'number') return null;
    return data;
  } catch (e) {
    console.warn('[roster] load failed:', e);
    return null;
  }
}

export function saveRoster(roster) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
  } catch (e) {
    console.warn('[roster] save failed:', e);
  }
}

export function getOrCreateRoster() {
  const loaded = loadRoster();
  if (loaded) return loaded;
  const fresh = createInitialRoster();
  saveRoster(fresh);
  return fresh;
}

export function resetRoster() {
  const fresh = createInitialRoster();
  saveRoster(fresh);
  return fresh;
}

// Hydrate runtime fields (spec) that aren't stored in the persisted roster.
export function hydrateRoster(roster) {
  return {
    ...roster,
    npcs: roster.npcs.map(n => ({
      ...n,
      spec: generateHumanSpec(n.seed),
    })),
  };
}
