export const MISSION_BOUNDS = { minX: -20, maxX: 20, minY: -20, maxY: 20 };

export function buildMissionWalls() {
  const B = MISSION_BOUNDS;
  const t = 1;
  const cx = (B.minX + B.maxX) / 2;
  const cy = (B.minY + B.maxY) / 2;
  const W = B.maxX - B.minX + 2 * t;
  const H = B.maxY - B.minY;
  return [
    { kind: 'aabb', x: cx,             y: B.minY - t / 2, w: W, h: t, tier: 'hard' },
    { kind: 'aabb', x: cx,             y: B.maxY + t / 2, w: W, h: t, tier: 'hard' },
    { kind: 'aabb', x: B.minX - t / 2, y: cy,             w: t, h: H, tier: 'hard' },
    { kind: 'aabb', x: B.maxX + t / 2, y: cy,             w: t, h: H, tier: 'hard' },
  ];
}

export function missionSpawn(spawnPoint, index) {
  const i = index || 0;
  const row = Math.floor(i / 4);
  const col = i % 4;
  return {
    x: spawnPoint.x + (col - 1.5) * 0.9,
    y: spawnPoint.y + row * 1.1,
    facing: spawnPoint.facing,
  };
}

export function drawMissionGround(r, time) {
  const B = MISSION_BOUNDS;
  const W = B.maxX - B.minX, H = B.maxY - B.minY;

  // pavement
  r.drawRect(B.minX, B.minY, W, H, { fill: '#14141c' });

  // central road bed darker
  r.drawRect(-4, B.minY, 8, H, { fill: '#0e0e16' });

  // lane markings (center dashed)
  for (let y = B.minY + 1; y < B.maxY; y += 1.6) {
    r.drawRect(-0.06, y, 0.12, 0.8, { fill: '#f8e6a0', alpha: 0.45 });
  }

  // sidewalk edge lines
  r.drawLine(-4, B.minY, -4, B.maxY, { stroke: '#2a2a34', lineWidth: 0.05, alpha: 0.7 });
  r.drawLine( 4, B.minY,  4, B.maxY, { stroke: '#2a2a34', lineWidth: 0.05, alpha: 0.7 });

  // sparse stone grid on sidewalks
  for (let x = B.minX; x <= B.maxX; x += 1.2) {
    r.drawLine(x, B.minY, x, B.maxY, { stroke: '#1c1c24', lineWidth: 0.015, alpha: 0.5 });
  }

  // containment field edges (pulsing red)
  const pulse = 0.35 + 0.15 * Math.sin(time * 2);
  r.drawLine(B.minX, B.minY, B.maxX, B.minY, { stroke: '#c8142b', lineWidth: 0.05, alpha: pulse });
  r.drawLine(B.minX, B.maxY, B.maxX, B.maxY, { stroke: '#c8142b', lineWidth: 0.05, alpha: pulse });
  r.drawLine(B.minX, B.minY, B.minX, B.maxY, { stroke: '#c8142b', lineWidth: 0.05, alpha: pulse });
  r.drawLine(B.maxX, B.minY, B.maxX, B.maxY, { stroke: '#c8142b', lineWidth: 0.05, alpha: pulse });
}
