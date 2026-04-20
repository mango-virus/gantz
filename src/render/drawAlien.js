export function drawAlien(r, spec, pose) {
  const { x, y, facing = 0, marked = false, markFlash = 0, alive = true } = pose;
  const { body, size, skin, limbs, eyeCount } = spec;
  const sc = size;
  const c = Math.cos(facing), s = Math.sin(facing);
  const rot = (lx, ly) => ({ x: x + lx * c - ly * s, y: y + lx * s + ly * c });

  // shadow
  r.drawEllipse(x, y + 0.12 * sc, 0.55 * sc, 0.38 * sc, facing, { fill: 'rgba(0,0,0,0.5)' });

  if (body === 'serpent') {
    for (let i = 5; i >= 0; i--) {
      const p = rot(-i * 0.28 * sc, Math.sin(i * 0.8) * 0.1 * sc);
      const r0 = (0.38 - i * 0.05) * sc;
      r.drawCircle(p.x, p.y, r0, { fill: skin.primary });
      r.drawCircle(p.x, p.y, r0 * 0.7, { fill: skin.accent, alpha: 0.35 });
    }
  } else if (body === 'floater') {
    const baseR = 0.45 * sc;
    r.drawCircle(x, y, baseR, { fill: skin.primary });
    r.drawCircle(x, y, baseR, { stroke: skin.accent, lineWidth: 0.05 });
    for (let i = 0; i < limbs; i++) {
      const a = (i / limbs) * Math.PI * 2;
      const tip = { x: x + Math.cos(a) * baseR * 1.6, y: y + Math.sin(a) * baseR * 1.6 };
      r.drawLine(x, y, tip.x, tip.y, { stroke: skin.accent, lineWidth: 0.07 });
      r.drawCircle(tip.x, tip.y, 0.06 * sc, { fill: skin.accent });
    }
  } else {
    // body
    r.drawEllipse(x, y, 0.5 * sc, 0.36 * sc, facing, { fill: skin.primary });
    r.drawEllipse(x, y, 0.5 * sc, 0.36 * sc, facing, { stroke: '#05050a', lineWidth: 0.04 });
    // dorsal stripe accent
    const ds0 = rot(-0.3 * sc, 0);
    const ds1 = rot( 0.3 * sc, 0);
    r.drawLine(ds0.x, ds0.y, ds1.x, ds1.y, { stroke: skin.accent, lineWidth: 0.06 });
    // limbs
    for (let i = 0; i < limbs; i++) {
      const a = (i / limbs) * Math.PI * 2;
      const p = rot(Math.cos(a) * 0.52 * sc, Math.sin(a) * 0.38 * sc);
      r.drawCircle(p.x, p.y, 0.09 * sc, { fill: skin.primary });
      r.drawCircle(p.x, p.y, 0.09 * sc, { stroke: '#05050a', lineWidth: 0.02 });
    }
  }

  // eyes forward
  for (let i = 0; i < eyeCount; i++) {
    const ang = ((i / Math.max(1, eyeCount - 1)) - 0.5) * 0.8;
    const p = rot(0.38 * sc, Math.sin(ang) * 0.12 * sc);
    r.drawCircle(p.x, p.y, 0.045 * sc, { fill: '#ffde55' });
    r.drawCircle(p.x, p.y, 0.022 * sc, { fill: '#1a0000' });
  }

  if (marked) {
    // Pulsing red Xs orbiting the alien (Gantz X-gun mark)
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(markFlash * 8));
    const ringR = 0.55 * sc;
    for (let i = 0; i < 5; i++) {
      const a = markFlash * 3 + (i / 5) * Math.PI * 2;
      const px = x + Math.cos(a) * ringR;
      const py = y + Math.sin(a) * ringR;
      const sz = 0.11 * sc;
      r.drawLine(px - sz, py - sz, px + sz, py + sz, { stroke: '#ff2030', lineWidth: 0.04, alpha: pulse });
      r.drawLine(px - sz, py + sz, px + sz, py - sz, { stroke: '#ff2030', lineWidth: 0.04, alpha: pulse });
    }
    r.drawCircle(x, y, ringR * 1.15, { stroke: '#ff2030', lineWidth: 0.03, alpha: pulse * 0.6 });
  }

  if (!alive) {
    r.drawEllipse(x, y + 0.08 * sc, 0.6 * sc, 0.4 * sc, facing, { fill: '#2a0a10', alpha: 0.7 });
  }
}
