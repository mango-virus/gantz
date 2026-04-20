// NPC recruits — combat + personality AI in missions.
// Host-authoritative: only the host runs NPC AI and applies their effects.

const PERSONALITY_WEIGHTS = {
  veteran:  { aggro: 0.8, fireRange: 9,  retreatHp: 30, chatter: 0.6 },
  rookie:   { aggro: 0.5, fireRange: 6,  retreatHp: 50, chatter: 0.8 },
  jokester: { aggro: 0.7, fireRange: 8,  retreatHp: 35, chatter: 1.0 },
  loner:    { aggro: 0.9, fireRange: 10, retreatHp: 25, chatter: 0.3 },
  coward:   { aggro: 0.3, fireRange: 5,  retreatHp: 70, chatter: 0.7 },
  zealot:   { aggro: 1.0, fireRange: 12, retreatHp: 15, chatter: 0.5 },
};

export function getPersonality(tag) {
  return PERSONALITY_WEIGHTS[tag] || PERSONALITY_WEIGHTS.veteran;
}

export const NPC_LINES = {
  mission_start: {
    veteran:  ['Stay sharp.', 'Move as a unit.', 'Contact soon.'],
    rookie:   ['Oh god oh god.', 'Here we go again.', 'I hate this.'],
    jokester: ['Tokyo tour, second location.', 'Anyone else forgot breakfast?', 'Smile for Gantz.'],
    loner:    ['.', '...', 'Targets.'],
    coward:   ['Please let them be small today.', 'Stay behind me. Or in front.', 'Oh no, oh no.'],
    zealot:   ['Gantz demands blood.', 'Die, abominations.', 'BURN.'],
  },
  alien_killed: {
    veteran:  ['Clean.', 'Next.', 'One down.'],
    rookie:   ['HOLY—!', 'I can\'t believe that worked.', 'Did we get it?'],
    jokester: ['Love that for us.', 'Write that one down.', 'Chef\'s kiss.'],
    loner:    ['Hn.', 'Acceptable.', ''],
    coward:   ['Thank god. Thank god.', 'It\'s dead. Right? It\'s dead?'],
    zealot:   ['One more for the altar.', 'Purified.', 'HA!'],
  },
  low_hp: {
    veteran:  ['Tagged. Fallback.', 'I need cover.', 'Bleeding.'],
    rookie:   ['HELP HELP HELP.', 'I\'m gonna die!', 'oh my god oh my god'],
    jokester: ['Ow. OW. Very ow.', 'This is fine.', 'Not my lucky day.'],
    loner:    ['...hit.', 'Patching.', 'Moving.'],
    coward:   ['I NEED A REVIVE ALREADY!', 'Someone—SOMEONE!', 'I can\'t I can\'t I can\'t'],
    zealot:   ['Pain is communion.', 'STILL STANDING.', 'It only makes me stronger.'],
  },
  boss_reveal: {
    veteran:  ['What the—', 'That wasn\'t in the briefing.', 'New target. Big one.'],
    rookie:   ['NO. NO NO NO.', 'WE DIDN\'T SIGN UP FOR THIS.'],
    jokester: ['Gantz forgot to mention this one.', 'Surprise midterm.', 'Cute.'],
    loner:    ['Expected.', 'Real target.', ''],
    coward:   ['OH GOD IT\'S HUGE.', 'I want off this ride.'],
    zealot:   ['YES. YES. THE TRUE PREY.', 'Finally.', 'COME TO ME.'],
  },
};

const _lastChatByGlobal = { t: 0 };
const GLOBAL_CHAT_COOLDOWN_MS = 4000;

export function maybeTriggerNpcLine(npc, event, now, chatAdd) {
  const rng = Math.random();
  const p = getPersonality(npc.personality);
  if (rng > p.chatter * 0.6) return false;   // gated by personality chattiness
  if (now - _lastChatByGlobal.t < GLOBAL_CHAT_COOLDOWN_MS) return false;
  const pool = NPC_LINES[event]?.[npc.personality];
  if (!pool || pool.length === 0) return false;
  const line = pool[Math.floor(Math.random() * pool.length)];
  if (!line) return false;
  _lastChatByGlobal.t = now;
  chatAdd({ peerId: npc.id, username: npc.name, color: 'a8a8b8', text: line });
  return true;
}

function nearestAlive(npc, targets) {
  let best = null, bestD = Infinity;
  for (const t of targets) {
    if (!t || t.alive === false) continue;
    const d = Math.hypot(t.x - npc.x, t.y - npc.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return { target: best, distance: bestD };
}

export function planNpcCombat(npc, dt, rng, bounds, aliens) {
  const p = getPersonality(npc.personality);
  const healthFrac = (npc.hp || 100) / 100;
  const retreat = healthFrac * 100 < p.retreatHp;

  const { target, distance } = nearestAlive(npc, aliens);
  if (target && !retreat) {
    npc.combatTarget = target.id;
    const fireRange = p.fireRange;
    if (distance < fireRange) {
      // In firing position; slow/halt and broadcast intent to fire (handled by caller)
      npc._wantsFire = true;
      npc._fireAtX = target.x; npc._fireAtY = target.y;
      npc.facing = Math.atan2(target.y - npc.y, target.x - npc.x);
      npc.walkPhase *= Math.pow(0.1, dt);
      return { vx: 0, vy: 0 };
    }
    // Move toward alien
    const dx = target.x - npc.x, dy = target.y - npc.y;
    const d = Math.hypot(dx, dy) || 1;
    npc.facing = Math.atan2(dy, dx);
    npc.walkPhase += dt * 8;
    const sp = npc.speed * (0.8 + p.aggro * 0.3);
    return { vx: (dx / d) * sp, vy: (dy / d) * sp };
  }
  if (retreat) {
    // move AWAY from nearest alien
    if (target) {
      const dx = npc.x - target.x, dy = npc.y - target.y;
      const d = Math.hypot(dx, dy) || 1;
      npc.facing = Math.atan2(dy, dx);
      npc.walkPhase += dt * 9;
      return { vx: (dx / d) * npc.speed * 1.2, vy: (dy / d) * npc.speed * 1.2 };
    }
  }
  // no target seen — wander
  return null; // caller falls back to planWanderer
}
