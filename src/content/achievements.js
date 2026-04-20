const KEY = 'gantz:stats';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}

export function getStats() {
  return load() || {
    survivedRuns: 0,
    missionsCompleted: 0,
    hundredPointClub: false,   // 100 pts in a single mission
    totalWipes: 0,
    bossesKilled: 0,
    civiliansKilled: 0,
    lifetimePoints: 0,
  };
}

export function saveStats(stats) {
  save(stats);
}

export function recordMissionResult({ pointsEarned, cleared, bossKilled, civilianKills }) {
  const s = getStats();
  s.missionsCompleted += cleared ? 1 : 0;
  s.lifetimePoints += Math.max(0, pointsEarned);
  if (pointsEarned >= 100) s.hundredPointClub = true;
  if (bossKilled) s.bossesKilled += 1;
  s.civiliansKilled += civilianKills || 0;
  save(s);
  return s;
}

export function recordWipe() {
  const s = getStats();
  s.totalWipes += 1;
  save(s);
  return s;
}

export function recordSurvivedRun() {
  const s = getStats();
  s.survivedRuns += 1;
  save(s);
  return s;
}
