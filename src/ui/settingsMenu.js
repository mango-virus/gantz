// ─── ESC Pause Menu ───────────────────────────────────────────────────────────
// Full pause overlay opened by pressing Escape. Contains: Resume, Settings
// (audio / controls / display), Keybinds reference, and Disconnect.
//
// Usage:
//   const escMenu = createEscMenu();
//   escMenu.applyAll({ audio, setSensitivity, setFov, setHeadBob });
//   escMenu.open();  escMenu.close();  escMenu.isOpen();

const SETTINGS_KEY = 'gantz:settings';

const DEFAULTS = {
  vol_master:  1,
  vol_music:   0.8,
  vol_sfx:     1,
  vol_ambient: 0.7,
  sensitivity: 1,
  fov:         72,
  headBob:     true,
};

export function createEscMenu() {
  let _data = { ...DEFAULTS };
  try { Object.assign(_data, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch {}

  let _hooks = {};
  let _open = false;

  function _save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(_data)); } catch {}
  }

  function _applyOne(key, value) {
    _data[key] = value;
    if (key === 'vol_master')  _hooks.audio?.setVolume('master',  value);
    if (key === 'vol_music')   _hooks.audio?.setVolume('music',   value);
    if (key === 'vol_sfx')     _hooks.audio?.setVolume('sfx',     value);
    if (key === 'vol_ambient') _hooks.audio?.setVolume('ambient', value);
    if (key === 'sensitivity') _hooks.setSensitivity?.(value);
    if (key === 'fov')         _hooks.setFov?.(value);
    if (key === 'headBob')     _hooks.setHeadBob?.(value);
    _save();
  }

  // ─── Build overlay ────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'esc-overlay';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);

  const box = document.createElement('div');
  box.className = 'esc-box';
  overlay.appendChild(box);

  // ─── Header ───────────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.className = 'esc-header';
  hdr.innerHTML = '<span class="esc-title">◈ PAUSED</span>';
  box.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'esc-body';
  box.appendChild(body);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function _section(titleText) {
    const sec = document.createElement('div');
    sec.className = 'esc-section';
    const lbl = document.createElement('div');
    lbl.className = 'esc-section-title';
    lbl.textContent = titleText;
    sec.appendChild(lbl);
    body.appendChild(sec);
    return sec;
  }

  function _slider(parent, labelText, key, min, max, step, fmt) {
    const row = document.createElement('div');
    row.className = 'esc-row';

    const top = document.createElement('div');
    top.className = 'esc-row-top';

    const lbl = document.createElement('span');
    lbl.className = 'esc-label';
    lbl.textContent = labelText;

    const valEl = document.createElement('span');
    valEl.className = 'esc-val';
    valEl.textContent = fmt(_data[key]);

    top.appendChild(lbl);
    top.appendChild(valEl);
    row.appendChild(top);

    const inp = document.createElement('input');
    inp.type = 'range';
    inp.className = 'esc-slider';
    inp.min = String(min); inp.max = String(max); inp.step = String(step);
    inp.value = String(_data[key]);
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      valEl.textContent = fmt(v);
      _applyOne(key, v);
    });
    row.appendChild(inp);
    parent.appendChild(row);
    return inp;
  }

  function _toggle(parent, labelText, key) {
    const row = document.createElement('div');
    row.className = 'esc-row esc-row-toggle';

    const lbl = document.createElement('span');
    lbl.className = 'esc-label';
    lbl.textContent = labelText;

    const btn = document.createElement('button');
    btn.className = 'esc-toggle';
    const _sync = () => {
      btn.textContent = _data[key] ? 'ON' : 'OFF';
      btn.dataset.on = _data[key] ? '1' : '0';
    };
    _sync();
    btn.addEventListener('click', () => { _applyOne(key, !_data[key]); _sync(); });

    row.appendChild(lbl);
    row.appendChild(btn);
    parent.appendChild(row);
  }

  function _actionBtn(parent, labelText, modifier, onClick) {
    const btn = document.createElement('button');
    btn.className = 'esc-action-btn' + (modifier ? ' ' + modifier : '');
    btn.textContent = labelText;
    btn.addEventListener('click', onClick);
    parent.appendChild(btn);
    return btn;
  }

  // ─── Resume ───────────────────────────────────────────────────────────────
  const resumeSec = document.createElement('div');
  resumeSec.className = 'esc-resume-wrap';
  body.appendChild(resumeSec);
  _actionBtn(resumeSec, '▶ RESUME', 'esc-resume-btn', close);

  // ─── Settings ─────────────────────────────────────────────────────────────
  const audioSec = _section('◆ AUDIO');
  _slider(audioSec, 'Master Volume', 'vol_master',  0, 1, 0.05, v => Math.round(v * 100) + '%');
  _slider(audioSec, 'Music',         'vol_music',   0, 1, 0.05, v => Math.round(v * 100) + '%');
  _slider(audioSec, 'SFX',           'vol_sfx',     0, 1, 0.05, v => Math.round(v * 100) + '%');
  _slider(audioSec, 'Ambience',      'vol_ambient', 0, 1, 0.05, v => Math.round(v * 100) + '%');

  const ctrlSec = _section('◆ CONTROLS');
  _slider(ctrlSec, 'Mouse Sensitivity', 'sensitivity', 0.25, 3, 0.05, v => Math.round(v * 100) + '%');

  const dispSec = _section('◆ DISPLAY');
  _slider(dispSec, 'Field of View', 'fov',     60, 100, 1, v => v + '°');
  _toggle(dispSec, 'Head Bob',      'headBob');

  // ─── Keybinds reference ───────────────────────────────────────────────────
  const kbSec = _section('◆ KEYBINDS');
  const BINDS = [
    ['WASD / Arrows', 'Move'],
    ['Mouse', 'Aim'],
    ['Left Click / F', 'Fire'],
    ['Right Click', 'Aim Down Sights'],
    ['Space', 'Jump'],
    ['Shift', 'Walk (slow)'],
    ['E', 'Interact / Gantz Sphere'],
    ['T / Enter', 'Open Chat'],
    ['V', 'Toggle 3rd Person'],
    ['Escape', 'Pause / Exit Pointer Lock'],
  ];
  const kbTable = document.createElement('div');
  kbTable.className = 'esc-keybinds';
  for (const [key, action] of BINDS) {
    const row = document.createElement('div');
    row.className = 'esc-kb-row';
    row.innerHTML = `<span class="esc-kb-key">${key}</span><span class="esc-kb-action">${action}</span>`;
    kbTable.appendChild(row);
  }
  kbSec.appendChild(kbTable);

  // ─── Disconnect ───────────────────────────────────────────────────────────
  const discSec = document.createElement('div');
  discSec.className = 'esc-disc-wrap';
  body.appendChild(discSec);

  let _discConfirm = false;
  let _discTimer = null;
  const discBtn = _actionBtn(discSec, '⏻ DISCONNECT', 'esc-disc-btn', () => {
    if (_discConfirm) {
      clearTimeout(_discTimer);
      location.reload();
    } else {
      _discConfirm = true;
      discBtn.textContent = '⚠ CONFIRM DISCONNECT?';
      discBtn.classList.add('confirming');
      _discTimer = setTimeout(() => {
        _discConfirm = false;
        discBtn.textContent = '⏻ DISCONNECT';
        discBtn.classList.remove('confirming');
      }, 3500);
    }
  });

  // Footer
  const footer = document.createElement('div');
  footer.className = 'menu-footer';
  footer.textContent = '[ESC] to close';
  box.appendChild(footer);

  // ─── Keyboard: ESC closes ─────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _open) { e.stopImmediatePropagation(); close(); }
  }, true);

  // ─── Open / close ─────────────────────────────────────────────────────────
  function open() {
    if (_open) return;
    _open = true;
    overlay.style.display = 'flex';
    _discConfirm = false;
    discBtn.textContent = '⏻ DISCONNECT';
    discBtn.classList.remove('confirming');
    clearTimeout(_discTimer);
  }

  function close() {
    if (!_open) return;
    _open = false;
    overlay.style.display = 'none';
    _hooks.onClose?.();
  }

  function isOpen() { return _open; }

  function applyAll(hooks) {
    _hooks = hooks;
    for (const [key, value] of Object.entries(_data)) _applyOne(key, value);
  }

  function getSettings() { return { ..._data }; }

  return { open, close, isOpen, applyAll, getSettings };
}
