export const Phase = {
  LOBBY:    'LOBBY',
  BRIEFING: 'BRIEFING',
  MISSION:  'MISSION',
  DEBRIEF:  'DEBRIEF',
};

const VALID = new Set(Object.values(Phase));

export function makePhaseMachine(initial = Phase.LOBBY) {
  let current = initial;
  const listeners = new Set();
  return {
    get() { return current; },
    set(next) {
      if (!VALID.has(next)) throw new Error(`bad phase: ${next}`);
      if (next === current) return;
      const prev = current;
      current = next;
      for (const l of listeners) l(current, prev);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
