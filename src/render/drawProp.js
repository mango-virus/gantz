export function drawProp(r, spec, x, y) {
  const rot = spec.rotation || 0;
  switch (spec.type) {
    case 'pillar': return drawPillar(r, x, y, spec);
    case 'crate': return drawCrate(r, x, y, spec, rot);
    case 'bench': return drawBench(r, x, y, spec, rot);
    case 'lamp': return drawLamp(r, x, y, spec);
    case 'panel_light': return drawPanelLight(r, x, y, spec, rot);
    case 'console': return drawConsole(r, x, y, spec, rot);
    case 'vending': return drawVending(r, x, y, spec, rot);
    case 'sign': return drawSign(r, x, y, spec, rot);
    case 'trash': return drawTrash(r, x, y, spec);
    case 'bollard': return drawBollard(r, x, y, spec);
    default:
      r.drawRect(x - 0.3, y - 0.3, 0.6, 0.6, { fill: '#4a4a55' });
  }
}

function drawPillar(r, x, y, spec) {
  const R = 0.35 * spec.scale;
  r.drawCircle(x, y + 0.05, R * 1.08, { fill: 'rgba(0,0,0,0.45)' });
  r.drawCircle(x, y, R, { fill: '#181c30' });
  r.drawCircle(x, y, R, { stroke: '#080a14', lineWidth: 0.035 });
  r.drawCircle(x, y, R * 0.7, { stroke: '#2a3058', lineWidth: 0.02, alpha: 0.7 });
  r.drawCircle(x, y, R * 0.25, { fill: '#c8142b', alpha: 0.35 });
}

function rotPoly(x, y, rot, w, h) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = w * 0.5, hh = h * 0.5;
  return [
    [x + -hw * c - -hh * s, y + -hw * s + -hh * c],
    [x +  hw * c - -hh * s, y +  hw * s + -hh * c],
    [x +  hw * c -  hh * s, y +  hw * s +  hh * c],
    [x + -hw * c -  hh * s, y + -hw * s +  hh * c],
  ];
}

function drawCrate(r, x, y, spec, rot) {
  const size = 0.8 * spec.scale;
  r.drawCircle(x, y + 0.05, size * 0.58, { fill: 'rgba(0,0,0,0.35)' });
  const pts = rotPoly(x, y, rot, size, size);
  r.drawPolygon(pts, { fill: '#3a2818' });
  r.drawPolygon(pts, { stroke: '#140a05', lineWidth: 0.035 });
  // x-brace
  r.drawLine(pts[0][0], pts[0][1], pts[2][0], pts[2][1], { stroke: '#1a0f08', lineWidth: 0.02 });
  r.drawLine(pts[1][0], pts[1][1], pts[3][0], pts[3][1], { stroke: '#1a0f08', lineWidth: 0.02 });
}

function drawBench(r, x, y, spec, rot) {
  const w = 1.6 * spec.scale, h = 0.45;
  const pts = rotPoly(x, y, rot, w, h);
  r.drawEllipse(x, y + 0.06, w * 0.55, h * 0.75, rot, { fill: 'rgba(0,0,0,0.35)' });
  r.drawPolygon(pts, { fill: '#2a2418' });
  r.drawPolygon(pts, { stroke: '#120a04', lineWidth: 0.03 });
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = -1; i <= 1; i++) {
    const ax = x + (i * 0.3) * c - (-h * 0.5) * s;
    const ay = y + (i * 0.3) * s + (-h * 0.5) * c;
    const bx = x + (i * 0.3) * c - ( h * 0.5) * s;
    const by = y + (i * 0.3) * s + ( h * 0.5) * c;
    r.drawLine(ax, ay, bx, by, { stroke: '#120a04', lineWidth: 0.02 });
  }
}

function drawLamp(r, x, y, spec) {
  r.drawCircle(x, y, 1.1, { fill: '#e8c070', alpha: 0.05 });
  r.drawCircle(x, y, 0.7, { fill: '#e8c070', alpha: 0.08 });
  r.drawCircle(x, y + 0.04, 0.28, { fill: 'rgba(0,0,0,0.5)' });
  r.drawCircle(x, y, 0.24, { fill: '#252840' });
  r.drawCircle(x, y, 0.16, { fill: '#e8c070', alpha: 0.9 });
}

function drawPanelLight(r, x, y, spec, rot) {
  const w = 2.0, h = 0.14;
  const pts = rotPoly(x, y, rot, w, h);
  r.drawPolygon(pts, { fill: '#c8142b', alpha: 0.55 });
  r.drawPolygon(pts, { stroke: '#ff3040', lineWidth: 0.02, alpha: 0.9 });
}

function drawVending(r, x, y, spec, rot) {
  const w = 1.05 * spec.scale, h = 0.58 * spec.scale;
  const pts = rotPoly(x, y, rot, w, h);
  r.drawEllipse(x, y + 0.06, w * 0.55, h * 0.65, rot, { fill: 'rgba(0,0,0,0.35)' });
  r.drawPolygon(pts, { fill: '#1a2a45' });
  r.drawPolygon(pts, { stroke: '#050815', lineWidth: 0.035 });
  // glowing front panel
  const c = Math.cos(rot), s = Math.sin(rot);
  const panelC = { x: x + 0 * c - (-h * 0.12) * s, y: y + 0 * s + (-h * 0.12) * c };
  const panel = rotPoly(panelC.x, panelC.y, rot, w * 0.82, h * 0.55);
  r.drawPolygon(panel, { fill: '#e8c070', alpha: 0.55 });
  // slot dividers
  for (let i = -1; i <= 1; i++) {
    const dx = (i * 0.3) * c - (-h * 0.12) * s;
    const dy = (i * 0.3) * s + (-h * 0.12) * c;
    r.drawCircle(x + dx, y + dy, 0.04, { fill: '#c8142b', alpha: 0.8 });
  }
}

function drawSign(r, x, y, spec, rot) {
  r.drawCircle(x, y, 0.08, { fill: '#2a2a32' });
  const c = Math.cos(rot), s = Math.sin(rot);
  const cx = x + c * 0.22;
  const cy = y + s * 0.22;
  const pts = rotPoly(cx, cy, rot, 0.45, 0.18);
  r.drawPolygon(pts, { fill: '#c8142b' });
  r.drawPolygon(pts, { stroke: '#fff', lineWidth: 0.015 });
  r.drawCircle(cx, cy, 0.04, { fill: '#fff', alpha: 0.85 });
}

function drawTrash(r, x, y, spec) {
  const s = spec.scale || 1;
  r.drawCircle(x, y + 0.05, 0.42 * s, { fill: 'rgba(0,0,0,0.4)' });
  const c = Math.cos(spec.rotation), sn = Math.sin(spec.rotation);
  const rot = (lx, ly) => ({ x: x + lx * c - ly * sn, y: y + lx * sn + ly * c });
  const blobs = [
    [ 0.00,  0.00, 0.28 * s, '#1a1a1a'],
    [ 0.18,  0.10, 0.18 * s, '#252525'],
    [-0.14, -0.10, 0.20 * s, '#1e1e1e'],
    [ 0.05,  0.18, 0.14 * s, '#2a2a2a'],
  ];
  for (const [dx, dy, br, fill] of blobs) {
    const p = rot(dx, dy);
    r.drawCircle(p.x, p.y, br, { fill });
  }
  const h = rot(-0.05, -0.05);
  r.drawCircle(h.x, h.y, 0.05 * s, { fill: '#3a3a3a', alpha: 0.8 });
}

function drawBollard(r, x, y, spec) {
  const R = 0.20 * (spec.scale || 1);
  r.drawCircle(x, y + 0.03, R * 1.1, { fill: 'rgba(0,0,0,0.4)' });
  r.drawCircle(x, y, R, { fill: '#c8142b' });
  r.drawCircle(x, y, R, { stroke: '#400810', lineWidth: 0.02 });
  r.drawCircle(x, y, R * 0.6, { stroke: '#fff', lineWidth: 0.018, alpha: 0.75 });
}

function drawConsole(r, x, y, spec, rot) {
  const w = 1.2 * spec.scale, h = 0.7 * spec.scale;
  const pts = rotPoly(x, y, rot, w, h);
  r.drawEllipse(x, y + 0.06, w * 0.55, h * 0.6, rot, { fill: 'rgba(0,0,0,0.35)' });
  r.drawPolygon(pts, { fill: '#1c2238' });
  r.drawPolygon(pts, { stroke: '#070a14', lineWidth: 0.035 });
  // screen glow
  const c = Math.cos(rot), s = Math.sin(rot);
  const sx = x + 0 * c - (-h * 0.15) * s;
  const sy = y + 0 * s + (-h * 0.15) * c;
  const screen = rotPoly(sx, sy, rot, w * 0.65, h * 0.35);
  r.drawPolygon(screen, { fill: '#1ea5c8', alpha: 0.55 });
  r.drawPolygon(screen, { stroke: '#3ac4e8', lineWidth: 0.015 });
}
