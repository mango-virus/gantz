export function makeWorld() {
  return {
    phase: 'LOBBY',
    seed: 0,
    rng: null,
    time: 0,
    entities: new Map(),
    localPlayerId: null,
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

export function makePlayer(id, x, y) {
  return {
    id,
    kind: 'player',
    x, y,
    radius: 0.35,
    speed: 5,
    facing: 0,
    hp: 100,
    alive: true,
    username: 'hunter',
  };
}
