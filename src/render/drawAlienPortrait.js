/**
 * drawAlienPortrait.js
 * Renders a detailed Gantz-style dossier portrait for a given alien spec.
 * Each body plan produces a distinctly different silhouette.
 */
import { makeRng } from '../engine/rng.js';
import { generateAlienSpec } from '../content/alienSpec.js';

// Polyfill ctx.roundRect for browsers that don't support it yet (Chrome <99, etc.)
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    const radius = Math.min(typeof r === 'number' ? r : r[0], w / 2, h / 2);
    this.moveTo(x + radius, y);
    this.lineTo(x + w - radius, y);
    this.arcTo(x + w, y, x + w, y + radius, radius);
    this.lineTo(x + w, y + h - radius);
    this.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    this.lineTo(x + radius, y + h);
    this.arcTo(x, y + h, x, y + h - radius, radius);
    this.lineTo(x, y + radius);
    this.arcTo(x, y, x + radius, y, radius);
    this.closePath();
    return this;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function oval(ctx, x, y, rx, ry, color, stroke) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
}

function pill(ctx, x, y, w, h, color) {
  const r = Math.min(w, h) * 0.45;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
  ctx.fillStyle = color; ctx.fill();
}

function line(ctx, x1, y1, x2, y2, color, lw = 1.5) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
}

function eyes(ctx, cx, cy, headR, count, accent) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * 0.9;
    const ex = cx + Math.sin(t) * headR * 0.6;
    const ey = cy + Math.cos(t) * headR * 0.15 - headR * 0.1;
    const er = Math.max(2.5, headR * 0.13);
    oval(ctx, ex, ey, er, er * 0.75, '#ffe050');
    oval(ctx, ex, ey, er * 0.5, er * 0.38, '#1a0000');
    // pupil slit
    ctx.beginPath();
    ctx.ellipse(ex, ey, er * 0.12, er * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000'; ctx.fill();
    // glow
    ctx.beginPath(); ctx.arc(ex, ey, er * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,220,0,0.10)`; ctx.fill();
  }
}

// ── Body plans ─────────────────────────────────────────────────────────────

function drawBiped(ctx, cx, cy, sc, spec, rng) {
  const p = spec.skin.primary, a = spec.skin.accent;
  const hasSpines = spec.limbs > 4;
  const hasTail   = rng.chance(0.5);
  const armSpread = 0.7 + rng.range(0, 0.3);

  // Tail
  if (hasTail) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sc * 0.35);
    ctx.quadraticCurveTo(cx + sc * 0.9, cy + sc * 0.7, cx + sc * 1.1, cy + sc * 1.5);
    ctx.strokeStyle = p; ctx.lineWidth = sc * 0.18; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx + sc * 1.1, cy + sc * 1.5, sc * 0.12, sc * 0.07, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = a; ctx.fill();
  }

  // Legs
  for (const s of [-1, 1]) {
    const lx = cx + s * sc * 0.28;
    const kneeX = lx + s * sc * 0.08;
    const kneeY = cy + sc * 0.75;
    const footX = lx - s * sc * 0.05;
    const footY = cy + sc * 1.55;
    // thigh
    ctx.beginPath(); ctx.moveTo(lx, cy + sc * 0.35);
    ctx.lineTo(kneeX, kneeY); ctx.strokeStyle = p; ctx.lineWidth = sc * 0.24; ctx.lineCap = 'round'; ctx.stroke();
    // shin
    ctx.beginPath(); ctx.moveTo(kneeX, kneeY);
    ctx.lineTo(footX, footY); ctx.lineWidth = sc * 0.18; ctx.stroke();
    // knee joint
    oval(ctx, kneeX, kneeY, sc * 0.13, sc * 0.13, a);
    // foot
    oval(ctx, footX + s * sc * 0.1, footY, sc * 0.22, sc * 0.10, a);
  }

  // Torso
  const tw = sc * 0.58, th = sc * 0.72;
  oval(ctx, cx, cy, tw / 2, th / 2, p, a);
  // chest ridges
  for (let i = 0; i < 4; i++) {
    const ry = cy - th * 0.28 + i * th * 0.17;
    ctx.beginPath();
    ctx.ellipse(cx, ry, tw * 0.38, sc * 0.04, 0, 0, Math.PI * 2);
    ctx.fillStyle = a + '55'; ctx.fill();
  }

  // Arms
  for (const s of [-1, 1]) {
    const ax = cx + s * (tw * 0.5 + sc * 0.08);
    const ay = cy - th * 0.15;
    const elbX = ax + s * sc * 0.22 * armSpread;
    const elbY = ay + sc * 0.45;
    const handX = elbX - s * sc * 0.05;
    const handY = elbY + sc * 0.45;
    // upper arm
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(elbX, elbY);
    ctx.strokeStyle = p; ctx.lineWidth = sc * 0.20; ctx.lineCap = 'round'; ctx.stroke();
    // forearm
    ctx.beginPath(); ctx.moveTo(elbX, elbY); ctx.lineTo(handX, handY);
    ctx.lineWidth = sc * 0.15; ctx.stroke();
    // elbow
    oval(ctx, elbX, elbY, sc * 0.12, sc * 0.12, a);
    // claws
    const clawN = spec.weapon === 'claws' ? 4 : 3;
    for (let c = 0; c < clawN; c++) {
      const ca = (c / (clawN - 1) - 0.5) * 0.9 + s * 0.15;
      line(ctx, handX, handY, handX + Math.sin(ca) * sc * 0.28, handY + Math.cos(ca) * sc * 0.28, a, 1.5);
    }
  }

  // Neck
  pill(ctx, cx, cy - th / 2 - sc * 0.1, sc * 0.22, sc * 0.22, p);

  // Head
  const hr = sc * 0.36;
  const hy = cy - th / 2 - sc * 0.1 - hr * 0.9;
  oval(ctx, cx, hy, hr, hr * 0.88, p, a);

  // Cranial spines / horns
  if (hasSpines) {
    for (let i = 0; i < 5; i++) {
      const sa = -Math.PI * 0.75 + (i / 4) * Math.PI * 0.5;
      line(ctx, cx + Math.cos(sa) * hr * 0.82, hy + Math.sin(sa) * hr * 0.82,
               cx + Math.cos(sa) * hr * 1.45,  hy + Math.sin(sa) * hr * 1.45, a, 2);
    }
  }

  // Weapon appendage
  if (spec.weapon === 'projectile') {
    const bx = cx + sc * 0.88, by = cy - sc * 0.1;
    ctx.beginPath(); ctx.roundRect(bx, by - sc * 0.07, sc * 0.42, sc * 0.14, 3);
    ctx.fillStyle = '#556070'; ctx.fill();
    line(ctx, bx + sc * 0.42, by, bx + sc * 0.65, by, '#99aacc', 2);
  }

  eyes(ctx, cx, hy, hr, spec.eyeCount, a);
}

function drawQuadruped(ctx, cx, cy, sc, spec, rng) {
  const p = spec.skin.primary, a = spec.skin.accent;
  const bodyW = sc * 0.9, bodyH = sc * 0.55;
  const bodyX = cx, bodyY = cy + sc * 0.1;

  // Tail
  ctx.beginPath();
  ctx.moveTo(bodyX + bodyW * 0.5, bodyY);
  ctx.quadraticCurveTo(bodyX + bodyW * 0.85, bodyY - sc * 0.6, bodyX + bodyW * 0.75, bodyY - sc * 1.1);
  ctx.strokeStyle = p; ctx.lineWidth = sc * 0.18; ctx.lineCap = 'round'; ctx.stroke();
  // tail tip
  oval(ctx, bodyX + bodyW * 0.75, bodyY - sc * 1.1, sc * 0.09, sc * 0.06, a);

  // Body
  oval(ctx, bodyX, bodyY, bodyW / 2, bodyH / 2, p, a);
  // dorsal ridge
  for (let i = 0; i < 6; i++) {
    const rx = bodyX - bodyW * 0.35 + i * bodyW * 0.14;
    ctx.beginPath();
    ctx.moveTo(rx, bodyY - bodyH * 0.5);
    ctx.lineTo(rx + sc * 0.04, bodyY - bodyH * 0.5 - sc * 0.12 - (i === 2 || i === 3 ? sc * 0.06 : 0));
    ctx.lineTo(rx + sc * 0.08, bodyY - bodyH * 0.5);
    ctx.fillStyle = a; ctx.fill();
  }

  // Legs (4)
  const legDefs = [
    { ox: -0.35, oy: 0.45, dir: -1 },
    {  ox: 0.35, oy: 0.45, dir:  1 },
    { ox: -0.35, oy:-0.35, dir: -1 },
    {  ox: 0.35, oy:-0.35, dir:  1 },
  ];
  for (const { ox, oy, dir } of legDefs) {
    const lx = bodyX + ox * bodyW;
    const ly = bodyY + bodyH * 0.45;
    const kneeX = lx + dir * sc * 0.12;
    const kneeY = ly + sc * 0.45;
    const footX = lx;
    const footY = ly + sc * 0.85;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(kneeX, kneeY);
    ctx.strokeStyle = p; ctx.lineWidth = sc * 0.19; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY);
    ctx.lineWidth = sc * 0.15; ctx.stroke();
    oval(ctx, kneeX, kneeY, sc * 0.1, sc * 0.1, a);
    oval(ctx, footX, footY, sc * 0.16, sc * 0.09, a);
  }

  // Neck
  const neckX = bodyX - bodyW * 0.42, neckY = bodyY - bodyH * 0.2;
  ctx.beginPath();
  ctx.moveTo(neckX, neckY);
  ctx.quadraticCurveTo(neckX - sc * 0.45, neckY - sc * 0.55, neckX - sc * 0.35, neckY - sc * 1.05);
  ctx.strokeStyle = p; ctx.lineWidth = sc * 0.26; ctx.stroke();

  // Head
  const hx = neckX - sc * 0.35, hy = neckY - sc * 1.1;
  const hr = sc * 0.33;
  oval(ctx, hx, hy, hr * 1.25, hr, p, a);
  // snout
  oval(ctx, hx - hr * 1.1, hy + hr * 0.15, hr * 0.55, hr * 0.35, p);
  // nostril
  oval(ctx, hx - hr * 1.4, hy + hr * 0.1, sc * 0.04, sc * 0.025, '#111');

  eyes(ctx, hx, hy - hr * 0.12, hr, spec.eyeCount, a);

  if (spec.weapon === 'ram') {
    // forward-facing horn
    ctx.beginPath();
    ctx.moveTo(hx - hr * 1.5, hy - hr * 0.1);
    ctx.lineTo(hx - hr * 2.4, hy - hr * 0.3);
    ctx.strokeStyle = a; ctx.lineWidth = sc * 0.12; ctx.lineCap = 'round'; ctx.stroke();
  }
}

function drawSerpent(ctx, cx, cy, sc, spec, rng) {
  const p = spec.skin.primary, a = spec.skin.accent;
  const segs = 9;

  // Generate S-curve control points
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const sx = cx + Math.sin(t * Math.PI * 1.8 + 0.3) * sc * 0.65;
    const sy = cy - sc * 1.3 + t * sc * 2.6;
    pts.push({ x: sx, y: sy });
  }

  // Draw body segments back to front
  for (let i = segs - 1; i >= 0; i--) {
    const { x, y } = pts[i];
    const r = (0.42 - i * 0.035) * sc;
    const bodyR = Math.max(sc * 0.08, r);
    oval(ctx, x, y, bodyR, bodyR * 0.72, p);
    // scale pattern
    if (i % 2 === 0) {
      ctx.beginPath();
      ctx.ellipse(x, y, bodyR * 0.7, bodyR * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = a + '40'; ctx.fill();
    }
  }

  // Connect segments with thick stroke
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mid = { x: (pts[i-1].x + pts[i].x)/2, y: (pts[i-1].y + pts[i].y)/2 };
    ctx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, mid.x, mid.y);
  }
  ctx.strokeStyle = p; ctx.lineWidth = sc * 0.36; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();

  // Re-draw segments on top
  for (let i = segs - 1; i >= 0; i--) {
    const { x, y } = pts[i];
    const bodyR = Math.max(sc * 0.08, (0.42 - i * 0.035) * sc);
    oval(ctx, x, y, bodyR, bodyR * 0.72, p, i === 0 ? a : null);
    if (i % 2 === 0 && i > 0) {
      ctx.beginPath();
      ctx.ellipse(x, y, bodyR * 0.65, bodyR * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = a + '44'; ctx.fill();
    }
  }

  // Frills on sides
  for (let i = 1; i < segs - 2; i += 2) {
    const { x, y } = pts[i];
    const fr = sc * (0.38 - i * 0.03);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + s * fr, y - fr * 0.3, x + s * fr * 0.6, y + fr * 0.5);
      ctx.fillStyle = a + '88'; ctx.fill();
    }
  }

  // Head (first segment, enlarged)
  const h = pts[0];
  const hr = sc * 0.38;
  oval(ctx, h.x, h.y, hr, hr * 0.72, p, a);
  // fangs
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(h.x + s * hr * 0.4, h.y + hr * 0.6);
    ctx.lineTo(h.x + s * hr * 0.25, h.y + hr * 1.1);
    ctx.strokeStyle = '#eee'; ctx.lineWidth = sc * 0.07; ctx.lineCap = 'round'; ctx.stroke();
  }
  eyes(ctx, h.x, h.y - hr * 0.1, hr, spec.eyeCount, a);
}

function drawFloater(ctx, cx, cy, sc, spec, rng) {
  const p = spec.skin.primary, a = spec.skin.accent;
  const bellR = sc * 0.55;
  const bellY = cy - sc * 0.3;

  // Bioluminescent glow rings
  for (let r = 3; r >= 1; r--) {
    ctx.beginPath(); ctx.arc(cx, bellY, bellR * (0.85 + r * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(80,220,160,${0.03 * r})`; ctx.fill();
  }

  // Tentacles (hanging down)
  const tentN = spec.limbs + 2;
  for (let i = 0; i < tentN; i++) {
    const ta = (i / tentN) * Math.PI + Math.PI * 0.05;
    const tx = cx + Math.cos(ta) * bellR * 0.7;
    const ty = bellY + bellR * 0.6;
    const endX = tx + (rng.next() - 0.5) * sc * 0.4;
    const endY = ty + sc * (1.0 + rng.next() * 0.7);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.bezierCurveTo(
      tx + (rng.next() - 0.5) * sc * 0.35, ty + (endY - ty) * 0.35,
      endX + (rng.next() - 0.5) * sc * 0.25, ty + (endY - ty) * 0.65,
      endX, endY,
    );
    ctx.strokeStyle = i % 2 === 0 ? p : a;
    ctx.lineWidth = Math.max(1, sc * 0.07 - i * 0.5);
    ctx.lineCap = 'round'; ctx.stroke();
    // tip bulb
    oval(ctx, endX, endY, sc * 0.05, sc * 0.05, a);
  }

  // Bell body
  ctx.beginPath();
  ctx.ellipse(cx, bellY, bellR, bellR * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = p; ctx.fill();
  ctx.strokeStyle = a; ctx.lineWidth = 1.5; ctx.stroke();

  // Internal organs (visible through translucent bell)
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 4; i++) {
    const ox = cx + (rng.next() - 0.5) * bellR * 0.7;
    const oy = bellY + (rng.next() - 0.5) * bellR * 0.5;
    oval(ctx, ox, oy, sc * 0.07, sc * 0.05, a + 'aa');
  }
  ctx.restore();

  // Mantle pattern (concentric rings)
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, bellY, bellR * (0.25 * i), bellR * 0.72 * (0.25 * i), 0, 0, Math.PI * 2);
    ctx.strokeStyle = a + '44'; ctx.lineWidth = 0.8; ctx.stroke();
  }

  // Bell rim fringe
  for (let i = 0; i < 14; i++) {
    const fa = Math.PI + (i / 13) * Math.PI;
    const fx = cx + Math.cos(fa) * bellR * 0.92;
    const fy = bellY + Math.sin(fa) * bellR * 0.65;
    oval(ctx, fx, fy, sc * 0.04, sc * 0.06, a);
  }

  // Eyes cluster (top of bell)
  eyes(ctx, cx, bellY - bellR * 0.3, bellR, spec.eyeCount, a);
}

function drawInsectoid(ctx, cx, cy, sc, spec, rng) {
  const p = spec.skin.primary, a = spec.skin.accent;
  const legPairs = Math.floor(spec.limbs / 2);

  // Abdomen (back, segmented)
  const abdX = cx + sc * 0.45, abdY = cy + sc * 0.2;
  const abdSegs = 5;
  for (let i = 0; i < abdSegs; i++) {
    const t = i / (abdSegs - 1);
    const sr = sc * (0.35 - t * 0.18);
    const sx = abdX + i * sc * 0.28;
    oval(ctx, sx, abdY + t * sc * 0.12, sr, sr * 0.62, p, i === 0 ? a : null);
    // stripe
    ctx.beginPath();
    ctx.ellipse(sx, abdY + t * sc * 0.12, sr * 0.7, sr * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = a + '55'; ctx.fill();
  }
  // Stinger
  ctx.beginPath();
  ctx.moveTo(abdX + (abdSegs - 1) * sc * 0.28, abdY + sc * 0.2);
  ctx.lineTo(abdX + abdSegs * sc * 0.28 + sc * 0.2, abdY + sc * 0.1);
  ctx.strokeStyle = a; ctx.lineWidth = sc * 0.1; ctx.lineCap = 'round'; ctx.stroke();

  // Thorax
  const thx = cx - sc * 0.1, thy = cy;
  oval(ctx, thx, thy, sc * 0.38, sc * 0.3, p, a);

  // Legs (pairs)
  const lPairs = Math.min(legPairs, 4);
  for (let i = 0; i < lPairs; i++) {
    const ly = thy - sc * 0.1 + i * sc * 0.22;
    for (const s of [-1, 1]) {
      const lx = thx + s * sc * 0.35;
      const midX = lx + s * sc * (0.45 + i * 0.05);
      const midY = ly - sc * 0.15;
      const tipX = lx + s * sc * (0.75 + i * 0.08);
      const tipY = ly + sc * (0.35 + i * 0.05);
      // femur
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(midX, midY);
      ctx.strokeStyle = p; ctx.lineWidth = sc * 0.12; ctx.lineCap = 'round'; ctx.stroke();
      // tibia
      ctx.beginPath(); ctx.moveTo(midX, midY); ctx.lineTo(tipX, tipY);
      ctx.lineWidth = sc * 0.09; ctx.stroke();
      // joint
      oval(ctx, midX, midY, sc * 0.075, sc * 0.075, a);
      // claw tips
      line(ctx, tipX, tipY, tipX + s * sc * 0.12, tipY + sc * 0.08, a, 1.5);
      line(ctx, tipX, tipY, tipX + s * sc * 0.06, tipY + sc * 0.13, a, 1.5);
    }
  }

  // Head
  const hx = thx - sc * 0.48, hy = thy - sc * 0.15;
  const hr = sc * 0.3;
  oval(ctx, hx, hy, hr, hr * 0.82, p, a);

  // Mandibles
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx - hr * 0.8, hy + s * hr * 0.22);
    ctx.quadraticCurveTo(hx - hr * 1.35, hy + s * hr * 0.55, hx - hr * 1.1, hy + s * hr * 0.9);
    ctx.strokeStyle = a; ctx.lineWidth = sc * 0.12; ctx.lineCap = 'round'; ctx.stroke();
    oval(ctx, hx - hr * 1.1, hy + s * hr * 0.9, sc * 0.055, sc * 0.055, a);
  }

  // Antennae
  for (const s of [-1, 1]) {
    const ax = hx + s * hr * 0.45, ay = hy - hr * 0.85;
    ctx.beginPath(); ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax + s * sc * 0.3, ay - sc * 0.5, ax + s * sc * 0.2, ay - sc * 0.85);
    ctx.strokeStyle = p; ctx.lineWidth = sc * 0.07; ctx.lineCap = 'round'; ctx.stroke();
    oval(ctx, ax + s * sc * 0.2, ay - sc * 0.85, sc * 0.06, sc * 0.06, a);
  }

  eyes(ctx, hx, hy - hr * 0.05, hr, spec.eyeCount, a);

  // Wing stubs (decorative)
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(thx + s * sc * 0.28, thy - sc * 0.28);
    ctx.quadraticCurveTo(thx + s * sc * 0.75, thy - sc * 0.72, thx + s * sc * 0.5, thy - sc * 0.1);
    ctx.fillStyle = a + '30'; ctx.fill();
    ctx.strokeStyle = a + '88'; ctx.lineWidth = 0.8; ctx.stroke();
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export function drawAlienPortrait(canvas, archetype, specSeed) {
  const spec = generateAlienSpec(specSeed >>> 0, archetype);
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const rng = makeRng((spec.seed ^ 0xf00d) >>> 0);

  // ── Background ──────────────────────────────────
  ctx.fillStyle = '#060810';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid (database aesthetic)
  ctx.strokeStyle = 'rgba(30,50,90,0.25)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= W; x += 18) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 18) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Film grain
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(255,255,255,${(rng.next() * 0.09).toFixed(3)})`;
    ctx.fillRect(rng.next() * W, rng.next() * H, 1, 1);
  }

  // Vignette
  const vig = ctx.createRadialGradient(W/2, H/2, H * 0.1, W/2, H/2, H * 0.85);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

  // Creature glow
  const glow = ctx.createRadialGradient(W/2, H * 0.46, 0, W/2, H * 0.46, W * 0.55);
  glow.addColorStop(0, 'rgba(40,160,100,0.07)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // ── Ground shadow ────────────────────────────────
  const cx = W / 2, cy = H * 0.47;
  const sc = Math.min(W, H) * 0.17 * Math.min(spec.size, 1.65);
  ctx.beginPath(); ctx.ellipse(cx, cy + sc * 1.85, sc * 0.95, sc * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();

  // ── Draw creature ────────────────────────────────
  ctx.save();
  switch (spec.body) {
    case 'biped':     drawBiped    (ctx, cx, cy, sc, spec, rng); break;
    case 'quadruped': drawQuadruped(ctx, cx, cy, sc, spec, rng); break;
    case 'serpent':   drawSerpent  (ctx, cx, cy, sc, spec, rng); break;
    case 'floater':   drawFloater  (ctx, cx, cy, sc, spec, rng); break;
    case 'insectoid': drawInsectoid(ctx, cx, cy, sc, spec, rng); break;
    default:          drawBiped    (ctx, cx, cy, sc, spec, rng);
  }
  ctx.restore();

  // ── Photo overlay ────────────────────────────────
  // Scan lines
  for (let y = 0; y < H; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(0, y, W, 1);
  }
  // Chromatic fringe
  ctx.fillStyle = 'rgba(200,10,10,0.05)'; ctx.fillRect(0, 0, 2, H);
  ctx.fillStyle = 'rgba(10,10,200,0.05)'; ctx.fillRect(W-2, 0, 2, H);

  // ── Gantz UI overlay ─────────────────────────────
  const M = 7, BL = 14;
  ctx.strokeStyle = '#c8142b'; ctx.lineWidth = 1.5;
  for (const [x, y, dx, dy] of [[M,M,1,1],[W-M,M,-1,1],[M,H-M,1,-1],[W-M,H-M,-1,-1]]) {
    ctx.beginPath(); ctx.moveTo(x, y+dy*BL); ctx.lineTo(x, y); ctx.lineTo(x+dx*BL, y); ctx.stroke();
  }

  // Targeting reticle
  ctx.strokeStyle = 'rgba(200,20,43,0.35)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(W/2-5, cy); ctx.lineTo(W/2+5, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W/2, cy-5); ctx.lineTo(W/2, cy+5); ctx.stroke();

  // Header tag
  ctx.font = 'bold 6px monospace';
  ctx.fillStyle = 'rgba(200,20,43,0.85)';
  ctx.fillText('GANTZ SCAN', M + BL + 2, M + 5);

  // Body-plan label bottom-left
  ctx.font = '6px monospace';
  ctx.fillStyle = 'rgba(130,155,185,0.65)';
  ctx.fillText(`${spec.body.toUpperCase()}`, M + 2, H - M - 3);

  // Threat bar (bottom-right)
  const THREAT = { patroller: 0.38, brute: 0.82, swarmer: 0.22, boss: 1.0 };
  const frac = THREAT[archetype] ?? 0.5;
  const bw = 30;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(W - M - bw - 1, H - M - 7, bw + 2, 6);
  ctx.fillStyle = frac > 0.7 ? '#ff3040' : frac > 0.4 ? '#ffaa20' : '#20cc60';
  ctx.fillRect(W - M - bw, H - M - 6, bw * frac, 4);
  ctx.strokeStyle = 'rgba(200,200,200,0.28)'; ctx.lineWidth = 0.5;
  ctx.strokeRect(W - M - bw, H - M - 6, bw, 4);
}
