// ─── Gantz Neural HUD driver ─────────────────────────────────────────────
//
// Runs the new first-person-visor / third-person HUD. Element layout is in
// index.html (`#gz-hud`) and style is in style.css.
//
//   initGantzHud({ drawAlienPortrait })    — once at startup
//   tickGantzHud(snapshot, dt)             — every frame
//   gantzHudOnFire({ kind })                — when player pulls the trigger
//   gantzHudOnPoints(delta, source)         — when local points change
//   gantzHudTransmission(lines, opts)       — show transmission banner
//   gantzHudAmbient(line)                   — push line into ambient terminal
//   setGantzHudView('fps' | 'tps')          — mode swap (plays warp anim)
//   setGantzHudActive(bool)                 — show/hide the whole overlay
//
// The snapshot is the only per-frame input; everything else is edge-triggered.

let _el = {};
let _drawAlienPortrait = null;
let _view = 'fps';
let _active = false;

// Points counter tween
let _pointsDisplayed = 0;
let _pointsTargetPrev = 0;
let _pointsLastTickAt = 0;

// Chrono jitter gate
let _chronoLastSecond = -1;

// Transmission banner state
let _tx = { queue: [], text: '', shownIdx: 0, lastCharAt: 0, state: 'idle', hideAt: 0, lastTriggerAt: 0 };

// Ambient terminal state
let _amb = { queue: [], current: '', lastPushAt: 0 };

// Radar state
let _radarSweepA = 0;

// Click SFX (synthesized via Web Audio — no asset needed)
let _audioCtx = null;
function _clickCtx() {
  if (_audioCtx) return _audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _audioCtx = new AC();
  } catch { return null; }
  return _audioCtx;
}
function _clickOnce(freq = 420, vol = 0.08, dur = 0.018) {
  const ctx = _clickCtx();
  if (!ctx || ctx.state === 'suspended') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

export function initGantzHud(opts = {}) {
  _drawAlienPortrait = opts.drawAlienPortrait || null;
  const ids = [
    'gz-hud', 'gz-ident-name', 'gz-ident-phase', 'gz-ident-peers',
    'gz-chrono-digits', 'gz-chrono-centi', 'gz-chrono-mod',
    'gz-tx', 'gz-tx-body', 'gz-tx-id',
    'gz-dossier-portrait', 'gz-dossier-name', 'gz-dossier-count',
    'gz-dossier-threat-fill', 'gz-dossier-status',
    'gz-radar-canvas', 'gz-radar-scale', 'gz-ambient',
    'gz-points-value', 'gz-points-delta',
    'gz-weapon-name', 'gz-weapon-state', 'gz-weapon-bar-fill',
    'gz-health-bar-fill', 'gz-health-value',
    'gz-reticle', 'gz-reticle-label', 'gz-screen-flash', 'gz-screen-edge',
    'gz-world-badges',
  ];
  for (const id of ids) _el[id] = document.getElementById(id);
  _el['gz-chrono'] = _el['gz-chrono-digits']?.closest('.gz-chrono');
  _el['gz-weapon-bar'] = _el['gz-weapon-bar-fill']?.parentElement;
  _el['gz-health-bar'] = _el['gz-health-bar-fill']?.parentElement;
  // Explicit: the HUD starts hidden, shown once the player is in MISSION.
  setGantzHudActive(false);
  setGantzHudView('fps');
}

export function setGantzHudActive(on) {
  _active = !!on;
  if (_el['gz-hud']) {
    _el['gz-hud'].dataset.active = _active ? '1' : '0';
    if (!_active) _el['gz-hud'].classList.remove('crit-edge');
  }
}

export function setGantzHudView(next) {
  if (next !== 'fps' && next !== 'tps') return;
  if (next === _view) return;
  _view = next;
  const host = _el['gz-hud'];
  if (!host) return;
  host.dataset.view = next;
  host.classList.add('gz-warping');
  setTimeout(() => host.classList.remove('gz-warping'), 440);
  _clickOnce(880, 0.06, 0.04);
}

// ── Transmission banner ─────────────────────────────────────────────────
// Lines: array of strings; each line types out then advances.
// opts: { dwellMs, rateLimitMs, forceShow }
export function gantzHudTransmission(lines, opts = {}) {
  const now = performance.now();
  const rl = opts.rateLimitMs ?? 5000;
  if (!opts.forceShow && now - _tx.lastTriggerAt < rl) return;
  _tx.lastTriggerAt = now;
  const arr = Array.isArray(lines) ? lines : [String(lines)];
  _tx.queue = arr.slice();
  _tx.text = '';
  _tx.shownIdx = 0;
  _tx.state = 'typing';
  _tx.hideAt = 0;
  _tx.lastCharAt = now;
  _tx._dwellMs = opts.dwellMs ?? 4000;
  _tx._fullText = arr.join('\n');
  const el = _el['gz-tx'];
  if (el) { el.classList.add('show'); el.classList.remove('done'); }
  const head = _el['gz-tx-id'];
  if (head) head.textContent = _fmtStamp();
}

// ── Ambient terminal (lower-priority commentary) ───────────────────────
export function gantzHudAmbient(line) {
  if (!line) return;
  _amb.queue.push(String(line));
}

// ── Fire event (for civilian warning + weapon feedback) ────────────────
export function gantzHudOnFire({ kind } = {}) {
  if (kind === 'civilian') {
    const flash = _el['gz-screen-flash'];
    if (flash) {
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
    }
    // Inverted low-pitch 5-beat click (lower + longer than kill clicks).
    const ctx = _clickCtx();
    if (ctx) {
      for (let i = 0; i < 5; i++) {
        setTimeout(() => _clickOnce(120 + i * 10, 0.12, 0.05), i * 85);
      }
    }
  }
}

// ── Points delta ────────────────────────────────────────────────────────
export function gantzHudOnPoints(newTotal, delta, source = 'gain') {
  const el = _el['gz-points-delta'];
  if (!el) return;
  // Restart the float animation
  el.className = 'gz-points-delta';
  void el.offsetWidth;
  el.textContent = (delta > 0 ? '+' : '') + delta;
  el.classList.add(source === 'loss' ? 'loss' : source === 'bonus' ? 'bonus' : 'gain');
}

function _fmtStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── Per-frame tick ──────────────────────────────────────────────────────
// snapshot = {
//   phase, inMission, username, peerCount,
//   modifierLabel,
//   chronoMs,                       — remaining mission time
//   weaponName, weaponState,        — 'READY' | 'CYCLING' | 'VENT'
//   weaponBarT, weaponBarReady,
//   points,
//   aliens,                         — array { id, x, y, alive, marked, markedAt, _markTimeMs, archetype, spec, threat }
//   civilians,                      — array { id, x, y, alive, marked, markedAt, _markTimeMs }
//   remotePeers,                    — array { x, y, name }
//   player,                         — { x, y, facing, yaw }
//   mapBounds,                      — { minX, maxX, minY, maxY }
//   dossierTarget,                  — current tracked target object (alien) or null
//   reticleWarn,                    — 'idle' | 'civ' | 'fire'
//   worldBadges,                    — array { sx, sy, secs, kind: 'alien'|'civ' }
// }
export function tickGantzHud(s, dt) {
  if (!_el['gz-hud'] || !s) return;

  // Identity ------------------------------------------------------------
  if (_el['gz-ident-name']) _el['gz-ident-name'].textContent = (s.username || '—').toUpperCase();
  if (_el['gz-ident-phase']) _el['gz-ident-phase'].textContent = (s.phase || '');
  if (_el['gz-ident-peers']) _el['gz-ident-peers'].textContent = `◉ ${s.peerCount || 0} HUNTERS`;

  // Chrono --------------------------------------------------------------
  const ms = Math.max(0, s.chronoMs || 0);
  const total = ms / 1000;
  const mm = Math.floor(total / 60);
  const ss = Math.floor(total % 60);
  const cc = Math.floor((total - Math.floor(total)) * 100);
  if (_el['gz-chrono-digits']) {
    _el['gz-chrono-digits'].textContent = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }
  if (_el['gz-chrono-centi']) {
    _el['gz-chrono-centi'].textContent = `.${String(cc).padStart(2,'0')}`;
  }
  if (_el['gz-chrono-mod']) {
    _el['gz-chrono-mod'].textContent = s.modifierLabel ? `◆ ${s.modifierLabel.toUpperCase()}` : '';
  }
  // Second-boundary digit jitter
  const secNow = Math.floor(total);
  if (secNow !== _chronoLastSecond && _el['gz-chrono-digits']) {
    _chronoLastSecond = secNow;
    const d = _el['gz-chrono-digits'];
    d.classList.remove('jitter');
    void d.offsetWidth;
    d.classList.add('jitter');
  }
  const chronoEl = _el['gz-chrono'];
  if (chronoEl) {
    chronoEl.classList.toggle('warn', ms < 30000 && ms >= 10000);
    chronoEl.classList.toggle('crit', ms < 10000 && ms > 0);
  }
  if (_el['gz-hud']) _el['gz-hud'].classList.toggle('crit-edge', ms < 10000 && ms > 0);

  // Points (tween + click) ---------------------------------------------
  const target = s.points | 0;
  if (target !== _pointsTargetPrev) _pointsTargetPrev = target;
  if (_pointsDisplayed !== target) {
    const step = Math.max(1, Math.ceil(Math.abs(target - _pointsDisplayed) * 0.15));
    _pointsDisplayed += (target > _pointsDisplayed) ? step : -step;
    if ((target > _pointsDisplayed && _pointsDisplayed > target) ||
        (target < _pointsDisplayed && _pointsDisplayed < target)) _pointsDisplayed = target;
    if (_pointsDisplayed !== target && _pointsDisplayed !== undefined) {
      const now = performance.now();
      if (now - _pointsLastTickAt > 35) {
        _pointsLastTickAt = now;
        const freqs = [280, 340, 520];
        _clickOnce(freqs[(now | 0) % 3], 0.05, 0.016);
      }
    }
  }
  if (_el['gz-points-value']) _el['gz-points-value'].textContent = String(_pointsDisplayed);

  // Weapon --------------------------------------------------------------
  if (_el['gz-weapon-name']) _el['gz-weapon-name'].textContent = (s.weaponName || '—').toUpperCase();
  if (_el['gz-weapon-state']) {
    const st = (s.weaponState || 'READY').toUpperCase();
    _el['gz-weapon-state'].textContent = st;
    _el['gz-weapon-state'].className = 'gz-weapon-state' + (st === 'CYCLING' ? ' cycling' : st === 'VENT' ? ' vent' : '');
  }
  if (_el['gz-weapon-bar-fill']) {
    _el['gz-weapon-bar-fill'].style.width = Math.max(0, Math.min(1, s.weaponBarT || 0)) * 100 + '%';
  }
  if (_el['gz-weapon-bar']) _el['gz-weapon-bar'].classList.toggle('ready', !!s.weaponBarReady);

  // Health bar -----------------------------------------------------------
  if (_el['gz-health-bar-fill']) {
    const hp    = s.hp    ?? 100;
    const maxHp = s.maxHp ?? 100;
    const frac  = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    _el['gz-health-bar-fill'].style.width = (frac * 100) + '%';
    if (_el['gz-health-value']) _el['gz-health-value'].textContent = `${hp} / ${maxHp}`;
    if (_el['gz-health-bar']) _el['gz-health-bar'].classList.toggle('low', frac < 0.3);
  }

  // Target Dossier -----------------------------------------------------
  const tgt = s.dossierTarget;
  if (_el['gz-dossier-count']) {
    const alive = (s.aliens || []).filter(a => a.alive).length;
    const total = (s.aliens || []).length;
    _el['gz-dossier-count'].textContent = `${alive} / ${total}`;
  }
  if (_el['gz-dossier-name']) _el['gz-dossier-name'].textContent = tgt?.name?.toUpperCase() || '—';
  if (_el['gz-dossier-status']) {
    const st = tgt ? (tgt.alive === false ? 'TERMINATED' : tgt.marked ? 'FUSED' : 'TRACKING') : '—';
    _el['gz-dossier-status'].textContent = st;
    _el['gz-dossier-status'].className = 'gz-dossier-status' + (tgt && tgt.alive === false ? ' dead' : '');
  }
  if (_el['gz-dossier-threat-fill']) {
    const th = tgt?.threat != null ? tgt.threat : (tgt ? 0.6 : 0);
    _el['gz-dossier-threat-fill'].style.width = `${Math.max(0, Math.min(1, th)) * 100}%`;
  }
  if (_el['gz-dossier-portrait'] && tgt && tgt._portraitKey !== _el['gz-dossier-portrait']._key) {
    const cvs = _el['gz-dossier-portrait'];
    cvs._key = tgt._portraitKey;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (_drawAlienPortrait && tgt.archetype) {
      try { _drawAlienPortrait(cvs, tgt.archetype, tgt.specSeed); } catch {}
    }
  }

  // Radar --------------------------------------------------------------
  _drawRadar(s, dt);

  // Reticle warn -------------------------------------------------------
  if (_el['gz-reticle']) {
    const w = s.reticleWarn || 'idle';
    _el['gz-reticle'].dataset.warn = w;
    if (_el['gz-reticle-label']) {
      _el['gz-reticle-label'].textContent = w === 'civ' ? '[ CIVILIAN ]' : w === 'fire' ? '[ VIOLATION ]' : '';
    }
    if (_el['gz-screen-edge']) {
      _el['gz-screen-edge'].className = 'gz-screen-edge' + (w === 'civ' ? ' civ' : w === 'fire' ? ' fire' : '');
    }
  }

  // World badges (detonation countdowns, already screen-projected) -----
  const badgesRoot = _el['gz-world-badges'];
  if (badgesRoot) {
    const wb = s.worldBadges || [];
    const existing = badgesRoot.children;
    // Resize pool
    while (existing.length < wb.length) {
      const div = document.createElement('div');
      div.className = 'gz-badge';
      badgesRoot.appendChild(div);
    }
    while (existing.length > wb.length) badgesRoot.removeChild(existing[existing.length - 1]);
    for (let i = 0; i < wb.length; i++) {
      const b = wb[i];
      const d = existing[i];
      d.className = 'gz-badge' + (b.kind === 'civ' ? ' civ' : '');
      d.style.left = b.sx + 'px';
      d.style.top  = b.sy + 'px';
      d.textContent = b.secs.toFixed(1);
    }
  }

  // Transmission typewriter -------------------------------------------
  _tickTransmission();
  _tickAmbient();
}

function _tickTransmission() {
  const el = _el['gz-tx-body'];
  if (!el) return;
  const txEl = _el['gz-tx'];
  const now = performance.now();
  if (_tx.state === 'typing') {
    const full = _tx._fullText || '';
    if (now - _tx.lastCharAt >= 28) {
      _tx.lastCharAt = now;
      const next = _tx.shownIdx + 1;
      _tx.shownIdx = Math.min(full.length, next);
      let out = full.slice(0, _tx.shownIdx);
      // Occasional glitch char substitution (settles on next frame)
      if (Math.random() < 0.02 && _tx.shownIdx > 0) {
        const corrupt = ['#', '@', '░', '▒', '█'][Math.floor(Math.random() * 5)];
        out = out.slice(0, -1) + corrupt;
      }
      el.textContent = out;
      // Occasional horizontal tear
      if (txEl && Math.random() < 0.04) {
        txEl.classList.remove('glitch');
        void txEl.offsetWidth;
        txEl.classList.add('glitch');
      }
      if (_tx.shownIdx >= full.length) {
        _tx.state = 'dwell';
        _tx.hideAt = now + (_tx._dwellMs || 4000);
        if (txEl) txEl.classList.add('done');
        el.textContent = full;
      }
    }
  } else if (_tx.state === 'dwell') {
    if (now >= _tx.hideAt) {
      _tx.state = 'idle';
      if (txEl) { txEl.classList.remove('show'); txEl.classList.remove('done'); }
    }
  }
}

function _tickAmbient() {
  const el = _el['gz-ambient'];
  if (!el) return;
  const now = performance.now();
  if (_amb.queue.length && now - _amb.lastPushAt > 1800) {
    _amb.current = _amb.queue.shift();
    _amb.lastPushAt = now;
    el.textContent = '▸ ' + _amb.current;
  } else if (!_amb.current && _amb.queue.length) {
    _amb.current = _amb.queue.shift();
    el.textContent = '▸ ' + _amb.current;
    _amb.lastPushAt = now;
  }
}

// ── Radar draw ────────────────────────────────────────────────────────
function _drawRadar(s, dt) {
  const cvs = _el['gz-radar-canvas'];
  if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  const cx = W / 2, cy = H / 2;
  const radiusPx = Math.min(W, H) / 2 - 6;
  const scaleM = 30;                              // 30m diameter default
  if (_el['gz-radar-scale']) _el['gz-radar-scale'].textContent = `${scaleM}m`;
  const px = radiusPx / (scaleM / 2);

  // Black background with soft CRT bleed
  ctx.fillStyle = '#02060a';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  grad.addColorStop(0, 'rgba(0, 40, 20, 0.18)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2); ctx.fill();

  // Grid rings
  ctx.strokeStyle = 'rgba(0, 224, 90, 0.25)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radiusPx * i) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - radiusPx); ctx.lineTo(cx, cy + radiusPx);
  ctx.moveTo(cx - radiusPx, cy); ctx.lineTo(cx + radiusPx, cy);
  ctx.stroke();

  // Sweep line (rotates 0.6 Hz)
  _radarSweepA += (dt || 0) * 3.77; // ~0.6 Hz
  ctx.save();
  ctx.translate(cx, cy);
  const sweepGrad = ctx.createLinearGradient(0, 0, Math.cos(_radarSweepA) * radiusPx, Math.sin(_radarSweepA) * radiusPx);
  sweepGrad.addColorStop(0, 'rgba(0, 224, 90, 0.55)');
  sweepGrad.addColorStop(1, 'rgba(0, 224, 90, 0)');
  ctx.strokeStyle = sweepGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(_radarSweepA) * radiusPx, Math.sin(_radarSweepA) * radiusPx);
  ctx.stroke();
  ctx.restore();

  const p = s.player;
  if (!p) { _radarChrome(ctx, W, H, cx, cy, radiusPx); return; }

  // World-fixed radar: north (world -Z / game -Y) is always at the top, east
  // (+X) is to the right. The player's facing is shown by rotating the self
  // triangle rather than the world.
  const yaw = p.yaw || 0;

  function plot(x, y) {
    const dx = x - p.x;
    const dy = y - p.y;
    return { lx: dx * px, ly: dy * px };
  }

  function drawDot(obj, color, r, kind) {
    const { lx, ly } = plot(obj.x, obj.y);
    const d = Math.hypot(lx, ly);
    if (d > radiusPx) {
      // Off-map arrow on the rim.
      const a = Math.atan2(ly, lx);
      const ex = cx + Math.cos(a) * (radiusPx - 3);
      const ey = cy + Math.sin(a) * (radiusPx - 3);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-6, -3);
      ctx.lineTo(-6, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save();
    // Red-alien "glitched" jitter
    let dxj = 0, dyj = 0;
    if (kind === 'alien') {
      dxj = (Math.random() - 0.5) * 2.4;
      dyj = (Math.random() - 0.5) * 2.4;
    }
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(cx + lx + dxj, cy + ly + dyj, r, 0, Math.PI * 2);
    ctx.fill();
    // Marked ring around fused targets
    if (obj.marked && obj.alive !== false) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffc040';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx + lx, cy + ly, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Civilians — solid blue
  for (const c of (s.civilians || [])) {
    if (!c || c.alive === false) continue;
    drawDot(c, '#46a0ff', 2.2, 'civ');
  }
  // Aliens — red glitched
  for (const a of (s.aliens || [])) {
    if (!a || a.alive === false) continue;
    drawDot(a, '#ff3050', 3.0, 'alien');
  }
  // Peer hunters — green
  for (const peer of (s.remotePeers || [])) {
    drawDot({ x: peer.x, y: peer.y }, '#80ffb0', 2.4, 'peer');
  }

  // Self — white triangle rotated to show facing (radar is world-fixed).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-yaw);
  ctx.fillStyle = '#e8f6ff';
  ctx.shadowColor = '#e8f6ff';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(-3.5, 3.5);
  ctx.lineTo(3.5, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  _radarChrome(ctx, W, H, cx, cy, radiusPx);
}

function _radarChrome(ctx, W, H, cx, cy, r) {
  // Scanlines overlay
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
  // Outer ring
  ctx.strokeStyle = 'rgba(0, 224, 90, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.stroke();
}
