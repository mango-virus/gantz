// ─── Proximity Audio ──────────────────────────────────────────────────────
// Tiny Web Audio wrapper that plays one-shot sounds at a world-space point.
// The volume attenuates with distance from the listener, and the stereo pan
// reflects whether the source is on the listener's left or right.
//
// Usage:
//   audio.preload(['assets/audio/x-gun-shoot.mp3', ...])
//   audio.setListener(playerX, playerY, yaw)       — every frame
//   audio.playAt(url, worldX, worldY, { volume, rate, refDist, maxDist })
//   audio.play(url, volume)                        — non-spatial (UI)
//
// Rolloff is linear between refDist (full vol) and maxDist (silent). Above
// maxDist the sound is skipped entirely. Stereo pan is computed from the
// source direction projected onto the listener's right axis, so a sound
// directly to the left plays in the left ear only.

let _ctx = null;
const _buffers = new Map();   // url -> AudioBuffer
const _pending = new Map();   // url -> Promise<AudioBuffer>

// Listener state, updated every frame by the game loop.
let _lx = 0, _ly = 0, _lYaw = 0;

// Active looping sources (background music, ambient hum, etc). Their gains
// recompute every frame when setListener runs. Each loop stays alive until
// stopLoop is called, even while the audio context is suspended (pre-gesture).
// A loop whose buffer hasn't decoded yet records `pending: true`; setListener
// skips it until the src is wired up by the fulfilled _load promise.
const _loops = new Set();

function _getCtx() {
  if (_ctx) return _ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  _ctx = new AC();
  // Browsers block audio until a user gesture; resume on the first click/key.
  const resume = () => {
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
  return _ctx;
}

async function _load(url) {
  if (_buffers.has(url)) return _buffers.get(url);
  if (_pending.has(url)) return _pending.get(url);
  const ctx = _getCtx();
  if (!ctx) return null;
  const p = fetch(url)
    .then(r => r.arrayBuffer())
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { _buffers.set(url, buf); _pending.delete(url); return buf; })
    .catch(err => { _pending.delete(url); console.warn('audio load failed', url, err); return null; });
  _pending.set(url, p);
  return p;
}

function _computeProxGain(x, y, volume, refDist, maxDist) {
  const dist = Math.hypot(x - _lx, y - _ly);
  if (dist >= maxDist) return 0;
  const atten = dist <= refDist ? 1 : 1 - (dist - refDist) / (maxDist - refDist);
  return Math.max(0, Math.min(3, volume * atten));
}

function _updateLoops() {
  for (const loop of _loops) {
    if (loop.pending || !loop.gainNode) continue;
    const g = _computeProxGain(loop.x, loop.y, loop.volume, loop.refDist, loop.maxDist);
    // Short ramp so motion doesn't click.
    const ctx = _ctx;
    if (!ctx) continue;
    loop.gainNode.gain.cancelScheduledValues(ctx.currentTime);
    loop.gainNode.gain.linearRampToValueAtTime(g, ctx.currentTime + 0.06);
  }
}

export const audio = {
  preload(urls) { for (const u of urls) _load(u); },

  setListener(x, y, yaw) {
    _lx = x; _ly = y; _lYaw = yaw || 0;
    if (_loops.size > 0) _updateLoops();
  },

  // Play a non-spatial sound (UI click, menu open, etc.).
  play(url, volume = 1, rate = 1) {
    const ctx = _getCtx(); if (!ctx) return;
    _load(url).then(buf => {
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = Math.max(0, Math.min(3, volume));
      src.connect(g).connect(ctx.destination);
      src.start(0);
    });
  },

  // Play a sound at a world-space point. Volume is attenuated with distance
  // from the listener; stereo pan follows the source's side relative to yaw.
  playAt(url, x, y, opts = {}) {
    const ctx = _getCtx(); if (!ctx) return;
    const volume  = opts.volume  != null ? opts.volume  : 1;
    const rate    = opts.rate    != null ? opts.rate    : 1;
    const refDist = opts.refDist != null ? opts.refDist : 2;   // m of full volume
    const maxDist = opts.maxDist != null ? opts.maxDist : 45;  // m where it drops to 0

    const dx = x - _lx, dy = y - _ly;
    const dist = Math.hypot(dx, dy);
    if (dist >= maxDist) return;   // completely inaudible — skip

    // Linear rolloff between refDist and maxDist.
    const atten = dist <= refDist
      ? 1
      : 1 - (dist - refDist) / (maxDist - refDist);
    const vol = Math.max(0, Math.min(3, volume * atten));
    if (vol <= 0.001) return;

    // Stereo pan: project the source direction onto the listener's right-axis.
    // In-game yaw convention (from CLAUDE.md): facing = atan2(-cos(yaw), -sin(yaw)).
    // Forward vector = (-sin(yaw), -cos(yaw)); Right vector = (-cos(yaw), sin(yaw)).
    // Pan value = dot(dir, right), clamped to [-1, 1].
    let pan = 0;
    if (dist > 0.01) {
      const nx = dx / dist, ny = dy / dist;
      const rx = -Math.cos(_lYaw), ry = Math.sin(_lYaw);
      pan = Math.max(-1, Math.min(1, nx * rx + ny * ry));
    }

    _load(url).then(buf => {
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = vol;
      // StereoPannerNode isn't everywhere (older Safari); fall back to plain
      // gain-only if unavailable.
      let panNode = null;
      if (typeof ctx.createStereoPanner === 'function') {
        panNode = ctx.createStereoPanner();
        panNode.pan.value = pan;
        src.connect(g).connect(panNode).connect(ctx.destination);
      } else {
        src.connect(g).connect(ctx.destination);
      }
      src.start(0);
    });
  },

  // Start a looped proximity-attenuated sound at a fixed world point. Returns
  // a handle whose .setPosition(x, y) can be called if the source should move,
  // and .stop() tears it down. Gain updates automatically every setListener.
  startLoop(url, x, y, opts = {}) {
    const ctx = _getCtx();
    const volume  = opts.volume  != null ? opts.volume  : 1;
    const refDist = opts.refDist != null ? opts.refDist : 2;
    const maxDist = opts.maxDist != null ? opts.maxDist : 45;
    const loop = {
      url, x, y, volume, refDist, maxDist,
      pending: true,
      src: null,
      gainNode: null,
      stopped: false,
      setPosition(nx, ny) { loop.x = nx; loop.y = ny; },
      stop() {
        if (loop.stopped) return;
        loop.stopped = true;
        _loops.delete(loop);
        if (loop.src) { try { loop.src.stop(); } catch (_) {} }
        if (loop.gainNode) { try { loop.gainNode.disconnect(); } catch (_) {} }
      },
    };
    _loops.add(loop);
    if (!ctx) return loop; // no audio: keep handle API stable, noop behaviour
    _load(url).then(buf => {
      if (loop.stopped || !buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = opts.loop !== false;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(ctx.destination);
      loop.src = src;
      loop.gainNode = g;
      loop.pending = false;
      src.start(0);
      _updateLoops();
    });
    return loop;
  },
};
