import * as THREE from 'https://esm.sh/three@0.160.0';
import { mulberry32 } from '../engine/rng.js';

function color(hex) { return new THREE.Color(hex); }

const MAT_CACHE = new Map();
function cachedStandard(args) {
  const key = JSON.stringify(args);
  let m = MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial(args);
    MAT_CACHE.set(key, m);
  }
  return m;
}

// ---- Procedural texture helpers ----
function _mkRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function _makeLobbyFloorTex() {
  const rng = _mkRng(0x4a9f12);
  const PX = 512, PZ = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = PX; canvas.height = PZ;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2a1408';
  ctx.fillRect(0, 0, PX, PZ);

  const COLS = [
    [168, 118, 56], [182, 132, 68], [158, 108, 48], [175, 124, 62],
  ];
  const plankCount = 25;
  const plankPx = PX / plankCount;
  const segsPerH = 16 / 1.2;
  const segPx = PZ / segsPerH;

  for (let i = 0; i < plankCount; i++) {
    const x0 = Math.floor(i * plankPx) + 1;
    const pw = Math.floor(plankPx) - 2;
    const c = COLS[i % 4];

    for (let s = 0; s <= Math.ceil(segsPerH); s++) {
      const y0 = Math.floor(s * segPx) + 1;
      const ph = Math.min(Math.floor(segPx) - 2, PZ - y0 - 1);
      if (ph <= 0) continue;

      const vary = (rng() - 0.5) * 22;
      const r = Math.min(255, Math.max(0, c[0] + vary)) | 0;
      const g = Math.min(255, Math.max(0, c[1] + vary)) | 0;
      const b = Math.min(255, Math.max(0, c[2] + vary)) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x0, y0, pw, ph);

      // Grain lines running along plank length
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, pw, ph); ctx.clip();
      const numGrain = (6 + rng() * 12) | 0;
      for (let gi = 0; gi < numGrain; gi++) {
        const gy = y0 + rng() * ph;
        const alpha = (0.04 + rng() * 0.10).toFixed(3);
        ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
        ctx.lineWidth = 0.4 + rng() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x0, gy + (rng() - 0.5) * 3);
        ctx.quadraticCurveTo(x0 + pw * 0.5, gy + (rng() - 0.5) * 6, x0 + pw, gy + (rng() - 0.5) * 3);
        ctx.stroke();
      }
      // Occasional knot
      if (rng() < 0.07) {
        const ky = y0 + ph * 0.25 + rng() * ph * 0.5;
        const kg = ctx.createRadialGradient(x0 + pw / 2, ky, 0, x0 + pw / 2, ky, pw * 0.5);
        kg.addColorStop(0, 'rgba(0,0,0,0.24)');
        kg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = kg;
        ctx.fillRect(x0, ky - pw * 0.5, pw, pw);
      }
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function _makePlasterTex() {
  const rng = _mkRng(0x2b7c44);
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);

  const id = ctx.getImageData(0, 0, S, S);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (rng() - 0.5) * 26;
    const w = Math.min(255, Math.max(192, 240 + v)) | 0;
    d[i] = d[i + 1] = d[i + 2] = w;
    d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);

  // Subtle brushstroke streaks
  for (let s = 0; s < 55; s++) {
    const alpha = (0.015 + rng() * 0.028).toFixed(3);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1 + rng() * 4;
    ctx.beginPath();
    const x0 = rng() * S, y0 = rng() * S;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (rng() - 0.5) * 55, y0 + (rng() - 0.5) * 30);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Bedroom: short-pile carpet — muted slate-blue with woven grid ────────────
function _makeCaretTex() {
  const rng = _mkRng(0xc3d7e1);
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  // Base fill
  ctx.fillStyle = '#5a6272';
  ctx.fillRect(0, 0, S, S);
  // Pixel-level fibre noise
  const id = ctx.getImageData(0, 0, S, S);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (rng() - 0.5) * 36;
    d[i]     = Math.min(255, Math.max(0, 88  + v)) | 0;
    d[i + 1] = Math.min(255, Math.max(0, 96  + v)) | 0;
    d[i + 2] = Math.min(255, Math.max(0, 114 + v)) | 0;
    d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  // Woven loop-pile grid
  for (let row = 0; row < S; row += 4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.09)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, row); ctx.lineTo(S, row); ctx.stroke();
  }
  for (let col = 0; col < S; col += 4) {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(col, 0); ctx.lineTo(col, S); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Bathroom: small ceramic square tiles with grey grout lines ────────────────
function _makeTileTex() {
  const rng  = _mkRng(0x8f3c1a);
  const S    = 512;
  const TILE = 40;   // px per tile
  const GROUT = 4;   // px grout width
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  // Grout background
  ctx.fillStyle = '#a0a0a0';
  ctx.fillRect(0, 0, S, S);
  // Tile faces
  for (let ty = 0; ty < S; ty += TILE) {
    for (let tx = 0; tx < S; tx += TILE) {
      const x = tx + GROUT, y = ty + GROUT;
      const w = TILE - GROUT * 2, h = TILE - GROUT * 2;
      const v = (rng() - 0.5) * 14;
      const c = Math.min(255, Math.max(210, 240 + v)) | 0;
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.fillRect(x, y, w, h);
      // Glazed sheen highlight
      const gl = ctx.createLinearGradient(x, y, x + w, y + h);
      gl.addColorStop(0,   'rgba(255,255,255,0.18)');
      gl.addColorStop(0.4, 'rgba(255,255,255,0.04)');
      gl.addColorStop(1,   'rgba(0,0,0,0.07)');
      ctx.fillStyle = gl;
      ctx.fillRect(x, y, w, h);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Kitchen: black-and-cream checkerboard vinyl ───────────────────────────────
function _makeCheckerTex() {
  const rng  = _mkRng(0x2f9e4b);
  const S    = 512;
  const TILE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  for (let ty = 0; ty < S; ty += TILE) {
    for (let tx = 0; tx < S; tx += TILE) {
      const light = ((tx / TILE + ty / TILE) % 2) === 0;
      const v = (rng() - 0.5) * 10;
      if (light) {
        const c = Math.min(255, Math.max(205, 232 + v)) | 0;
        ctx.fillStyle = `rgb(${c},${c - 2},${c - 6})`;
      } else {
        const c = Math.min(55, Math.max(0, 20 + v)) | 0;
        ctx.fillStyle = `rgb(${c},${c},${c + 2})`;
      }
      ctx.fillRect(tx, ty, TILE, TILE);
      // Subtle wear scuff
      if (rng() < 0.18) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(tx + rng() * (TILE - 8), ty + rng() * (TILE - 4), 6 + rng() * 20, 2 + rng() * 5);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Hallway: herringbone parquet — warm amber, different tone from lobby ───────
function _makeParquetTex() {
  const rng = _mkRng(0x77a340);
  const S   = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#120800';
  ctx.fillRect(0, 0, S, S);
  const PW = 16, PL = 56; // plank width / length in px
  const COLS = [[196, 128, 48], [212, 144, 60], [184, 116, 42], [206, 138, 54]];
  // Draw pairs of perpendicular planks in herringbone arrangement
  for (let row = -1; row < S / PW + 2; row++) {
    for (let col = -1; col < S / PL + 2; col++) {
      const ox = col * PL, oy = row * PW * 2;
      const ci = ((row + col * 3) & 3);
      const c  = COLS[ci];
      const drawPlank = (x, y, w, h, vi) => {
        const vv = (rng() - 0.5) * 20;
        const r = Math.min(255, Math.max(0, c[0] + vv + vi)) | 0;
        const g = Math.min(255, Math.max(0, c[1] + vv))      | 0;
        const b = Math.min(255, Math.max(0, c[2] + vv - vi)) | 0;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        // Wood grain lines
        ctx.save();
        ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
        const grainAxis = w > h ? 'h' : 'v';
        const count = (3 + rng() * 7) | 0;
        for (let gi = 0; gi < count; gi++) {
          const t  = rng();
          const gx = grainAxis === 'v' ? x + t * w : x;
          const gy = grainAxis === 'h' ? y + t * h : y;
          const gx2 = grainAxis === 'v' ? gx + (rng() - 0.5) * 4 : x + w;
          const gy2 = grainAxis === 'h' ? gy + (rng() - 0.5) * 4 : y + h;
          ctx.strokeStyle = `rgba(0,0,0,${(0.05 + rng() * 0.12).toFixed(3)})`;
          ctx.lineWidth = 0.4 + rng() * 1.2;
          ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx2, gy2); ctx.stroke();
        }
        ctx.restore();
      };
      // Horizontal plank
      drawPlank(ox, oy, PL, PW, 0);
      // Vertical plank (shifted by PL/2 and rotated)
      drawPlank(ox + PL / 2, oy + PW, PW, PL, 6);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function _makeBuildingTex(seed, floors, bldgWidth) {
  const rng  = _mkRng(seed);
  const style = (rng() * 5) | 0; // 0–4 architectural styles

  // Window colour picker
  const winCol = (r) => {
    if      (r < 0.38) return [255, 220, 120];
    else if (r < 0.58) return [185, 215, 255];
    else if (r < 0.73) return [255, 170,  55];
    else if (r < 0.88) return [255, 255, 240];
    else               return [ 70, 175, 255];
  };
  const alpha = (lo, hi) => (lo + rng() * (hi - lo)).toFixed(2);

  // ── Style 0: Glass curtain wall ──────────────────────────────────────
  // Nearly full-height glass panels separated by thin mullions.
  if (style === 0) {
    const bays = Math.max(3, Math.round(bldgWidth / 2.5));
    const tw = bays * 24, th = floors * 20;
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a1018'; ctx.fillRect(0, 0, tw, th);
    const bpx = tw / bays, fpx = th / floors;
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const lit = rng() > 0.22;
        const [cr, cg, cb] = winCol(rng());
        const a = lit ? alpha(0.55, 0.90) : alpha(0.04, 0.12);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.fillRect(b * bpx + 2, (floors - f - 1) * fpx + 2, bpx - 4, fpx - 3);
      }
    }
    // Mullion grid
    ctx.strokeStyle = 'rgba(80,100,120,0.5)'; ctx.lineWidth = 2;
    for (let b = 0; b <= bays; b++) { ctx.beginPath(); ctx.moveTo(b*bpx,0); ctx.lineTo(b*bpx,th); ctx.stroke(); }
    for (let f = 0; f <= floors; f++) { ctx.beginPath(); ctx.moveTo(0,f*fpx); ctx.lineTo(tw,f*fpx); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(canvas); return tex;
  }

  // ── Style 1: Concrete office grid ────────────────────────────────────
  // Spaced rectangular windows on a solid concrete facade.
  if (style === 1) {
    const bays = Math.max(2, Math.round(bldgWidth / 3.5));
    const tw = bays * 28, th = floors * 22;
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d');
    const concretes = ['#141618', '#181a1c', '#101214', '#1a1c20'];
    ctx.fillStyle = concretes[(rng() * 4) | 0]; ctx.fillRect(0, 0, tw, th);
    const bpx = tw / bays, fpx = th / floors;
    const isOffice = rng() > 0.4;
    for (let f = 0; f < floors; f++) {
      const floorLit = isOffice ? rng() > 0.2 : true;
      for (let b = 0; b < bays; b++) {
        if (!floorLit && rng() > 0.15) continue;
        if (rng() > 0.92) continue;
        const [cr, cg, cb] = winCol(rng());
        const a = floorLit ? alpha(0.60, 0.95) : alpha(0.10, 0.30);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.fillRect((b * bpx + bpx * 0.15) | 0, ((floors-f-1)*fpx + fpx*0.12) | 0,
                     (bpx * 0.70) | 0, (fpx * 0.72) | 0);
      }
    }
    // Spandrel panel lines
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (let f = 1; f < floors; f++) { ctx.beginPath(); ctx.moveTo(0,f*fpx); ctx.lineTo(tw,f*fpx); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(canvas); return tex;
  }

  // ── Style 2: Dense lit office tower ──────────────────────────────────
  // Small, closely-packed windows — classic postwar Tokyo office block.
  if (style === 2) {
    const bays = Math.max(4, Math.round(bldgWidth / 1.8));
    const tw = bays * 18, th = floors * 16;
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d');
    const facades2 = ['#0c0e12', '#101318', '#0e1016'];
    ctx.fillStyle = facades2[(rng() * 3) | 0]; ctx.fillRect(0, 0, tw, th);
    const bpx = tw / bays, fpx = th / floors;
    // Floors light up in blocks (whole sections of the building lit at once)
    const litFloors = new Set();
    for (let f = 0; f < floors; f++) { if (rng() > 0.30) litFloors.add(f); }
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const lit = litFloors.has(f) && rng() > 0.10;
        const [cr, cg, cb] = winCol(rng());
        const a = lit ? alpha(0.65, 0.95) : alpha(0.02, 0.08);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.fillRect((b*bpx + bpx*0.12)|0, ((floors-f-1)*fpx + fpx*0.14)|0,
                     (bpx*0.76)|0, (fpx*0.68)|0);
      }
    }
    // Thin horizontal spandrels
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
    for (let f = 1; f < floors; f++) { ctx.beginPath(); ctx.moveTo(0,f*fpx); ctx.lineTo(tw,f*fpx); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(canvas); return tex;
  }

  // ── Style 3: Dark reflective glass tower ─────────────────────────────
  // Near-black panels; subtle blue sheen; occasional lit floor.
  if (style === 3) {
    const bays = Math.max(3, Math.round(bldgWidth / 2.0));
    const tw = bays * 22, th = floors * 18;
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#060810'; ctx.fillRect(0, 0, tw, th);
    const bpx = tw / bays, fpx = th / floors;
    for (let f = 0; f < floors; f++) {
      const floorLit = rng() > 0.72; // most floors dark
      for (let b = 0; b < bays; b++) {
        const r2 = rng();
        let a, cr, cg, cb;
        if (floorLit && r2 > 0.15) {
          [cr, cg, cb] = winCol(rng()); a = alpha(0.50, 0.85);
        } else {
          [cr, cg, cb] = [60, 90, 140]; a = alpha(0.06, 0.18); // dark blue reflection
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.fillRect(b*bpx+1, (floors-f-1)*fpx+1, bpx-2, fpx-2);
      }
    }
    ctx.strokeStyle = 'rgba(40,60,90,0.4)'; ctx.lineWidth = 1;
    for (let b = 0; b <= bays; b++) { ctx.beginPath(); ctx.moveTo(b*bpx,0); ctx.lineTo(b*bpx,th); ctx.stroke(); }
    for (let f = 0; f <= floors; f++) { ctx.beginPath(); ctx.moveTo(0,f*fpx); ctx.lineTo(tw,f*fpx); ctx.stroke(); }
    const tex = new THREE.CanvasTexture(canvas); return tex;
  }

  // ── Style 4: Residential / mixed-use ─────────────────────────────────
  // Lighter mid-grey facade, irregular window placement, balcony lines.
  {
    const bays = Math.max(3, Math.round(bldgWidth / 2.8));
    const tw = bays * 26, th = floors * 24;
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d');
    const facades = ['#181a1e', '#1c1e22', '#141618'];
    ctx.fillStyle = facades[(rng() * 3) | 0]; ctx.fillRect(0, 0, tw, th);
    const bpx = tw / bays, fpx = th / floors;
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        if (rng() > 0.70) continue; // ~30% dark/unoccupied
        const [cr, cg, cb] = winCol(rng());
        const a = alpha(0.50, 0.90);
        // Slightly irregular window sizes for residential feel
        const insetX = bpx * (0.12 + rng() * 0.08);
        const insetY = fpx * (0.15 + rng() * 0.08);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.fillRect((b*bpx+insetX)|0, ((floors-f-1)*fpx+insetY)|0,
                     (bpx-insetX*2)|0, (fpx-insetY*2.2)|0);
      }
      // Balcony rail line at bottom of each floor
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0,(floors-f)*fpx); ctx.lineTo(tw,(floors-f)*fpx); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas); return tex;
  }
}

// Sky variants: 'night' | 'dawn' | 'dusk' | 'overcast'
// Returns a CanvasTexture for the lobby sky sphere.
function _makeSkyTex(variant) {
  const rng = _mkRng(0xdeadbeef);
  const TW = 2048, TH = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = TW; canvas.height = TH;
  const ctx = canvas.getContext('2d');

  if (variant === 'night') {
    // Deep black zenith — classic Tokyo night
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, TW, TH);
    // City-glow horizon band — warm orange smog
    const glowGrad = ctx.createLinearGradient(0, TH * 0.40, 0, TH * 0.62);
    glowGrad.addColorStop(0,    'rgba(0,0,0,0)');
    glowGrad.addColorStop(0.38, 'rgba(210,65,8,0.20)');
    glowGrad.addColorStop(0.55, 'rgba(255,88,12,0.30)');
    glowGrad.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad; ctx.fillRect(0, TH * 0.40, TW, TH * 0.22);
    // Dense stars
    for (let i = 0; i < 200; i++) {
      const sx = rng() * TW, sy = rng() * TH * 0.54;
      ctx.beginPath(); ctx.arc(sx, sy, 0.5 + rng(), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${(0.75 + rng() * 0.25).toFixed(2)})`; ctx.fill();
    }
    for (let i = 0; i < 8; i++) {
      const sx = rng() * TW, sy = rng() * TH * 0.44;
      ctx.beginPath(); ctx.arc(sx, sy, 1.0 + rng() * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,1.0)'; ctx.fill();
    }

  } else if (variant === 'dawn') {
    // Deep blue-purple zenith bleeding into pink-gold sunrise horizon
    const skyGrad = ctx.createLinearGradient(0, 0, 0, TH * 0.58);
    skyGrad.addColorStop(0,    '#080414');
    skyGrad.addColorStop(0.45, '#160c28');
    skyGrad.addColorStop(0.78, '#3e1430');
    skyGrad.addColorStop(1,    '#6e2218');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, TW, TH * 0.58);
    ctx.fillStyle = '#6e2218'; ctx.fillRect(0, TH * 0.58, TW, TH * 0.42);
    // Sunrise bloom
    const bloom = ctx.createLinearGradient(0, TH * 0.32, 0, TH * 0.68);
    bloom.addColorStop(0,    'rgba(0,0,0,0)');
    bloom.addColorStop(0.28, 'rgba(255,110,20,0.32)');
    bloom.addColorStop(0.52, 'rgba(255,195,55,0.50)');
    bloom.addColorStop(0.72, 'rgba(255,120,30,0.28)');
    bloom.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = bloom; ctx.fillRect(0, TH * 0.32, TW, TH * 0.36);
    // Thin silver-pink cloud streaks near horizon
    for (let i = 0; i < 14; i++) {
      const cy = TH * (0.44 + rng() * 0.14);
      const cw = 120 + rng() * 280, ch = 3 + rng() * 9;
      const cx = rng() * TW;
      ctx.globalAlpha = 0.12 + rng() * 0.18;
      ctx.fillStyle = '#ffccaa';
      ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, ch / 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Few fading stars near zenith
    for (let i = 0; i < 55; i++) {
      const sx = rng() * TW, sy = rng() * TH * 0.36;
      ctx.beginPath(); ctx.arc(sx, sy, 0.4 + rng() * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(240,220,255,${(0.25 + rng() * 0.45).toFixed(2)})`; ctx.fill();
    }

  } else if (variant === 'dusk') {
    // Violet-indigo zenith melting into deep sunset orange-crimson
    const skyGrad = ctx.createLinearGradient(0, 0, 0, TH * 0.56);
    skyGrad.addColorStop(0,    '#04060e');
    skyGrad.addColorStop(0.30, '#0a0818');
    skyGrad.addColorStop(0.60, '#220a1a');
    skyGrad.addColorStop(1,    '#4e1008');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, TW, TH * 0.56);
    ctx.fillStyle = '#4e1008'; ctx.fillRect(0, TH * 0.56, TW, TH * 0.44);
    // Rich sunset glow
    const sunset = ctx.createLinearGradient(0, TH * 0.28, 0, TH * 0.70);
    sunset.addColorStop(0,    'rgba(0,0,0,0)');
    sunset.addColorStop(0.22, 'rgba(255,70,5,0.28)');
    sunset.addColorStop(0.48, 'rgba(255,115,8,0.58)');
    sunset.addColorStop(0.68, 'rgba(255,55,5,0.32)');
    sunset.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = sunset; ctx.fillRect(0, TH * 0.28, TW, TH * 0.42);
    // Cloud silhouettes catching the light
    for (let i = 0; i < 10; i++) {
      const cy = TH * (0.40 + rng() * 0.16);
      const cw = 160 + rng() * 340, ch = 8 + rng() * 20;
      const cx = rng() * TW;
      ctx.globalAlpha = 0.18 + rng() * 0.22;
      ctx.fillStyle = '#ff8840';
      ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, ch / 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // First stars emerging in the high zenith
    for (let i = 0; i < 45; i++) {
      const sx = rng() * TW, sy = rng() * TH * 0.30;
      ctx.beginPath(); ctx.arc(sx, sy, 0.4 + rng() * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,210,200,${(0.35 + rng() * 0.50).toFixed(2)})`; ctx.fill();
    }

  } else if (variant === 'overcast') {
    // Flat grey-blue cloud deck — Tokyo on a winter evening
    const skyGrad = ctx.createLinearGradient(0, 0, 0, TH);
    skyGrad.addColorStop(0,    '#0c1016');
    skyGrad.addColorStop(0.38, '#111620');
    skyGrad.addColorStop(0.65, '#181e2c');
    skyGrad.addColorStop(1,    '#1e2438');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, TW, TH);
    const glow = ctx.createLinearGradient(0, TH * 0.42, 0, TH * 0.64);
    glow.addColorStop(0,   'rgba(0,0,0,0)');
    glow.addColorStop(0.5, 'rgba(55,75,115,0.40)');
    glow.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, TH * 0.42, TW, TH * 0.22);
    for (let i = 0; i < 28; i++) {
      const cx = rng() * TW, cy = rng() * TH * 0.68;
      const cw = 200 + rng() * 450, ch = 18 + rng() * 45;
      ctx.globalAlpha = 0.06 + rng() * 0.10;
      ctx.fillStyle = rng() > 0.5 ? '#2a3448' : '#1e2838';
      ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, ch / 2, rng() * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

  } else if (variant === 'day') {
    // Clear Tokyo midday — deep cobalt zenith, hazy blue-white horizon, puffy clouds
    const skyGrad = ctx.createLinearGradient(0, 0, 0, TH * 0.58);
    skyGrad.addColorStop(0,    '#0a2e6e');
    skyGrad.addColorStop(0.40, '#1756b0');
    skyGrad.addColorStop(0.78, '#4e94d8');
    skyGrad.addColorStop(1,    '#9ac4f0');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, TW, TH * 0.58);
    ctx.fillStyle = '#9ac4f0'; ctx.fillRect(0, TH * 0.58, TW, TH * 0.42);
    // Atmospheric horizon haze
    const haze = ctx.createLinearGradient(0, TH * 0.46, 0, TH * 0.66);
    haze.addColorStop(0,   'rgba(200,220,248,0)');
    haze.addColorStop(0.5, 'rgba(215,232,252,0.65)');
    haze.addColorStop(1,   'rgba(225,238,255,0)');
    ctx.fillStyle = haze; ctx.fillRect(0, TH * 0.46, TW, TH * 0.20);
    // Sun glow
    const sunX = TW * 0.68, sunY = TH * 0.16;
    const sunG = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 130);
    sunG.addColorStop(0,    'rgba(255,252,220,1.0)');
    sunG.addColorStop(0.12, 'rgba(255,240,160,0.80)');
    sunG.addColorStop(0.40, 'rgba(255,220,80,0.25)');
    sunG.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = sunG; ctx.fillRect(sunX - 140, sunY - 140, 280, 280);
    // Puffy cumulus clouds
    for (let i = 0; i < 20; i++) {
      const cx = rng() * TW, cy = TH * (0.22 + rng() * 0.30);
      const cw = 90 + rng() * 220, ch = 22 + rng() * 55;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw * 0.55);
      cg.addColorStop(0,   'rgba(255,255,255,0.92)');
      cg.addColorStop(0.55,'rgba(238,244,252,0.58)');
      cg.addColorStop(1,   'rgba(215,230,248,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, ch / 2, 0, 0, Math.PI * 2); ctx.fill();
      for (let j = 0; j < 3; j++) {
        const px = cx + (rng() - 0.5) * cw * 0.75, py = cy - rng() * ch * 0.6;
        ctx.beginPath(); ctx.arc(px, py, ch * (0.35 + rng() * 0.40), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.fill();
      }
    }

  } else if (variant === 'midnight') {
    // Pitch black — denser stars than night, bright moon, faint Milky Way
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, TW, TH);
    // Barely-there city smog at the horizon edge
    const smog = ctx.createLinearGradient(0, TH * 0.49, 0, TH * 0.57);
    smog.addColorStop(0,   'rgba(0,0,0,0)');
    smog.addColorStop(0.5, 'rgba(70,25,4,0.10)');
    smog.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = smog; ctx.fillRect(0, TH * 0.49, TW, TH * 0.08);
    // Moon
    const moonX = TW * (0.22 + rng() * 0.56), moonY = TH * (0.07 + rng() * 0.26);
    ctx.beginPath(); ctx.arc(moonX, moonY, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#e6ddc4'; ctx.fill();
    for (let i = 0; i < 6; i++) {
      const ca = rng() * Math.PI * 2, cd = rng() * 16, cr = 2 + rng() * 5;
      ctx.beginPath(); ctx.arc(moonX + Math.cos(ca) * cd, moonY + Math.sin(ca) * cd, cr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(155,142,115,0.38)'; ctx.fill();
    }
    const mhalo = ctx.createRadialGradient(moonX, moonY, 20, moonX, moonY, 70);
    mhalo.addColorStop(0, 'rgba(195,185,155,0.14)'); mhalo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mhalo; ctx.fillRect(moonX - 72, moonY - 72, 144, 144);
    // Dense star field
    for (let i = 0; i < 420; i++) {
      const sx = rng() * TW, sy = rng() * TH * 0.57;
      ctx.beginPath(); ctx.arc(sx, sy, 0.3 + rng() * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${(0.55 + rng() * 0.45).toFixed(2)})`; ctx.fill();
    }
    // Bright coloured planets
    const pColors = ['rgba(255,255,255,1)', 'rgba(255,238,195,1)', 'rgba(195,218,255,1)', 'rgba(255,198,175,1)'];
    for (let i = 0; i < 16; i++) {
      const sx = rng() * TW, sy = rng() * TH * 0.50;
      ctx.beginPath(); ctx.arc(sx, sy, 1.2 + rng() * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = pColors[Math.floor(rng() * pColors.length)]; ctx.fill();
    }
    // Faint Milky Way diagonal smear
    for (let i = 0; i < 90; i++) {
      const sx = rng() * TW * 1.5 - TW * 0.25;
      const sy = sx * 0.32 + TH * (rng() * 0.10 - 0.05);
      if (sy < 0 || sy > TH * 0.54) continue;
      ctx.beginPath(); ctx.arc(sx, sy, 0.4 + rng() * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(215,205,255,${(0.07 + rng() * 0.16).toFixed(2)})`; ctx.fill();
    }

  } else if (variant === 'storm') {
    // Near-black churning storm clouds, sickly greenish horizon
    ctx.fillStyle = '#020408'; ctx.fillRect(0, 0, TW, TH);
    for (let i = 0; i < 50; i++) {
      const cx = rng() * TW, cy = rng() * TH * 0.78;
      const cw = 200 + rng() * 480, ch = 55 + rng() * 130;
      ctx.globalAlpha = 0.14 + rng() * 0.24;
      const v = 14 + Math.floor(rng() * 18);
      ctx.fillStyle = `rgb(${v},${v + 2},${v})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, ch / 2, rng() * 0.7 - 0.35, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Sickly green-grey horizon tinge
    const sg = ctx.createLinearGradient(0, TH * 0.42, 0, TH * 0.62);
    sg.addColorStop(0,   'rgba(0,0,0,0)');
    sg.addColorStop(0.5, 'rgba(18,28,10,0.38)');
    sg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, TH * 0.42, TW, TH * 0.20);

  } else if (variant === 'blizzard_sky') {
    // Dark steel-blue — heavy low cloud deck, cold horizon glow
    const skyGrad = ctx.createLinearGradient(0, 0, 0, TH);
    skyGrad.addColorStop(0,    '#040810');
    skyGrad.addColorStop(0.35, '#080e1c');
    skyGrad.addColorStop(0.65, '#0e1828');
    skyGrad.addColorStop(1,    '#162030');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, TW, TH);
    for (let i = 0; i < 38; i++) {
      const cx = rng() * TW, cy = rng() * TH * 0.76;
      const cw = 160 + rng() * 380, ch = 32 + rng() * 88;
      ctx.globalAlpha = 0.09 + rng() * 0.16;
      ctx.fillStyle = rng() > 0.5 ? '#1a2840' : '#102038';
      ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, ch / 2, rng() * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const bh = ctx.createLinearGradient(0, TH * 0.44, 0, TH * 0.64);
    bh.addColorStop(0,   'rgba(0,0,0,0)');
    bh.addColorStop(0.5, 'rgba(110,150,210,0.24)');
    bh.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = bh; ctx.fillRect(0, TH * 0.44, TW, TH * 0.20);
  }

  return new THREE.CanvasTexture(canvas);
}

// Weather particle system — placed in the exterior zone visible through the lobby windows.
// Covers the full city Z spread (±260 m) so weather is visible in all pan directions.
// Returns a Three.js Group with animation metadata in userData, or null for fog/clear.
function _makeWeatherParticles(type, W, midZ, winSpan, STREET_Y) {
  if (type === 'clear' || type === 'light_fog' || type === 'heavy_fog') return null;

  const rng = _mkRng(0x9f4a2c1b);
  const X_MIN = W / 2 + 1.5, X_MAX = W / 2 + 50;
  const Z_MIN = midZ - 260, Z_MAX = midZ + 260;
  const Y_TOP = 22, Y_BOT = STREET_Y;
  const HEIGHT = Y_TOP - Y_BOT;
  const group = new THREE.Group();

  // Helper: build a rain/storm streak geometry
  function makeStreaks(N, STREAK, velY, color, opacity) {
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = X_MIN + rng() * (X_MAX - X_MIN);
      const y = Y_BOT + rng() * HEIGHT;
      const z = Z_MIN + rng() * (Z_MAX - Z_MIN);
      const o = i * 6;
      pos[o]     = x; pos[o + 1] = y + STREAK; pos[o + 2] = z;
      pos[o + 3] = x; pos[o + 4] = y;           pos[o + 5] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, fog: false });
    group.add(new THREE.LineSegments(geo, mat));
    return { geo, STREAK, vel: velY };
  }

  // Helper: build a snow/blizzard point field
  function makeFlakes(N, size, color, opacity, velY) {
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = X_MIN + rng() * (X_MAX - X_MIN);
      pos[i * 3 + 1] = Y_BOT + rng() * HEIGHT;
      pos[i * 3 + 2] = Z_MIN + rng() * (Z_MAX - Z_MIN);
      phase[i] = rng() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity, sizeAttenuation: true, fog: false });
    group.add(new THREE.Points(geo, mat));
    return { geo, phase, vel: velY };
  }

  if (type === 'rain') {
    const s = makeStreaks(4000, 0.55, -12, 0x8ab4d8, 0.40);
    group.userData = { weatherType: 'rain', ...s, Y_BOT, Y_TOP, HEIGHT };

  } else if (type === 'snow') {
    const f = makeFlakes(3000, 0.14, 0xddeeff, 0.72, -0.9);
    group.userData = { weatherType: 'snow', ...f, Y_BOT, Y_TOP, HEIGHT, X_MIN, X_MAX, Z_MIN, Z_MAX, time: 0 };

  } else if (type === 'blizzard') {
    const f = makeFlakes(6000, 0.18, 0xd8eaff, 0.80, -3.5);
    // Wind constant stored here; direction computed per-frame in scene3d
    group.userData = { weatherType: 'blizzard', ...f, Y_BOT, Y_TOP, HEIGHT, X_MIN, X_MAX, Z_MIN, Z_MAX, time: 0 };

  } else if (type === 'thunderstorm') {
    const s = makeStreaks(8000, 0.85, -18, 0x5880a8, 0.48);
    // Exterior lightning light — high above the city, wide range
    const lightningLight = new THREE.PointLight(0xd0e8ff, 0, 1200, 0.6);
    lightningLight.position.set(W / 2 + 60, 100, midZ);
    group.add(lightningLight);
    // Interior flash light — just inside the window, floods the room
    const flashLight = new THREE.PointLight(0xddeeff, 0, 30, 1.4);
    flashLight.position.set(W / 2 - 0.5, 2.0, midZ);
    group.add(flashLight);
    group.userData = {
      weatherType: 'thunderstorm', ...s, Y_BOT, Y_TOP, HEIGHT,
      lightningLight, flashLight,
      lightningCooldown: 1.5 + Math.random() * 4,
      lightningFlash: 0,
      lightningDoubleDelay: -1,
    };
  }

  return group;
}

function _makeCityGroundTex() {
  const rng = _mkRng(0x8fa2c3);
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');

  // Dark asphalt base
  ctx.fillStyle = '#0e1012';
  ctx.fillRect(0, 0, S, S);

  // Road grid — two lanes each direction
  const ROAD = 80, BLOCK = (S - ROAD * 2) / 2; // two roads divide into 2×2 blocks
  const roads = [BLOCK, BLOCK + ROAD]; // x/y positions of road bands
  ctx.fillStyle = '#161a1e';
  for (const r of roads) {
    ctx.fillRect(r, 0, ROAD, S);  // vertical roads
    ctx.fillRect(0, r, S, ROAD);  // horizontal roads
  }

  // City block fills (rooftop colour variation)
  const blocks = [
    [0, 0], [BLOCK + ROAD * 2, 0],
    [0, BLOCK + ROAD * 2], [BLOCK + ROAD * 2, BLOCK + ROAD * 2],
  ];
  const blockColors = ['#1a1c20', '#181b1f', '#1c1e23', '#161819'];
  blocks.forEach(([bx, by], i) => {
    ctx.fillStyle = blockColors[i];
    ctx.fillRect(bx + 4, by + 4, BLOCK - 8, BLOCK - 8);
    // Rooftop HVAC / service blobs
    for (let k = 0; k < 6; k++) {
      const rx = bx + 8 + rng() * (BLOCK - 20);
      const ry = by + 8 + rng() * (BLOCK - 20);
      const rw = 4 + rng() * 14, rh = 4 + rng() * 10;
      ctx.fillStyle = `rgba(30,33,38,${(0.6 + rng() * 0.4).toFixed(2)})`;
      ctx.fillRect(rx | 0, ry | 0, rw | 0, rh | 0);
    }
  });

  // Lane markings — dashed yellow centre lines
  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = 'rgba(220,180,40,0.55)';
  ctx.lineWidth = 2;
  for (const r of roads) {
    ctx.beginPath(); ctx.moveTo(r + ROAD / 2, 0); ctx.lineTo(r + ROAD / 2, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, r + ROAD / 2); ctx.lineTo(S, r + ROAD / 2); ctx.stroke();
  }
  ctx.setLineDash([]);

  // White kerb lines along block edges
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  for (const r of roads) {
    ctx.strokeRect(r, r, ROAD, ROAD); // intersection box
  }

  // Street lamp halos at intersections
  for (const rx of roads) for (const ry of roads) {
    const g = ctx.createRadialGradient(rx + ROAD/2, ry + ROAD/2, 0, rx + ROAD/2, ry + ROAD/2, 28);
    g.addColorStop(0, 'rgba(255,200,80,0.28)');
    g.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = g; ctx.fillRect(rx, ry, ROAD, ROAD);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---- Human ----
// Built with the same seg() / jnt() primitives as the Gantz interior figure so
// all characters share a unified visual language: point-to-point cylinders for
// limbs, sphere joints at every articulation, feet as flat boxes.
export function buildHumanMesh(spec, opts = {}) {
  const group = new THREE.Group();
  const S  = (spec.height || 1.75) / 1.75;                                          // height scale
  const B  = spec.build === 'slim' ? 0.92 : spec.build === 'heavy' ? 1.14 : 1.0;   // width scale
  group.userData.spec = spec;

  const skinMat  = new THREE.MeshStandardMaterial({ color: color(spec.skin),                    roughness: 0.82 });
  const hairMat  = new THREE.MeshStandardMaterial({ color: color(spec.hair?.color || '#1a1a1a'), roughness: 0.75 });
  const torsoMat = new THREE.MeshStandardMaterial({ color: color(spec.outfit.top),               roughness: 0.82 });
  const legMat   = new THREE.MeshStandardMaterial({ color: color(spec.outfit.bottom),            roughness: 0.85 });
  const shoeMat  = new THREE.MeshStandardMaterial({ color: 0x141414,                             roughness: 0.9  });

  // Point-to-point cylinder helper (adds to group).
  // Guards against the antiparallel case (dir = (0,−1,0)) where
  // setFromUnitVectors has no defined rotation axis and returns a degenerate
  // quaternion that distorts the mesh into a cone shape.
  const _up  = new THREE.Vector3(0, 1, 0);
  const _axX = new THREE.Vector3(1, 0, 0);
  function seg(ax, ay, az, bx, by, bz, r, mat) {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 0.004) return null;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 9), mat);
    c.position.lerpVectors(a, b, 0.5);
    const nd = dir.normalize();
    if (nd.dot(_up) < -0.9999) {
      c.quaternion.setFromAxisAngle(_axX, Math.PI); // straight-down segment
    } else {
      c.quaternion.setFromUnitVectors(_up, nd);
    }
    c.castShadow = true;
    group.add(c);
    return c;
  }
  // Sphere joint helper (adds to group)
  function jnt(x, y, z, r, mat) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), mat);
    s.position.set(x, y, z);
    s.castShadow = true;
    group.add(s);
    return s;
  }

  // ── Head ────────────────────────────────────────────────────────────────────
  jnt(0,             1.600 * S, 0,           0.100 * S, skinMat);  // head
  jnt(0,             1.640 * S, 0,           0.097 * S, hairMat);  // bald skullcap
  jnt(0,             1.578 * S, 0.100 * S,   0.018 * S, skinMat);  // nose tip
  for (const sx of [-1, 1]) {
    jnt(sx * 0.042 * S, 1.620 * S, 0.088 * S, 0.014 * S, hairMat); // brow ridge
  }

  // ── Neck ────────────────────────────────────────────────────────────────────
  seg(0, 1.510 * S, 0.010 * S,   0, 1.420 * S, 0,   0.036 * S, skinMat);

  // ── Torso ───────────────────────────────────────────────────────────────────
  seg(-0.175*S*B, 1.400*S, 0,   0.175*S*B, 1.400*S, 0,   0.036*S, torsoMat); // collarbone
  seg(0, 1.420*S, 0,   0, 0.880*S, 0,   0.072*S*B, torsoMat);                 // spine
  seg(-0.108*S*B, 0.880*S, 0,   0.108*S*B, 0.880*S, 0,   0.048*S*B, torsoMat); // hip bar

  // ── Arms (each in a sub-group pivoting at the shoulder) ─────────────────────
  // scene3d.js animates walk swing via armL/R.rotation.x — the pivot being at
  // the shoulder means the whole arm sweeps forward/backward correctly.
  function makeArm(side) {
    // side: -1 = left, +1 = right
    const grp = new THREE.Group();
    grp.position.set(side * 0.175 * S * B, 1.400 * S, 0);

    function segA(ax,ay,az, bx,by,bz, r, mat) {
      const a=new THREE.Vector3(ax,ay,az), b=new THREE.Vector3(bx,by,bz);
      const dir=new THREE.Vector3().subVectors(b,a); const len=dir.length();
      if (len < 0.004) return;
      const c=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,9), mat);
      c.position.lerpVectors(a,b,0.5);
      const nd=dir.normalize();
      if (nd.dot(_up) < -0.9999) { c.quaternion.setFromAxisAngle(_axX, Math.PI); }
      else { c.quaternion.setFromUnitVectors(_up, nd); }
      c.castShadow=true; grp.add(c);
    }
    function jntA(x,y,z,r,mat) {
      const s=new THREE.Mesh(new THREE.SphereGeometry(r,10,7),mat);
      s.position.set(x,y,z); s.castShadow=true; grp.add(s);
    }

    jntA(0, 0, 0,                          0.044*S, torsoMat);       // shoulder joint
    segA(0, 0, 0,   side*0.04*S,-0.285*S,0, 0.037*S, torsoMat);      // upper arm
    jntA(side*0.04*S, -0.285*S, 0,         0.040*S, skinMat);        // elbow joint
    segA(side*0.04*S,-0.285*S,0,  side*0.02*S,-0.555*S,0, 0.030*S, skinMat); // forearm
    jntA(side*0.02*S, -0.555*S, 0,         0.033*S, skinMat);        // hand

    group.add(grp);
    return grp;
  }
  const armLGrp = makeArm(-1);
  const armRGrp = makeArm( 1);

  // ── Legs ────────────────────────────────────────────────────────────────────
  for (const sx of [-1, 1]) {
    const hx = sx * 0.108 * S * B;  // hip x
    const kx = sx * 0.110 * S;       // knee x (slight outward taper)
    seg(hx, 0.880*S, 0,   kx, 0.460*S, 0,   0.052*S, legMat);  // thigh
    jnt(kx, 0.460*S, 0,                       0.054*S, legMat);  // knee
    seg(kx, 0.460*S, 0,   kx, 0.090*S, 0,    0.039*S, legMat);  // shin
    jnt(kx, 0.090*S, 0,                       0.038*S, skinMat); // ankle
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.090*S, 0.052*S, 0.220*S), shoeMat);
    foot.position.set(sx * 0.104 * S, 0.038 * S, 0.075 * S);
    foot.castShadow = true;
    group.add(foot);
  }

  // ── Hair ────────────────────────────────────────────────────────────────────
  const headR = 0.100 * S;
  const style = spec.hair?.style || 'short';
  if (style !== 'bald') {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 1.03, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hairMat,
    );
    cap.position.set(0, 1.600 * S, 0);
    cap.castShadow = true;
    group.add(cap);
    if (style === 'long') {
      // Tapered cylinder draping down the back of the head (−Z = behind nose)
      const trail = new THREE.Mesh(
        new THREE.CylinderGeometry(headR * 0.55, headR * 0.20, 0.50 * S, 8),
        hairMat,
      );
      trail.position.set(0, 1.370 * S, -headR * 0.9);
      trail.rotation.x = 0.28; // lean slightly backward
      trail.castShadow = true;
      group.add(trail);
    } else if (style === 'ponytail') {
      const pony = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.35*S, 8), hairMat);
      pony.position.set(-headR * 0.9, 1.520*S, 0);
      pony.rotation.z = Math.PI / 3;
      group.add(pony);
    } else if (style === 'topknot') {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.08*S, 10, 8), hairMat);
      knot.position.set(0, (1.600 + headR) * S, 0);
      group.add(knot);
    } else if (style === 'messy') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const clump = new THREE.Mesh(new THREE.SphereGeometry(headR*0.35, 8, 6), hairMat);
        clump.position.set(Math.cos(a)*headR*0.5, 1.600*S + headR*0.9, Math.sin(a)*headR*0.5);
        group.add(clump);
      }
    }
  }

  // ── Suit overlay (mission Gantz suit) ───────────────────────────────────────
  if (opts.suit) {
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x080810, roughness: 0.35, metalness: 0.65,
      transparent: true, opacity: 0.88,
    });
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.3*B, 0.6*S, 4, 10), shellMat);
    shell.position.y = 1.150 * S;
    group.add(shell);
    const pipe = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.7*S, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xc8142b }),
    );
    pipe.position.set(0.31*B, 1.150*S, 0);
    group.add(pipe);
  }

  group.userData.parts = { armL: armLGrp, armR: armRGrp };
  group.userData.scale = S;
  return group;
}

// ---- Alien ----
export function buildAlienMesh(spec) {
  const group = new THREE.Group();
  const sc = spec.size;
  const primary = color(spec.skin.primary);
  const accent = color(spec.skin.accent);

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.5 * sc, 18, 12),
    new THREE.MeshStandardMaterial({ color: primary, roughness: 0.55, metalness: 0.2 }),
  );
  body.scale.set(1.2, 0.75, 1.0);
  body.position.y = 0.4 * sc;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Back stripe
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.6 * sc, 0.05, 0.07),
    new THREE.MeshBasicMaterial({ color: accent }),
  );
  stripe.position.set(0, 0.72 * sc, 0);
  group.add(stripe);

  for (let i = 0; i < spec.limbs; i++) {
    const a = (i / spec.limbs) * Math.PI * 2;
    const limb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14 * sc, 10, 8),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 }),
    );
    limb.position.set(Math.cos(a) * 0.55 * sc, 0.2 * sc, Math.sin(a) * 0.42 * sc);
    limb.castShadow = true;
    group.add(limb);
  }

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffde55 });
  for (let i = 0; i < spec.eyeCount; i++) {
    const ang = ((i / Math.max(1, spec.eyeCount - 1)) - 0.5) * 0.9;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05 * sc, 8, 6), eyeMat);
    eye.position.set(0.45 * sc, 0.5 * sc, Math.sin(ang) * 0.2 * sc);
    group.add(eye);
  }

  // Marker ring placeholder — shown only when marked
  const markRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.8 * sc, 0.04, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0 }),
  );
  markRing.rotation.x = Math.PI / 2;
  markRing.position.y = 0.4 * sc;
  group.add(markRing);
  group.userData.markRing = markRing;

  return group;
}

// ---- Props ----
export function buildPropMesh(type, spec) {
  const group = new THREE.Group();
  if (type === 'pillar') {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 3.2, 14),
      new THREE.MeshStandardMaterial({ color: 0x181c30, roughness: 0.6, metalness: 0.4 }),
    );
    col.position.y = 1.6;
    col.castShadow = true; col.receiveShadow = true;
    group.add(col);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.08, 14),
      new THREE.MeshBasicMaterial({ color: 0xc8142b, transparent: true, opacity: 0.6 }),
    );
    band.position.y = 0.2;
    group.add(band);
  } else if (type === 'bench') {
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.12, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x2a2418, roughness: 0.85 }),
    );
    seat.position.y = 0.42;
    seat.castShadow = true; seat.receiveShadow = true;
    group.add(seat);
    for (const dx of [-0.65, 0.65]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.42, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x1a140a, roughness: 0.9 }),
      );
      leg.position.set(dx, 0.21, 0);
      leg.castShadow = true;
      group.add(leg);
    }
  } else if (type === 'crate') {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.95 }),
    );
    crate.position.y = 0.4;
    crate.rotation.y = spec.rotation || 0;
    crate.castShadow = true; crate.receiveShadow = true;
    group.add(crate);
  } else if (type === 'console') {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.0, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1c2238, roughness: 0.55, metalness: 0.5 }),
    );
    base.position.y = 0.5;
    base.castShadow = true; base.receiveShadow = true;
    group.add(base);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x1ea5c8, transparent: true, opacity: 0.85 }),
    );
    screen.position.set(0, 0.7, 0.36);
    group.add(screen);
    group.rotation.y = spec.rotation || 0;
  } else if (type === 'lamp') {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x252840, roughness: 0.8 }),
    );
    pole.position.y = 1.4;
    pole.castShadow = true;
    group.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xe8c070 }),
    );
    bulb.position.y = 2.8;
    group.add(bulb);
    const lampLight = new THREE.PointLight(0xe8c070, 1.1, 6, 2);
    lampLight.position.y = 2.8;
    group.add(lampLight);
  } else if (type === 'vending') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 1.6, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x1a2a45, roughness: 0.6, metalness: 0.4 }),
    );
    body.position.y = 0.8;
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 1.15),
      new THREE.MeshBasicMaterial({ color: 0xe8c070, transparent: true, opacity: 0.7 }),
    );
    panel.position.set(0, 0.95, 0.305);
    group.add(panel);
  } else if (type === 'panel_light') {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.08, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xc8142b, transparent: true, opacity: 0.75 }),
    );
    panel.position.y = 0.04;
    group.add(panel);
  } else if (type === 'bollard') {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.55, 10),
      new THREE.MeshStandardMaterial({ color: 0xc8142b, roughness: 0.6 }),
    );
    b.position.y = 0.275;
    b.castShadow = true;
    group.add(b);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.02, 6, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.43;
    group.add(ring);
  } else if (type === 'trash') {
    const blobs = [
      [ 0,     0,    0,    0.28, '#1a1a1a'],
      [ 0.18,  0,    0.10, 0.18, '#252525'],
      [-0.14,  0,   -0.10, 0.20, '#1e1e1e'],
      [ 0.05,  0,    0.18, 0.14, '#2a2a2a'],
    ];
    for (const [x, y, z, r, fill] of blobs) {
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(r, 10, 8),
        new THREE.MeshStandardMaterial({ color: color(fill), roughness: 0.95 }),
      );
      b.position.set(x, r, z);
      b.castShadow = true;
      group.add(b);
    }
    group.rotation.y = spec.rotation || 0;
  } else if (type === 'sign') {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.8 }),
    );
    pole.position.y = 0.6;
    group.add(pole);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.22, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xc8142b }),
    );
    sign.position.y = 1.3;
    sign.rotation.y = spec.rotation || 0;
    group.add(sign);
  }
  return group;
}

// ---- Buildings (shopfronts) ----
export function buildBuildingMesh(b) {
  const group = new THREE.Group();
  const height = 4.0;
  const hw = b.w * 0.5, hh = b.h * 0.5;

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(b.w, height, b.h),
    new THREE.MeshStandardMaterial({ color: 0x22232a, roughness: 0.85 }),
  );
  shell.position.y = height * 0.5;
  shell.castShadow = true; shell.receiveShadow = true;
  group.add(shell);

  // red trim on top
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(b.w - 0.2, 0.1, b.h - 0.2),
    new THREE.MeshBasicMaterial({ color: 0xc8142b, transparent: true, opacity: 0.55 }),
  );
  trim.position.y = height + 0.05;
  group.add(trim);

  // storefront window (facing south = +z relative to building center)
  const winW = Math.min(b.w, b.h) - 0.6;
  const winH = height * 0.45;
  const window_ = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    new THREE.MeshBasicMaterial({ color: 0x1ea5c8, transparent: true, opacity: 0.45 }),
  );
  // Place on the +z face (toward the street)
  window_.position.set(0, height * 0.5, b.h * 0.5 + 0.01);
  group.add(window_);

  // Warm interior light glow behind window
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(winW * 0.9, winH * 0.3),
    new THREE.MeshBasicMaterial({ color: 0xe8c070, transparent: true, opacity: 0.35 }),
  );
  glow.position.set(0, height * 0.4, b.h * 0.5 + 0.015);
  group.add(glow);

  group.position.set(b.x, 0, b.y);
  return group;
}

// ---- Gantz ball ----
// The ball is a hollow sphere built from separate pieces:
//   • Static shell segments (the parts that never move)
//   • Three sliding panel segments (curved sphere pieces that translate outward)
//   • Inner cavity wall (BackSide sphere — the dark hollow interior)
//   • Weapon racks mounted on the inner face of each panel
//   • Human figure seated inside, revealed through the gaps when panels open
export function buildGantzBallMesh() {
  const group = new THREE.Group();
  const R  = 1.2;          // ball radius in metres
  const PW = Math.PI / 6;  // panel half-angle = 30° → each panel spans 60° of phi

  // ── Materials ──────────────────────────────────────────────────────────────
  // DoubleSide on both: shell interior is exposed through open gaps, panels are seen from both sides
  const shellMat     = new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 0.50, metalness: 0.15, side: THREE.DoubleSide });
  const panelMat     = shellMat;
  // BackSide inner cavity — visible through the gaps left by open panels
  const innerMat     = new THREE.MeshStandardMaterial({ color: 0x0c0d18, roughness: 0.65, metalness: 0.2, side: THREE.BackSide });
  const metalMat     = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.40, metalness: 0.90 });
  const silverMat    = new THREE.MeshStandardMaterial({ color: 0x8a9198, roughness: 0.35, metalness: 0.45 });
  const ridgeMat     = new THREE.MeshStandardMaterial({ color: 0x5e666d, roughness: 0.40, metalness: 0.50 });
  const rackMat      = new THREE.MeshStandardMaterial({ color: 0x181921, roughness: 0.45, metalness: 0.85 });
  const gunBodyMat   = new THREE.MeshStandardMaterial({ color: 0x1c1c28, roughness: 0.38, metalness: 0.90 });
  const gunBarrelMat = new THREE.MeshStandardMaterial({ color: 0x26263a, roughness: 0.28, metalness: 0.96 });
  const skinMat      = new THREE.MeshStandardMaterial({ color: 0xc89060, roughness: 0.82 });
  const hairMat      = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.90 });

  // ── Inner cavity wall ──────────────────────────────────────────────────────
  group.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.95, 32, 18), innerMat));

  // ── Interior point light (controlled by animation) ─────────────────────────
  const interiorLight = new THREE.PointLight(0xfff0e0, 0, 3.5, 2);
  interiorLight.position.set(0, 0.25, 0);
  group.add(interiorLight);

  // ── Static shell segments ──────────────────────────────────────────────────
  // Three.js SphereGeometry phi mapping: phi=0→-X  phi=π/2→+Z  phi=π→+X  phi=3π/2→-Z
  // Panel phi centres: left=-X(0)  right=+X(π)  back=-Z(3π/2)
  //
  // Panels are limited to an equatorial theta band (T0 → π-T0) so they appear
  // as rectangular strips, not tapered wedges. The polar caps (above/below T0)
  // are separate static pieces that cover the full phi range.
  const T0 = Math.PI * 0.14; // ≈25° — top/bottom of panel cutoff

  function shellSeg(phiStart, phiLen, thetaStart = 0, thetaLen = Math.PI) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(R, 42, 24, phiStart, phiLen, thetaStart, thetaLen),
      shellMat,
    );
    m.castShadow = true;
    return m;
  }

  // Polar caps — full phi, cover zones not included in the panel band
  group.add(shellSeg(0, 2 * Math.PI, 0,              T0));          // Top cap
  group.add(shellSeg(0, 2 * Math.PI, Math.PI - T0,  T0));           // Bottom cap

  // Equatorial lateral segments — same theta band as panels, fill phi gaps
  const eqTheta = Math.PI - 2 * T0;                                  // equatorial band height
  group.add(shellSeg(PW, Math.PI - 2 * PW,          T0, eqTheta));  // Front
  const sideGap = Math.PI / 2 - 2 * PW;
  if (sideGap > 0.02) {
    group.add(shellSeg(Math.PI + PW,         sideGap, T0, eqTheta)); // Right-back
    group.add(shellSeg(3*Math.PI/2 + PW,     sideGap, T0, eqTheta)); // Back-left
  }

  // ── Weapon rack ────────────────────────────────────────────────────────────
  // Flat rectangular plate; local +X = inward face (toward ball centre when closed).
  // 3 columns × 5 rows of gun slots.
  function buildWeaponRack() {
    const rg = new THREE.Group();
    // Backing plate — depth along local X, height Y, width Z
    rg.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.20, 0.80), rackMat));
    // Horizontal divider rails
    for (let r = -2; r <= 2; r++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.028, 0.82), metalMat);
      rail.position.set(0.04, r * 0.23, 0);
      rg.add(rail);
    }
    // Gun slots: col = Z offset, row = Y offset
    for (let col = -1; col <= 1; col++) {
      for (let row = -2; row <= 2; row++) {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.22), gunBodyMat);
        body.position.set(0.05, row * 0.23, col * 0.26);
        rg.add(body);
        const brl = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), gunBarrelMat);
        brl.rotation.z = Math.PI / 2;
        brl.position.set(0.11, row * 0.23, col * 0.26);
        rg.add(brl);
      }
    }
    return rg;
  }

  // ── Moveable panel builder ─────────────────────────────────────────────────
  // phiStart:  start phi of this panel's sphere arc
  // slideDir:  THREE.Vector3 direction this panel translates when opening
  // hasFeet:   if true, adds two vertical support legs at the outer ±Z corners
  function buildPanel(phiStart, slideDir, hasFeet = false) {
    const pg = new THREE.Group();
    // Curved sphere segment — same theta band as static shell, so panel looks
    // like a rectangular strip rather than a tapered wedge
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(R, 42, 24, phiStart, 2 * PW, T0, Math.PI - 2 * T0),
      panelMat,
    );
    m.castShadow = true;
    pg.add(m);
    // Weapon rack — mounted on the inner (concave) face of the panel.
    // Positioned at R*0.68 so all rack corners stay inside the sphere (prevents
    // visible clipping through the outer shell when the panel is closed).
    const rack = buildWeaponRack();
    rack.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      slideDir.clone().negate(), // face points inward (toward ball centre)
    );
    rack.position.copy(slideDir).multiplyScalar(R * 0.68);
    pg.add(rack);

    // ── Panel side fills — close the gap between sphere-arc edge and rack face ─
    // Each panel's sphere arc is a curved shell (zero thickness).  The weapon
    // rack sits inside at R*0.68.  Without side fills the left/right edges of
    // each panel look hollow when viewed from any angle.  Two quad-strip fills
    // (one per phi edge) bridge the outer arc to the rack lateral edge using the
    // same DoubleSide shellMat so the panel reads as a solid metal slab.
    const isX       = Math.abs(slideDir.x) > 0.5;
    const FSEG      = 12;
    const HALF_LAT  = 0.40;   // rack lateral half-width  (BoxGeometry 0.80 / 2)
    const HALF_HT   = 0.60;   // rack vertical half-height (BoxGeometry 1.20 / 2)
    const rackFixed = (isX ? slideDir.x : slideDir.z) * R * 0.68;

    // Which lateral side (+1 / -1) does a given phi edge fall on?
    // Three.js SphereGeometry: x = -R·sinθ·cosφ, z = R·sinθ·sinφ
    // isX panels  (left/right): lateral axis = Z → sign follows  sin(φ)
    // isZ panels  (back):       lateral axis = X → sign follows -cos(φ)
    const latSignOf = (phi) => isX ? Math.sign(Math.sin(phi)) : Math.sign(-Math.cos(phi));

    const makeSideFill = (phiEdge) => {
      const innerLat = latSignOf(phiEdge) * HALF_LAT;
      const verts = [], idx = [];
      for (let i = 0; i <= FSEG; i++) {
        const theta  = T0 + (Math.PI - 2 * T0) * (i / FSEG);
        const sinT   = Math.sin(theta), cosT = Math.cos(theta);
        const outerY = R * cosT;
        // Outer — on the sphere arc at this phi edge (matches Three.js SphereGeometry convention)
        verts.push(-R * sinT * Math.cos(phiEdge), outerY, R * sinT * Math.sin(phiEdge));
        // Inner — on the rack lateral edge, Y clamped to rack height
        const iy = Math.max(-HALF_HT, Math.min(HALF_HT, outerY));
        verts.push(isX ? rackFixed : innerLat, iy, isX ? innerLat : rackFixed);
      }
      for (let i = 0; i < FSEG; i++) {
        const a = i*2, b=a+1, c=a+2, d=a+3;
        idx.push(a,b,c, b,d,c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, shellMat);
    };

    pg.add(makeSideFill(phiStart));
    pg.add(makeSideFill(phiStart + 2 * PW));

    // ── Connecting rods (dynamic) ────────────────────────────────────────────
    // Each rod is created with unit length (1 m) along the slide axis.
    // scene3d.js scales and repositions them every frame so they always bridge
    // exactly from the sphere surface to the panel face — fully hidden inside
    // the ball when closed, perfectly connected when open.
    if (hasFeet) {
      const ROD_H = 0.072;
      const ROD_D = 0.090;
      // isX is defined above in the fill geometry section
      const slideSign = isX ? slideDir.x : slideDir.z; // −1 left/back, +1 right

      // Upper pair: individual thin rods at ±lateral
      // Lower: single wide slab centred at lat=0, spanning the full ±0.40 width.
      // The slab uses the CORNER exit-radius (lat=0.40) so its outer face never
      // protrudes through the sphere shell at the wide edges.
      const SLAB_W  = 0.84;   // lateral span of the lower slab (slightly wider than rod spread)
      const SLAB_H  = 0.10;   // slab thickness (taller than the rods for a chunky look)
      const rodDefs = [
        { y:  0.10, lat: -0.40, isSlab: false }, // upper rod  (−lateral)
        { y:  0.10, lat:  0.40, isSlab: false }, // upper rod  (+lateral)
        { y: -0.72, lat:  0,    isSlab: true  }, // lower slab (centred)
      ];

      // Conveyor-belt slab: base plate + evenly-spaced raised lateral ridges.
      // Built as a Group so syncRods can scale/position the whole thing along
      // the slide axis just like it does for a plain Mesh.
      const makeConveyorSlab = () => {
        const grp   = new THREE.Group();
        const N_RID = 7;
        const RH    = 0.048;              // ridge height above base surface
        const RT    = 0.052;              // ridge thickness (in unit-length slide space)
        const RY    = SLAB_H / 2 + RH / 2; // local Y centre of each ridge
        // Base plate
        grp.add(new THREE.Mesh(
          isX ? new THREE.BoxGeometry(1.0, SLAB_H, SLAB_W)
              : new THREE.BoxGeometry(SLAB_W, SLAB_H, 1.0),
          silverMat,
        ));
        // Lateral ridges spaced evenly across the normalised (0..1) slide length
        for (let i = 0; i < N_RID; i++) {
          const pos   = -0.5 + (i + 0.5) / N_RID;   // −0.5 … +0.5
          const ridge = new THREE.Mesh(
            isX ? new THREE.BoxGeometry(RT, RH, SLAB_W + 0.02)
                : new THREE.BoxGeometry(SLAB_W + 0.02, RH, RT),
            ridgeMat,
          );
          ridge.position.set(isX ? pos : 0, RY, isX ? 0 : pos);
          grp.add(ridge);
        }
        return grp;
      };

      const rodEntries = [];
      for (const { y, lat, isSlab } of rodDefs) {
        // Corner lat drives exit-radius so the widest point of the slab stays inset
        const exitLat    = isSlab ? 0.40 : Math.abs(lat);
        const exitRadius = Math.sqrt(Math.max(0, R * R - y * y - exitLat * exitLat));
        const bar = isSlab
          ? makeConveyorSlab()
          : new THREE.Mesh(
              isX ? new THREE.BoxGeometry(1.0, ROD_H, ROD_D)
                  : new THREE.BoxGeometry(ROD_D, ROD_H, 1.0),
              silverMat,
            );
        bar.position.set(isX ? 0 : lat, y, isX ? lat : 0);
        bar.visible = false;
        pg.add(bar);
        rodEntries.push({ mesh: bar, y, lat, exitRadius });
      }

      // Consumed by scene3d.js every render frame
      pg.userData.rodConfig = { rods: rodEntries, isX, slideSign, panelFaceDist: 1.15 };
    }

    return pg;
  }

  // Panel phi starts:
  //   Left  (-X, centre phi=0°):   phiStart = 2π-PW (wraps through 0)
  //   Right (+X, centre phi=180°): phiStart = π-PW
  //   Back  (-Z, centre phi=270°): phiStart = 3π/2-PW
  const leftPanel  = buildPanel(2 * Math.PI - PW, new THREE.Vector3(-1,  0,  0), true);
  const rightPanel = buildPanel(Math.PI       - PW, new THREE.Vector3( 1,  0,  0), true);
  const backPanel  = buildPanel(3*Math.PI/2   - PW,      new THREE.Vector3( 0,  0, -1), true);
  group.add(leftPanel);
  group.add(rightPanel);
  group.add(backPanel);

  // ── Human figure (seated, bald) ────────────────────────────────────────────
  // Built with point-to-point seg() so every limb perfectly meets its neighbours.
  // Figure faces +Z (toward player spawn at lobby far end).
  const humanGroup = new THREE.Group();
  humanGroup.position.set(0, -0.08, 0);
  humanGroup.visible = false;

  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.5, metalness: 0.75 });

  // Cylinder from point A to point B with radius r
  function seg(ax, ay, az, bx, by, bz, r, mat) {
    const a   = new THREE.Vector3(ax, ay, az);
    const b   = new THREE.Vector3(bx, by, bz);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 0.004) return;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 9), mat || skinMat);
    c.position.lerpVectors(a, b, 0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    humanGroup.add(c);
  }
  // Sphere joint
  function jnt(x, y, z, r, mat) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), mat || skinMat);
    s.position.set(x, y, z);
    humanGroup.add(s);
  }

  // ── Head ──────────────────────────────────────────────────────────────────
  jnt(0,  0.43, 0.01, 0.10, skinMat);       // head
  jnt(0,  0.475, 0,   0.097, hairMat);      // bald skullcap (darker top)
  // Subtle facial features (nose bump, brow ridge)
  jnt(0,  0.425, 0.098, 0.018, skinMat);    // nose tip
  for (const sx of [-1, 1]) {
    jnt(sx * 0.042, 0.455, 0.085, 0.014, hairMat); // brow
  }

  // ── Neck ──────────────────────────────────────────────────────────────────
  seg(0, 0.33, 0.01,   0, 0.25, 0.00,   0.036);

  // ── Torso ─────────────────────────────────────────────────────────────────
  // Collarbone / shoulder span
  seg(-0.175, 0.215, 0,   0.175, 0.215, 0,   0.036);
  // Main spine: neck-base → pelvis
  seg(0, 0.25, 0,   0, -0.175, 0.01,   0.072);
  // Hip crossbar
  seg(-0.108, -0.175, 0.01,   0.108, -0.175, 0.01,   0.048);

  // ── Left arm ──────────────────────────────────────────────────────────────
  // Shoulder joint
  jnt(-0.175, 0.215, 0,  0.044);
  // Upper arm: shoulder → elbow (arm slightly forward and down)
  seg(-0.175, 0.215, 0,   -0.225, 0.01, 0.06,   0.037);
  // Elbow joint
  jnt(-0.225, 0.01, 0.06,  0.040);
  // Forearm: elbow → hand resting on left thigh
  seg(-0.225, 0.01, 0.06,   -0.148, -0.175, 0.25,   0.030);
  // Hand
  jnt(-0.148, -0.175, 0.25,  0.036);

  // ── Right arm (mirror) ────────────────────────────────────────────────────
  jnt( 0.175, 0.215, 0,  0.044);
  seg( 0.175, 0.215, 0,    0.225, 0.01, 0.06,   0.037);
  jnt( 0.225, 0.01, 0.06,  0.040);
  seg( 0.225, 0.01, 0.06,    0.148, -0.175, 0.25,   0.030);
  jnt( 0.148, -0.175, 0.25,  0.036);

  // ── Left leg ──────────────────────────────────────────────────────────────
  // Thigh: hip → knee (nearly horizontal, forward along +Z)
  seg(-0.108, -0.175, 0.01,   -0.118, -0.215, 0.285,   0.052);
  // Knee joint
  jnt(-0.118, -0.215, 0.285,  0.054);
  // Shin: knee → ankle (drops mostly downward, shin leans back slightly)
  seg(-0.118, -0.215, 0.285,   -0.108, -0.455, 0.215,   0.039);
  // Ankle / foot
  jnt(-0.108, -0.455, 0.215,  0.038);
  {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.052, 0.14), skinMat);
    foot.position.set(-0.104, -0.478, 0.272); // centre forward of ankle so toes point +Z
    humanGroup.add(foot);
  }

  // ── Right leg (mirror) ────────────────────────────────────────────────────
  seg( 0.108, -0.175, 0.01,    0.118, -0.215, 0.285,   0.052);
  jnt( 0.118, -0.215, 0.285,  0.054);
  seg( 0.118, -0.215, 0.285,    0.108, -0.455, 0.215,   0.039);
  jnt( 0.108, -0.455, 0.215,  0.038);
  {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.052, 0.14), skinMat);
    foot.position.set( 0.104, -0.478, 0.272);
    humanGroup.add(foot);
  }

  // ── Seat pod (metal cradle under the figure) ───────────────────────────────
  const seatPod = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.06, 16), seatMat);
  seatPod.position.set(0, -0.22, 0.01);
  humanGroup.add(seatPod);
  // Connecting collar ring between pod and figure
  const podRing = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.018, 6, 20), seatMat);
  podRing.rotation.x = Math.PI / 2;
  podRing.position.set(0, -0.19, 0.01);
  humanGroup.add(podRing);

  group.add(humanGroup);

  // ── userData exposed for scene3d animation ─────────────────────────────────
  group.userData = {
    leftPanel, rightPanel, backPanel,
    humanGroup, interiorLight,
  };
  return group;
}

// ---- Gantz ball holographic display sphere ----
// Uses orthographic front-hemisphere UV so the center of the canvas always
// faces the camera (after billboarding) with near 1:1 pixel mapping.
export function buildGantzBallDisplay() {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const tex = new THREE.CanvasTexture(canvas);

  const geo = new THREE.SphereGeometry(1.22, 64, 32);
  // Remap UVs: orthographic projection of sphere normals onto XY plane.
  // Result: canvas center (0.5,0.5) = local +Z face = front facing camera.
  // Back-hemisphere vertices (nZ ≤ 0) are pushed to UV (-1,-1) — clamped by
  // ClampToEdgeWrapping to the canvas corner, which clearRect leaves fully
  // transparent.  AdditiveBlending renders transparent as no contribution, so
  // the back of the ball shows no text or UI at all.
  const nrm = geo.attributes.normal;
  const uvs = geo.attributes.uv;
  for (let i = 0; i < nrm.count; i++) {
    if (nrm.getZ(i) <= 0) {
      uvs.setXY(i, -1, -1); // off-canvas → transparent
    } else {
      uvs.setXY(i, 0.5 + 0.5 * nrm.getX(i), 0.5 + 0.5 * nrm.getY(i));
    }
  }
  uvs.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  return { mesh, canvas, tex };
}

// ---- Rooms ----
// Canonical Gantz room — cream-plaster Tokyo apartment, hardwood floor,
// cassette-AC pendant lights, reddish slatted doors, large window bank.
// Matches the anime/manga reference: empty except for the black sphere.
export function buildLobbyRoom(lobbySeed = 0) {
  const group = new THREE.Group();

  // ── Time-of-day + weather randomisation ───────────────────────────────────
  // DEV: force thunderstorm for testing — remove this line to restore random selection
  // const _FORCE = ['storm', 'thunderstorm'];
  // Weighted sky→weather pairing table.  Each entry: [skyVariant, weatherType, weight].
  const _PAIRINGS = [
    ['night',        'clear',        6],
    ['night',        'rain',         3],
    ['night',        'snow',         2],
    ['midnight',     'clear',        8],
    ['midnight',     'light_fog',    2],
    ['midnight',     'snow',         3],
    ['dawn',         'clear',        5],
    ['dawn',         'light_fog',    2],
    ['dusk',         'clear',        5],
    ['dusk',         'rain',         3],
    ['day',          'clear',        6],
    ['day',          'light_fog',    2],
    ['overcast',     'light_fog',    2],
    ['overcast',     'heavy_fog',    4],
    ['overcast',     'rain',         2],
    ['overcast',     'snow',         3],
    ['storm',        'thunderstorm', 8],
    ['blizzard_sky', 'blizzard',     8],
  ];
  const _totalW = _PAIRINGS.reduce((s, p) => s + p[2], 0);
  const _rng = mulberry32(lobbySeed);
  let _roll = _rng() * _totalW;
  let _picked = _PAIRINGS[0];
  for (const p of _PAIRINGS) { _roll -= p[2]; if (_roll <= 0) { _picked = p; break; } }
  const skyVariant  = _picked[0];
  const weatherType = _picked[1];

  // Scene background + fog base colour per sky variant
  const _BG = {
    night: 0x04050a, midnight: 0x010103, dawn: 0x12080e, dusk: 0x0e0606,
    day: 0x1a3a68, overcast: 0x0c1018, storm: 0x020408, blizzard_sky: 0x060c18,
  };
  const bgColor = _BG[skyVariant] ?? 0x04050a;

  // Fog settings per weather type  (fogColor: null = use bgColor)
  const _FOG = {
    clear:        { near: 300, far: 1200, color: null  },
    rain:         { near: 180, far:  700, color: null  },
    snow:         { near: 120, far:  500, color: null  },
    light_fog:    { near:  18, far:   90, color: 0x5a6878 },
    heavy_fog:    { near:   4, far:   22, color: 0x6e7e90 },
    blizzard:     { near:   6, far:   38, color: 0x8898b0 },
    thunderstorm: { near:  50, far:  280, color: 0x07090a },
  }[weatherType] ?? { near: 300, far: 1200, color: null };

  group.userData.skyVariant  = skyVariant;
  group.userData.weatherType = weatherType;
  group.userData.bgColor     = bgColor;
  group.userData.fogNear     = _FOG.near;
  group.userData.fogFar      = _FOG.far;
  group.userData.fogColor    = _FOG.color ?? bgColor;
  const W    = 10;   // x-span (interior width)
  const H    = 16;   // z-span (interior depth)
  const CEIL = 3.8;  // ceiling height
  const WT   = 0.15; // wall thickness

  // ---- Palette ----
  const WALL_C    = 0xe8dfc0; // warm cream plaster
  const CEIL_C    = 0xe4dbb8; // ceiling, slightly warmer
  const BEAM_C    = 0xddd4aa; // perimeter drop-beam, a shade darker
  const DOOR_C    = 0x7a3535; // reddish-brown door/frame
  const FRAME_C   = 0x4a5258; // dark charcoal aluminium window frame
  const FLOOR_A   = 0xb88040;
  const FLOOR_B   = 0xc89050;
  const FLOOR_C_  = 0xb07838;
  const FLOOR_D   = 0xbc8848;

  const plasterTex = _makePlasterTex();
  plasterTex.repeat.set(5, 3);
  const wallMat  = new THREE.MeshStandardMaterial({ map: plasterTex, color: WALL_C, roughness: 0.94 });
  const ceilMat  = new THREE.MeshStandardMaterial({ color: CEIL_C, roughness: 0.92 });
  const beamMat  = new THREE.MeshStandardMaterial({ color: BEAM_C, roughness: 0.92 });
  const doorMat  = new THREE.MeshStandardMaterial({ color: DOOR_C, roughness: 0.68 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xd8e8f0, roughness: 0.02, metalness: 0.05,
    transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: FRAME_C, roughness: 0.5, metalness: 0.55 });

  // ---- Hardwood plank floor (procedurally textured) ----
  { const floorTex = _makeLobbyFloorTex();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.001;
    floor.receiveShadow = true;
    group.add(floor); }

  // ---- Walls ----
  // Shared door constants (must match addDoor below)
  const DW = 1.25; // door width
  const DH = 2.35; // door height

  // Left (-X): wall patches with openings for two doors at z=+5.5 and z=-1.5
  {
    const LX  = -W / 2 - WT / 2;                     // wall centre x = -5.075
    const ZMN = -H / 2 - WT / 2, ZMX = H / 2 + WT / 2; // z extents: -8.075 → 8.075
    const D0Z = 5.5, D1Z = -1.5;                      // door z centres
    const wp = (z0, z1, y0 = 0, y1 = CEIL) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(WT, y1 - y0, z1 - z0), wallMat);
      m.position.set(LX, (y0 + y1) / 2, (z0 + z1) / 2);
      m.receiveShadow = true; group.add(m);
    };
    wp(ZMN,            D1Z - DW / 2);        // far end → door-1 left
    wp(D1Z + DW / 2,   D0Z - DW / 2);        // between doors
    wp(D0Z + DW / 2,   ZMX);                 // door-0 right → back end
    wp(D1Z - DW / 2,   D1Z + DW / 2, DH, CEIL); // above door 1
    wp(D0Z - DW / 2,   D0Z + DW / 2, DH, CEIL); // above door 0
  }
  // Far (-Z): wall patches with opening for one door at x=0
  {
    const FZ  = -H / 2 - WT / 2;
    const XMN = -W / 2 - WT / 2, XMX = W / 2 + WT / 2;
    const fp = (x0, x1, y0 = 0, y1 = CEIL) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, WT), wallMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, FZ);
      m.receiveShadow = true; group.add(m);
    };
    fp(XMN, -DW / 2);               // left section
    fp( DW / 2, XMX);               // right section
    fp(-DW / 2,  DW / 2, DH, CEIL); // above door
  }
  // Back (+Z): wall patches with opening for one door at x=0
  {
    const BZ  = H / 2 + WT / 2;
    const XMN = -W / 2 - WT / 2, XMX = W / 2 + WT / 2;
    const bp = (x0, x1, y0 = 0, y1 = CEIL) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, WT), wallMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, BZ);
      m.receiveShadow = true; group.add(m);
    };
    bp(XMN, -DW / 2);
    bp( DW / 2, XMX);
    bp(-DW / 2,  DW / 2, DH, CEIL);
  }

  // Right (+X) wall — solid sections around the window bank
  // Window spans z: WIN_START → WIN_END, y: WIN_SILL → WIN_TOP
  const WIN_START = -H / 2 + 1.2;  // z of window left edge  (1.2 m from far wall)
  const WIN_END   =  H / 2 - 2.2;  // z of window right edge (2.2 m from back wall)
  const WIN_SILL  = 0.07;
  const WIN_TOP   = CEIL - 0.13;
  const winSpan   = WIN_END - WIN_START;
  const winH      = WIN_TOP - WIN_SILL;

  const wallX = W / 2 + WT / 2; // centre of right-wall thickness
  const addWallPatch = (cx, cy, cz, w, h, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(cx, cy, cz); m.receiveShadow = true; group.add(m);
  };
  // End cap: z from -H/2 to WIN_START
  addWallPatch(wallX, CEIL / 2, (-H / 2 + WIN_START) / 2,
               WT, CEIL, WIN_START + H / 2);
  // End cap: z from WIN_END to +H/2
  addWallPatch(wallX, CEIL / 2, (WIN_END + H / 2) / 2,
               WT, CEIL, H / 2 - WIN_END);
  // Strip above window
  addWallPatch(wallX, WIN_TOP + (CEIL - WIN_TOP) / 2, (WIN_START + WIN_END) / 2,
               WT, CEIL - WIN_TOP, winSpan);
  // Sill strip below window
  addWallPatch(wallX, WIN_SILL / 2, (WIN_START + WIN_END) / 2,
               WT, WIN_SILL, winSpan);

  // ---- Ceiling ----
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + WT * 2, H + WT * 2), ceilMat);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = CEIL; ceil.receiveShadow = true;
  group.add(ceil);

  // Perimeter drop-beam — wide structural soffit running around all four walls.
  // The underside is a distinct warm-yellow tone like the reference photos.
  const BW = 0.68, BH = 0.32;
  const beamY = CEIL - BH / 2;
  const beamUndersideMat = new THREE.MeshStandardMaterial({ color: 0xd8cc90, roughness: 0.9 });
  [
    [new THREE.BoxGeometry(BW, BH, H),          -W / 2 + BW / 2, beamY, 0],
    [new THREE.BoxGeometry(BW, BH, H),            W / 2 - BW / 2, beamY, 0],
    [new THREE.BoxGeometry(W - BW * 2, BH, BW),  0, beamY, -H / 2 + BW / 2],
    [new THREE.BoxGeometry(W - BW * 2, BH, BW),  0, beamY,  H / 2 - BW / 2],
  ].forEach(([geo, x, y, z]) => {
    const m = new THREE.Mesh(geo, beamMat);
    m.position.set(x, y, z); group.add(m);
    // Warm yellow underside plane — matches reference photo colouring
    const uw = geo.parameters.width, ud = geo.parameters.depth;
    const u = new THREE.Mesh(new THREE.PlaneGeometry(uw, ud), beamUndersideMat);
    u.rotation.x = Math.PI / 2;
    u.position.set(x, CEIL - BH - 0.001, z);
    group.add(u);
  });

  // ---- Cassette AC unit + dome pendant lamp helper ----
  function addCassetteLight(x, z) {
    // Outer frame (dark square flush with ceiling)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.92),
      new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8 }));
    frame.position.set(x, CEIL - 0.03, z);
    group.add(frame);
    // Inner vent panel (off-white)
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.78),
      new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.7 }));
    vent.position.set(x, CEIL - 0.02, z);
    group.add(vent);
    // Suspension cord + canopy mount
    const cordLen = 0.52;
    const cordY   = CEIL - 0.06 - cordLen / 2;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, cordLen, 6),
      new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.9 }));
    cord.position.set(x, cordY, z);
    group.add(cord);
    // Wide inverted-cone shade (open at bottom, closed at top) — matches reference
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0xf0ead8, roughness: 0.55, side: THREE.DoubleSide,
    });
    const shadeH = 0.22, shadeTopR = 0.06, shadeBotR = 0.30;
    const shadeY = CEIL - 0.06 - cordLen - shadeH / 2;
    // Cone body (open cylinder with different top/bottom radii)
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(shadeTopR, shadeBotR, shadeH, 20, 1, true),
      shadeMat,
    );
    shade.position.set(x, shadeY, z);
    group.add(shade);
    // Top disc to close the cap
    const cap = new THREE.Mesh(new THREE.CircleGeometry(shadeTopR, 20), shadeMat);
    cap.rotation.x = -Math.PI / 2;
    cap.position.set(x, shadeY + shadeH / 2, z);
    group.add(cap);
    // Warm point light from the pendant
    const pl = new THREE.PointLight(0xfff8e8, 2.4, 14, 1.8);
    pl.position.set(x, shadeY - shadeH / 2, z);
    pl.castShadow = true;
    pl.shadow.mapSize.set(512, 512);
    group.add(pl);
  }

  addCassetteLight(0, -2.5);  // near the ball
  addCassetteLight(0,  4.5);  // toward the player-spawn end

  // ---- Recessed can spotlights ----
  const canMat = new THREE.MeshBasicMaterial({ color: 0xfffae8 });
  function addCan(x, z) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.065, 12), canMat);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, CEIL - 0.005, z);
    group.add(disc);
    const sl = new THREE.SpotLight(0xfff5e0, 0.9, 7, Math.PI / 7, 0.55, 1.5);
    sl.position.set(x, CEIL - 0.02, z);
    sl.target.position.set(x, 0, z);
    group.add(sl); group.add(sl.target);
  }

  for (const x of [-2.2, 2.2]) {
    for (const z of [-6, -3, 0, 3, 6]) addCan(x, z);
  }

  // ---- Reddish slatted doors ----
  // Each door: dark reddish-brown frame, animated slab on a hinge pivot.
  // Returns { pivot, openAngle } so the scene can animate the slab.
  const _lobbyDoors = [];
  function addDoor(wx, wz, rotY, openAngle) {
    const DW = 1.25;
    const DH = 2.35;
    const SLATS = 6;
    const KICK  = 0.24;     // solid kick-panel height at bottom
    const FT    = 0.055;    // frame thickness
    const STILE = 0.058;    // door stile (side rail) width
    const DT    = 0.052;    // door slab depth

    const dg = new THREE.Group();

    const slatMat = new THREE.MeshStandardMaterial({
      color: 0xc8d0d4, roughness: 0.1, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    });

    // ── Static frame (jambs + header) ────────────────────────────────────────
    const jambMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6 });
    const jbox = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), jambMat);
      m.position.set(x, y, z); dg.add(m);
    };
    jbox(DW + FT * 2, FT,       DT + 0.02,  0,                  DH + FT / 2, 0);
    jbox(FT,          DH + FT,  DT + 0.02, -(DW / 2 + FT / 2),  DH / 2,      0);
    jbox(FT,          DH + FT,  DT + 0.02,  (DW / 2 + FT / 2),  DH / 2,      0);

    // ── Animated slab — pivot sits at hinge edge (local x = -DW/2) ───────────
    // All slab geometry is shifted +DW/2 in x so it's centred in the opening
    // when the pivot is at x=-DW/2.  Rotating the pivot swings the slab open.
    const slabPivot = new THREE.Group();
    slabPivot.position.set(-DW / 2, 0, 0);
    dg.add(slabPivot);

    const sbox = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), doorMat);
      m.position.set(x + DW / 2, y, z); m.castShadow = true; slabPivot.add(m);
    };

    // Kick panel (solid)
    sbox(DW - FT, KICK, DT, 0, KICK / 2, 0);
    // Door stiles (left & right vertical rails)
    sbox(STILE, DH - KICK, DT, -(DW / 2 - STILE / 2), KICK + (DH - KICK) / 2, 0);
    sbox(STILE, DH - KICK, DT,  (DW / 2 - STILE / 2), KICK + (DH - KICK) / 2, 0);
    // Top rail of door slab
    sbox(DW - FT, FT, DT, 0, DH - FT / 2, 0);

    // Glass slats + horizontal rails between them
    const slatSection = DH - KICK - FT;
    const slatH = slatSection / SLATS;
    for (let s = 0; s < SLATS; s++) {
      const sy = KICK + slatH * s + slatH / 2;
      const gp = new THREE.Mesh(
        new THREE.BoxGeometry(DW - STILE * 2 - 0.02, slatH - 0.038, 0.018),
        slatMat,
      );
      gp.position.set(DW / 2, sy, 0);
      slabPivot.add(gp);
      if (s > 0) sbox(DW - FT * 0.5, 0.038, DT, 0, KICK + slatH * s, 0);
    }

    // Door handle: lever-style pull on the latch side
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.25, metalness: 0.75 });
    const handleX = DW / 2 - STILE * 0.7; // near the latch edge (right side)
    for (const side of [-1, 1]) {
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.095, 8), handleMat);
      lever.rotation.x = Math.PI / 2;
      lever.position.set(handleX + DW / 2, 1.02, side * (DT / 2 + 0.05));
      slabPivot.add(lever);
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10), handleMat);
      rose.rotation.x = Math.PI / 2;
      rose.position.set(handleX + DW / 2, 1.02, side * (DT / 2 + 0.006));
      slabPivot.add(rose);
    }

    dg.position.set(wx, 0, wz);
    dg.rotation.y = rotY;
    group.add(dg);

    const doorEntry = { pivot: slabPivot, openAngle };
    _lobbyDoors.push(doorEntry);
    return doorEntry;
  }

  // Left wall (-X = -5): two doors
  //   rotY = π/2  → local +x = world -z; slab hinge on far-Z side.
  //   openAngle = -0.8π → slab swings 144° toward world +x (into lobby). ✓
  addDoor(-W / 2, +5.5,  Math.PI / 2, -Math.PI * 0.8);  // door 0 (Bedroom)
  addDoor(-W / 2, -1.5,  Math.PI / 2, -Math.PI * 0.8);  // door 1 (Bathroom)

  // Far wall (-Z = -8): rotY=0 → local = world.
  //   openAngle < 0 → slab right side swings toward world +z (into lobby). ✓
  addDoor(0, -H / 2, 0, -Math.PI * 0.8);          // door 2 (Kitchen)

  // Back wall (+Z = +8): rotY=π → local +x = world -x.
  //   openAngle < 0 → slab right side swings toward world -z (into lobby). ✓
  addDoor(0,  H / 2, Math.PI, -Math.PI * 0.8);    // door 3 (Hallway)

  // Expose door pivot array for scene3d
  group.userData.doors = _lobbyDoors;

  // ---- Adjacent rooms --------------------------------------------------------
  // Rooms use the same lobby materials (wallMat = cream plaster, ceilMat).
  // Floor: warm hardwood tone matching the lobby floor colour.
  const adjFloorMat = new THREE.MeshStandardMaterial({ color: 0xc09060, roughness: 0.84 });
  const ADJ_FT = 0.12; // floor/ceiling slab thickness

  // Open-face must sit at the lobby wall OUTER face so no room geometry clips
  // into the lobby.  Outer faces: left X = -(W/2+WT) = -5.15, far/back Z = ±(H/2+WT) = ±8.15.
  const RW_OUTER = W / 2 + WT;  // 5.15
  const RH_OUTER = H / 2 + WT;  // 8.15

  function addAdjRoom(cx, cz, rw, rd, openSide, floorMat) {
    // cx,cz = room centre in 3D world.
    // rw = room width (X), rd = room depth (Z).
    // openSide: 'maxX'|'minX'|'maxZ'|'minZ' — wall facing the lobby (not built).
    // floorMat: MeshStandardMaterial for this room's floor (unique per room).
    // Floor and ceiling extend by WT on the open side so they reach the lobby
    // inner wall face, sealing the floor gap under the lobby wall thickness.
    // Shift floor/ceiling toward the lobby (open) side by WT so they cover the
    // gap under the lobby wall thickness and reach the lobby inner wall face.
    // Rule: shift center in the direction of the open face (+x for maxX, etc.)
    let fx = cx, fz = cz, frw = rw, frd = rd;
    if (openSide === 'maxX') { frw += WT; fx += WT / 2; }
    if (openSide === 'minX') { frw += WT; fx -= WT / 2; }
    if (openSide === 'maxZ') { frd += WT; fz += WT / 2; }
    if (openSide === 'minZ') { frd += WT; fz -= WT / 2; }

    // Floor — top surface at y=0.001 to match lobby hardwood floor level
    const floorY = 0.001 - ADJ_FT / 2;
    { const m = new THREE.Mesh(new THREE.BoxGeometry(frw, ADJ_FT, frd), floorMat || adjFloorMat);
      m.position.set(fx, floorY, fz); m.receiveShadow = true; group.add(m); }
    // Ceiling
    { const m = new THREE.Mesh(new THREE.BoxGeometry(frw, ADJ_FT, frd), ceilMat);
      m.position.set(fx, CEIL + ADJ_FT / 2, fz); group.add(m); }

    // Walls — match lobby: same wallMat (cream plaster with texture), skip open side
    const wdefs = [
      // [geom_w, geom_h, geom_d, px, py, pz, skip_if]
      [WT, CEIL, rd, cx - rw / 2, CEIL / 2, cz,        'minX'],
      [WT, CEIL, rd, cx + rw / 2, CEIL / 2, cz,        'maxX'],
      [rw, CEIL, WT, cx,          CEIL / 2, cz - rd / 2, 'minZ'],
      [rw, CEIL, WT, cx,          CEIL / 2, cz + rd / 2, 'maxZ'],
    ];
    for (const [gw, gh, gd, px, py, pz, skip] of wdefs) {
      if (skip === openSide) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), wallMat);
      m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }

    // ---- Cap walls: close portions of the open face that extend beyond lobby ----
    // The lobby wall covers the adj room's open face only within the lobby's own
    // wall span.  If the room extends past the lobby extents (e.g. bedroom north
    // end juts past the lobby back wall), that strip has no geometry — plug it.
    const lobbyZMin = -H / 2 - WT / 2;  // -8.075
    const lobbyZMax =  H / 2 + WT / 2;  //  +8.075
    const lobbyXMin = -W / 2 - WT / 2;  // -5.075
    const lobbyXMax =  W / 2 + WT / 2;  //  +5.075

    // Helper: add a thin wall panel along Z (for openSide maxX/minX cases)
    const capZ = (fx, z0, z1) => {
      if (z1 - z0 < 0.001) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(WT, CEIL, z1 - z0), wallMat);
      m.position.set(fx, CEIL / 2, (z0 + z1) / 2);
      m.castShadow = true; m.receiveShadow = true; group.add(m);
    };
    // Helper: add a thin wall panel along X (for openSide maxZ/minZ cases)
    const capX = (x0, x1, fz) => {
      if (x1 - x0 < 0.001) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, CEIL, WT), wallMat);
      m.position.set((x0 + x1) / 2, CEIL / 2, fz);
      m.castShadow = true; m.receiveShadow = true; group.add(m);
    };

    const roomZMin = cz - rd / 2, roomZMax = cz + rd / 2;
    const roomXMin = cx - rw / 2, roomXMax = cx + rw / 2;

    if (openSide === 'maxX') {
      const fx = cx + rw / 2;
      capZ(fx, roomZMin, Math.min(roomZMax, lobbyZMin)); // south overhang (below lobby)
      capZ(fx, Math.max(roomZMin, lobbyZMax), roomZMax); // north overhang (above lobby)
    } else if (openSide === 'minX') {
      const fx = cx - rw / 2;
      capZ(fx, roomZMin, Math.min(roomZMax, lobbyZMin));
      capZ(fx, Math.max(roomZMin, lobbyZMax), roomZMax);
    } else if (openSide === 'maxZ') {
      const fz = cz + rd / 2;
      capX(roomXMin, Math.min(roomXMax, lobbyXMin), fz); // left overhang
      capX(Math.max(roomXMin, lobbyXMax), roomXMax, fz); // right overhang
    } else if (openSide === 'minZ') {
      const fz = cz - rd / 2;
      capX(roomXMin, Math.min(roomXMax, lobbyXMin), fz);
      capX(Math.max(roomXMin, lobbyXMax), roomXMax, fz);
    }

    // Warm pendant light
    const apl = new THREE.PointLight(0xfff5e0, 1.6, 8, 1.8);
    apl.position.set(cx, CEIL - 0.3, cz);
    group.add(apl);
  }

  // ---- Per-room floor materials ------------------------------------------------
  // Bedroom — short-pile carpet (slate-blue, woven grid)
  const bedroomFloorTex = _makeCaretTex();
  bedroomFloorTex.repeat.set(4.5, 5.5);   // ~0.6m per canvas repeat → fine carpet weave
  const bedroomFloorMat = new THREE.MeshStandardMaterial({ map: bedroomFloorTex, roughness: 0.95 });

  // Bathroom — small ceramic square tiles with grey grout
  const bathroomFloorTex = _makeTileTex();
  bathroomFloorTex.repeat.set(1.5, 1.5);  // ~26cm tiles across 5m room
  const bathroomFloorMat = new THREE.MeshStandardMaterial({ map: bathroomFloorTex, roughness: 0.08, metalness: 0.05 });

  // Kitchen — black-and-cream checkerboard vinyl
  const kitchenFloorTex = _makeCheckerTex();
  kitchenFloorTex.repeat.set(2.0, 1.5);   // ~31cm checker squares
  const kitchenFloorMat = new THREE.MeshStandardMaterial({ map: kitchenFloorTex, roughness: 0.55 });

  // Hallway — herringbone parquet (warm amber)
  const hallwayFloorTex = _makeParquetTex();
  hallwayFloorTex.repeat.set(2.5, 2.0);   // compact parquet planks
  const hallwayFloorMat = new THREE.MeshStandardMaterial({ map: hallwayFloorTex, roughness: 0.80 });

  // Room sizes and positions — must match adj room colliders in lobby.js.
  // Bedroom  (door 0 at z=+5.5, left wall): rw=5.5, rd=7.0
  //   cx = -(RW_OUTER + rw/2) = -(5.15 + 2.75) = -7.9
  addAdjRoom(-(RW_OUTER + 5.5 / 2),  5.5, 5.5, 7.0, 'maxX', bedroomFloorMat);
  // Bathroom (door 1 at z=-1.5, left wall): rw=5.0, rd=5.0
  //   cx = -(RW_OUTER + rw/2) = -(5.15 + 2.5)  = -7.65
  addAdjRoom(-(RW_OUTER + 5.0 / 2), -1.5, 5.0, 5.0, 'maxX', bathroomFloorMat);
  // Kitchen  (door 2 at x=0, far wall): rw=5.0, rd=4.0
  //   cz = -(RH_OUTER + rd/2) = -(8.15 + 2.0)  = -10.15
  addAdjRoom(0, -(RH_OUTER + 4.0 / 2), 5.0, 4.0, 'maxZ', kitchenFloorMat);
  // Hallway  (door 3 at x=0, back wall): rw=5.0, rd=4.0
  //   cz =  (RH_OUTER + rd/2) =  (8.15 + 2.0)  = +10.15
  addAdjRoom(0,  (RH_OUTER + 4.0 / 2), 5.0, 4.0, 'minZ', hallwayFloorMat);

  // ---- Jam Portal (hallway back wall) ----------------------------------------
  // Positioned on the inner face of the hallway's far (+Z) wall, centred on X.
  // The hallway far wall is at z = RH_OUTER + 4.0 - WT/2 = 12.075 (inner face).
  {
    const HW_CZ   = RH_OUTER + 4.0 / 2;   // hallway centre z = 10.15
    const HW_BZ   = HW_CZ + 4.0 / 2;      // hallway far-wall centre z = 12.15
    const PZ      = HW_BZ - WT / 2 - 0.01; // portal plane: just inside the inner wall face
    const PW_W    = 1.8;   // portal opening width
    const PW_H    = 2.8;   // portal opening height
    const PW_BOT  = 0.0;   // bottom Y (flush with floor)
    const PW_MID  = PW_BOT + PW_H / 2;    // 1.4

    // Frame — dark gunmetal bars flush against the wall
    const FT = 0.06;  // bar thickness
    const FD = 0.08;  // bar depth (protrusion from wall)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.25, metalness: 0.92 });
    // Horizontal bars
    const hBar = (y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(PW_W + FT * 2, FT, FD), frameMat);
      m.position.set(0, y, PZ); m.castShadow = true; group.add(m);
    };
    hBar(PW_BOT + FT / 2);          // bottom
    hBar(PW_BOT + PW_H - FT / 2);   // top
    // Vertical bars
    const vBar = (x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(FT, PW_H, FD), frameMat);
      m.position.set(x, PW_MID, PZ); m.castShadow = true; group.add(m);
    };
    vBar(-PW_W / 2 - FT / 2);  // left
    vBar( PW_W / 2 + FT / 2);  // right

    // Portal surface — animated shimmer plane; faces -Z (toward player approaching)
    const portalSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(PW_W, PW_H),
      new THREE.MeshBasicMaterial({ color: 0x00eeff, transparent: true, opacity: 0.82, side: THREE.FrontSide }),
    );
    portalSurface.rotation.y = Math.PI;   // face toward -Z (lobby direction)
    portalSurface.position.set(0, PW_MID, PZ);
    group.add(portalSurface);

    // Glow light — pulses with portal animation
    const portalLight = new THREE.PointLight(0x00eeff, 2.2, 7, 2);
    portalLight.position.set(0, PW_MID, PZ - 0.5);
    group.add(portalLight);

    group.userData.portalSurface = portalSurface;
    group.userData.portalLight   = portalLight;

    // Sign above the portal frame
    {
      const SW = PW_W + FT * 2;   // sign width  (matches frame outer width)
      const SH = 0.38;             // sign height in metres
      const SY = PW_BOT + PW_H + FT + SH / 2 + 0.06;  // just above top bar (~3.10 m)

      // Canvas texture — dark panel, cyan text to match portal
      const sc = document.createElement('canvas');
      sc.width = 512; sc.height = 128;
      const sx = sc.getContext('2d');
      // Background
      sx.fillStyle = '#05060e';
      sx.fillRect(0, 0, 512, 128);
      // Outer border
      sx.strokeStyle = '#00ccdd'; sx.lineWidth = 4;
      sx.strokeRect(3, 3, 506, 122);
      // Inner border
      sx.strokeStyle = '#003344'; sx.lineWidth = 2;
      sx.strokeRect(9, 9, 494, 110);
      // Text — two passes: glow then solid
      sx.font = 'bold 54px monospace';
      sx.textAlign = 'center'; sx.textBaseline = 'middle';
      sx.fillStyle = 'rgba(0,220,255,0.25)';
      for (let g = 0; g < 3; g++) sx.fillText('JAM LOBBY', 256, 64);  // soft glow build-up
      sx.fillStyle = '#00eeff';
      sx.fillText('JAM LOBBY', 256, 64);

      const signTex = new THREE.CanvasTexture(sc);
      // Note: rotation.y = Math.PI does NOT flip PlaneGeometry UVs — no repeat trick needed.

      // Backing plate — protrudes INTO the room (toward -Z from wall face at PZ).
      // Depth = 0.06 m, centre at PZ - 0.03 → back face at PZ (against wall),
      // front face at PZ - 0.06. No wall clipping, no z-fighting with sign plane.
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x05060e, roughness: 0.28, metalness: 0.90 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(SW + 0.05, SH + 0.05, 0.06), plateMat);
      plate.position.set(0, SY, PZ - 0.03);
      group.add(plate);
      // Sign face plane — 8 mm in front of the plate front face (PZ - 0.06)
      const signMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(SW, SH),
        new THREE.MeshBasicMaterial({ map: signTex, side: THREE.FrontSide }),
      );
      signMesh.rotation.y = Math.PI;  // face toward -Z (toward approaching player)
      signMesh.position.set(0, SY, PZ - 0.068);
      group.add(signMesh);
    }
  }

  // ---- Structural RC pilasters ----
  // Rectangular columns protruding from walls — very visible in the reference photos.
  const pilMat = new THREE.MeshStandardMaterial({ color: WALL_C, roughness: 0.94 });
  const PILW = 0.30; // pilaster width along the wall face
  const PILD = 0.14; // protrusion depth into the room
  // Left wall (-X): two pilasters between the door positions
  for (const pz of [-4.5, +2.5]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(PILD, CEIL, PILW), pilMat);
    m.position.set(-W / 2 + PILD / 2, CEIL / 2, pz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  // Far wall (-Z): pilasters flanking the two doors
  for (const px of [-3.8, 3.8]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(PILW, CEIL, PILD), pilMat);
    m.position.set(px, CEIL / 2, -H / 2 + PILD / 2);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  // Back wall (+Z): pilasters flanking the door
  for (const px of [-3.8, 3.8]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(PILW, CEIL, PILD), pilMat);
    m.position.set(px, CEIL / 2, H / 2 - PILD / 2);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  // Right wall (+X): one structural column breaking the window bank
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(PILD, CEIL, PILW), pilMat);
    m.position.set(W / 2 - PILD / 2, CEIL / 2, -2.5);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }

  // ---- Baseboard skirting ----
  // Dark grey strip at the base of every wall — clearly visible in reference photos.
  const bbMat = new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.8 });
  const bbH = 0.09, bbT = 0.03;
  // Left wall
  { const m = new THREE.Mesh(new THREE.BoxGeometry(bbT, bbH, H), bbMat);
    m.position.set(-W / 2 + bbT / 2, bbH / 2, 0); group.add(m); }
  // Far wall
  { const m = new THREE.Mesh(new THREE.BoxGeometry(W, bbH, bbT), bbMat);
    m.position.set(0, bbH / 2, -H / 2 + bbT / 2); group.add(m); }
  // Back wall
  { const m = new THREE.Mesh(new THREE.BoxGeometry(W, bbH, bbT), bbMat);
    m.position.set(0, bbH / 2, H / 2 - bbT / 2); group.add(m); }
  // Right wall — end caps only (no baseboard across glass)
  { const d = WIN_START + H / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bbT, bbH, d), bbMat);
    m.position.set(W / 2 - bbT / 2, bbH / 2, (-H / 2 + WIN_START) / 2); group.add(m); }
  { const d = H / 2 - WIN_END;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bbT, bbH, d), bbMat);
    m.position.set(W / 2 - bbT / 2, bbH / 2, (WIN_END + H / 2) / 2); group.add(m); }

  // ---- Smoke detector on ceiling ----
  { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.6 }));
    m.position.set(-1.5, CEIL - 0.015, 1.0); group.add(m); }

  // ---- Large window bank on right wall (+X = +5) ----
  // 7 panes of ~1.7 m each, nearly floor-to-ceiling, aluminium grid frames.
  const midZ     = (WIN_START + WIN_END) / 2;
  group.userData._midZ = midZ; // needed by scene3d for thunderstorm lightning positioning
  const paneCount = 7;
  const paneSpan  = winSpan / paneCount; // ~1.7 m

  // Frame built on the interior wall face (x = W/2) so it's flush from inside.
  // Frames are flat rectangles (very thin in X), visible from -X direction.
  const FX = W / 2; // x position of the window plane

  // Outer border rails
  const mkFrame = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(x, y, z); group.add(m);
  };
  mkFrame(0.06, winH + 0.06, 0.06, FX, WIN_SILL + winH / 2, WIN_START);   // left outer jamb
  mkFrame(0.06, winH + 0.06, 0.06, FX, WIN_SILL + winH / 2, WIN_END);     // right outer jamb
  mkFrame(0.06, 0.06, winSpan + 0.06, FX, WIN_TOP,  midZ);                 // top rail
  mkFrame(0.06, 0.06, winSpan + 0.06, FX, WIN_SILL, midZ);                 // bottom rail

  for (let i = 0; i < paneCount; i++) {
    const pz = WIN_START + paneSpan * (i + 0.5);

    // Glass pane — slightly inside room so z-ordering is clean
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(paneSpan - 0.065, winH - 0.065),
      glassMat,
    );
    pane.rotation.y = -Math.PI / 2;
    pane.position.set(FX - 0.01, WIN_SILL + winH / 2, pz);
    group.add(pane);

    // Inner vertical dividers (between panes, not at the outer edges)
    if (i > 0) mkFrame(0.06, winH, 0.06, FX, WIN_SILL + winH / 2, WIN_START + paneSpan * i);

    // Horizontal mid-rail (two rows of glass per pane like the reference)
    mkFrame(0.06, 0.06, paneSpan - 0.065, FX, WIN_SILL + winH * 0.52, pz);
  }

  // ---- Exterior: balcony railing + high-rise Tokyo cityscape ----
  // The apartment is high up — street level is STREET_Y below room floor (y=0).
  const STREET_Y = -35;
  const extX     = W / 2 + 0.70; // front railing — pulled slightly in from slab edge
  const sideLen  = extX - W / 2;  // depth of the side return rails (wall → front railing)
  const sideCX   = W / 2 + sideLen / 2; // centre X of side rails
  const skyX     = W / 2 + 20;

  // Balcony slab — matches window span exactly
  { const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, winSpan),
      new THREE.MeshStandardMaterial({ color: 0xb0a890, roughness: 0.9 }));
    m.position.set(W / 2 + 0.45, -0.07, midZ); group.add(m); }

  // ── Front railing (parallel to wall, window span) ──
  { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, winSpan), frameMat);
    m.position.set(extX, 1.08, midZ); group.add(m); }
  { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, winSpan), frameMat);
    m.position.set(extX, 0.12, midZ); group.add(m); }
  for (let rz = WIN_START; rz <= WIN_END + 0.01; rz += 0.12) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.96, 0.015), frameMat);
    b.position.set(extX, 0.6, rz); group.add(b);
  }

  // ── Side return rails — connect front railing back to the lobby wall at each end ──
  for (const sz of [WIN_START, WIN_END]) {
    // Top rail
    { const m = new THREE.Mesh(new THREE.BoxGeometry(sideLen, 0.05, 0.06), frameMat);
      m.position.set(sideCX, 1.08, sz); group.add(m); }
    // Bottom rail
    { const m = new THREE.Mesh(new THREE.BoxGeometry(sideLen, 0.05, 0.06), frameMat);
      m.position.set(sideCX, 0.12, sz); group.add(m); }
    // Balusters along the depth
    for (let rx = W / 2 + 0.12; rx < extX; rx += 0.12) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.96, 0.015), frameMat);
      b.position.set(rx, 0.6, sz); group.add(b);
    }
  }

  // Sky sphere — large inverted sphere surrounds the entire scene
  { const skyTex = _makeSkyTex(skyVariant);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), skyMat);
    group.userData.skyMat = skyMat; // exposed for lightning flash
    group.add(sky); }

  // Street / ground — covers full building footprint (X: window→far buildings, Z: full spread)
  { const gt = _makeCityGroundTex();
    gt.repeat.set(18, 60);
    const groundW = 160, groundD = 520;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(groundW, groundD),
      new THREE.MeshStandardMaterial({ map: gt, roughness: 1.0, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(W / 2 + groundW / 2, STREET_Y, midZ); group.add(m); }

  // Buildings with window textures — two depth layers for parallax
  const brng = _mkRng(0x7a3bc1d2);
  const FLOOR_H = 3.2;
  const GAP = 4.0; // minimum separation between buildings
  const placed = []; // {x0,x1,z0,z1}
  const canPlace = (x0, x1, z0, z1) => {
    for (const p of placed) {
      if (x0 < p.x1 + GAP && x1 > p.x0 - GAP && z0 < p.z1 + GAP && z1 > p.z0 - GAP) return false;
    }
    return true;
  };

  for (let b = 0; b < 160; b++) {
    const layer = b < 55 ? 0 : b < 110 ? 1 : 2;
    const bw = [6.0, 8.0, 10.0][layer] + brng() * [8.0, 10.0, 12.0][layer];
    const bh = [14,  18,  22][layer]  + brng() * [50,  60,  70][layer];
    const bd = [5.0, 7.0, 9.0][layer] + brng() * 8.0;
    const spread = [160, 200, 240][layer]; // extend far beyond window in both Z directions
    const xBase  = [W / 2 + 14, W / 2 + 32, W / 2 + 54][layer];
    const xRange = [18, 22, 32][layer];

    let bx = 0, bz = 0, ok = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      const tx = xBase  + brng() * xRange;
      const tz = midZ - spread + brng() * spread * 2;
      if (canPlace(tx - bd / 2, tx + bd / 2, tz - bw / 2, tz + bw / 2)) {
        bx = tx; bz = tz; ok = true; break;
      }
    }
    if (!ok) continue;

    placed.push({ x0: bx - bd / 2, x1: bx + bd / 2, z0: bz - bw / 2, z1: bz + bw / 2 });

    const floors = Math.max(3, (bh / FLOOR_H) | 0);
    const tex    = _makeBuildingTex(b * 179 + 0x3f1a, floors, bw);

    const sideMat = new THREE.MeshBasicMaterial({ color: 0x060a0e });
    const roofMat = new THREE.MeshBasicMaterial({ color: 0x0c1018 });
    const winFace = new THREE.MeshBasicMaterial({ map: tex });
    const bldg = new THREE.Mesh(
      new THREE.BoxGeometry(bd, bh, bw),
      [sideMat, winFace, roofMat, sideMat, winFace, winFace],
    );
    bldg.position.set(bx, STREET_Y + bh / 2, bz);
    group.add(bldg);
  }


  // ---- Lighting (variant-aware) ----
  // Each sky variant has its own city-glow, key-light, and fill colours.
  const _L = {
    night:       { glow: 0xff8820, glowI: 0.45, blue: 0x2255cc, blueI: 0.20, sun: 0xfff0d8, sunI: 0.65, fill: 0xd0e8f8, fillI: 0.40 },
    midnight:    { glow: 0xff7010, glowI: 0.30, blue: 0x1840aa, blueI: 0.16, sun: 0xd8e8ff, sunI: 0.38, fill: 0x182858, fillI: 0.22 },
    dawn:        { glow: 0xff5030, glowI: 0.20, blue: 0x9050c0, blueI: 0.14, sun: 0xffa060, sunI: 0.95, fill: 0xffb878, fillI: 0.55 },
    dusk:        { glow: 0xff4010, glowI: 0.55, blue: 0x5020a0, blueI: 0.22, sun: 0xff6020, sunI: 1.00, fill: 0xff8040, fillI: 0.48 },
    day:         { glow: 0xffaa50, glowI: 0.06, blue: 0x60a0e0, blueI: 0.14, sun: 0xfff8e0, sunI: 2.20, fill: 0xa0c8f0, fillI: 0.90 },
    overcast:    { glow: 0xff8840, glowI: 0.18, blue: 0x5880cc, blueI: 0.38, sun: 0xc8d8f0, sunI: 0.35, fill: 0xa8c4e0, fillI: 0.65 },
    storm:       { glow: 0x402808, glowI: 0.12, blue: 0x0a180a, blueI: 0.10, sun: 0x182010, sunI: 0.18, fill: 0x080c04, fillI: 0.28 },
    blizzard_sky:{ glow: 0xf08030, glowI: 0.20, blue: 0x4070b0, blueI: 0.32, sun: 0xa8c0d8, sunI: 0.42, fill: 0xb0c8e0, fillI: 0.58 },
  }[skyVariant] ?? { glow: 0xff8820, glowI: 0.45, blue: 0x2255cc, blueI: 0.20, sun: 0xfff0d8, sunI: 0.65, fill: 0xd0e8f8, fillI: 0.40 };

  const cityGlow = new THREE.PointLight(_L.glow, _L.glowI, 50, 1.6);
  cityGlow.position.set(W / 2 + 10, STREET_Y + 8, midZ);
  group.add(cityGlow);

  const cityBlue = new THREE.PointLight(_L.blue, _L.blueI, 40, 2.0);
  cityBlue.position.set(W / 2 + 8, 4, midZ - 4);
  group.add(cityBlue);

  const sun = new THREE.DirectionalLight(_L.sun, _L.sunI);
  sun.position.set(W / 2 + 12, 16, -4);
  sun.target.position.set(-2, 0, 0);
  sun.castShadow = false;
  group.add(sun); group.add(sun.target);

  const skyFill = new THREE.PointLight(_L.fill, _L.fillI, 18, 1.4);
  skyFill.position.set(W / 2, 1.8, midZ);
  group.add(skyFill);

  // ---- Weather particles ----
  const weatherGroup = _makeWeatherParticles(weatherType, W, midZ, winSpan, STREET_Y);
  if (weatherGroup) {
    group.add(weatherGroup);
    group.userData.weatherGroup = weatherGroup;
  }

  return group;
}

export function buildMissionRoom(missionMap) {
  const group = new THREE.Group();
  const B = { minX: -20, maxX: 20, minY: -20, maxY: 20 };
  const W = B.maxX - B.minX, H = B.maxY - B.minY;

  // pavement
  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshStandardMaterial({ color: 0x2e2e3a, roughness: 0.9 }),
  );
  pavement.rotation.x = -Math.PI / 2;
  pavement.receiveShadow = true;
  group.add(pavement);

  // center road
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(8, H),
    new THREE.MeshStandardMaterial({ color: 0x1c1c28, roughness: 0.88 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.005;
  group.add(road);

  // lane dashes
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf8e6a0, transparent: true, opacity: 0.55 });
  for (let z = B.minY + 1; z < B.maxY; z += 1.6) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.8), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.015, z);
    group.add(dash);
  }

  // sky box / night tone
  group.background = new THREE.Color(0x0a0b14);

  // ---- Mission Lighting ----
  // Moonlight / sky key — cool blue-white from above
  const moon = new THREE.DirectionalLight(0xd0e8ff, 2.8);
  moon.position.set(-10, 28, -8);
  moon.castShadow = false;
  group.add(moon);

  // Street-lamp orange glow across the whole arena
  const streetWarm = new THREE.PointLight(0xffa040, 3.5, 80, 1.2);
  streetWarm.position.set(0, 8, 0);
  group.add(streetWarm);

  // Cool city-sky bounce from above
  const skyBounce = new THREE.HemisphereLight(0x2a4488, 0x181820, 1.4);
  group.add(skyBounce);

  // Four corner fills so no corner is pitch-black
  const cornerFills = [
    [B.minX + 4, 4, B.minY + 4],
    [B.maxX - 4, 4, B.minY + 4],
    [B.minX + 4, 4, B.maxY - 4],
    [B.maxX - 4, 4, B.maxY - 4],
  ];
  for (const [cx, cy, cz] of cornerFills) {
    const cf = new THREE.PointLight(0xffc880, 1.6, 28, 1.4);
    cf.position.set(cx, cy, cz);
    group.add(cf);
  }

  // boundary pulse rails (four edge lines)
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xc8142b, transparent: true, opacity: 0.4 });
  for (const [x1, z1, x2, z2] of [
    [B.minX, B.minY, B.maxX, B.minY],
    [B.minX, B.maxY, B.maxX, B.maxY],
    [B.minX, B.minY, B.minX, B.maxY],
    [B.maxX, B.minY, B.maxX, B.maxY],
  ]) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), edgeMat);
    m.position.set((x1 + x2) / 2, 0.05, (z1 + z2) / 2);
    if (z1 !== z2) m.rotation.y = Math.PI / 2;
    group.add(m);
  }
  group.userData.edgeMat = edgeMat;

  return group;
}

// ---- Tracer ----
export function buildTracerMesh(x1, z1, x2, z2, colorHex) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.max(0.01, Math.hypot(dx, dz));
  const geom = new THREE.BoxGeometry(len, 0.06, 0.06);
  const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 });
  const m = new THREE.Mesh(geom, mat);
  m.position.set((x1 + x2) / 2, 1.0, (z1 + z2) / 2);
  m.rotation.y = -Math.atan2(dz, dx);
  m.userData.mat = mat;
  return m;
}
