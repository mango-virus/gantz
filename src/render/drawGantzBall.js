export function drawGantzBall(r, x, y, t = 0) {
  const R = 1.2;
  r.drawCircle(x, y + 0.2, R * 1.2, { fill: 'rgba(0,0,0,0.75)' });
  r.drawCircle(x, y, R, { fill: '#030306' });
  r.drawCircle(x, y, R, { stroke: '#12121e', lineWidth: 0.04 });

  // drifting internal highlight
  const hx = x + Math.cos(t * 0.6) * R * 0.35;
  const hy = y + Math.sin(t * 0.6) * R * 0.35;
  r.drawCircle(hx, hy, R * 0.28, { fill: '#14141f', alpha: 0.65 });

  // rim piping
  r.drawCircle(x, y, R * 1.03, { stroke: '#3a0a1a', lineWidth: 0.03, alpha: 0.8 });
  r.drawCircle(x, y, R * 1.07, { stroke: '#c8142b', lineWidth: 0.015, alpha: 0.25 });

  // faint scan line
  const scan = (Math.sin(t * 2.2) * 0.5 + 0.5) * 0.6 - 0.3;
  r.drawLine(x - R * 0.9, y + scan, x + R * 0.9, y + scan, {
    stroke: '#c8142b', lineWidth: 0.01, alpha: 0.35,
  });
}
