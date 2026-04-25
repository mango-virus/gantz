// Dev tool panel — only shown to the player named 'LJ'.
// Sections are registered independently so future features can be added
// by calling devMode.addSection(id, title, buildFn).

const PANEL_W   = 330;
const CANVAS_W  = 314;
const CANVAS_H  = 360;
const PX        = 8;    // panel horizontal padding

const STORAGE_KEY = 'gantz:devCollision';

// Game-coord range visible in the collision canvas (mutable for zoom)
let VIEW_X0 = -9, VIEW_X1 = 7;
let VIEW_Y0 = -12, VIEW_Y1 = 16;

function gameToCanvas(gx, gy) {
  const x = ((gx - VIEW_X0) / (VIEW_X1 - VIEW_X0)) * CANVAS_W;
  const y = ((gy - VIEW_Y0) / (VIEW_Y1 - VIEW_Y0)) * CANVAS_H;
  return [x, y];
}

function canvasToGame(px, py) {
  return [
    VIEW_X0 + (px / CANVAS_W) * (VIEW_X1 - VIEW_X0),
    VIEW_Y0 + (py / CANVAS_H) * (VIEW_Y1 - VIEW_Y0),
  ];
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const CSS = {
  panel: `position:fixed;top:10px;right:10px;width:${PANEL_W}px;background:rgba(4,10,4,0.96);border:1px solid #00aa33;border-radius:4px;z-index:8999;font-family:monospace;font-size:12px;color:#b0ffb0;user-select:none;max-height:90vh;overflow-y:auto;transition:opacity 0.15s,transform 0.15s`,
  sectionHeader: `display:flex;justify-content:space-between;align-items:center;padding:5px ${PX}px;background:#021208;cursor:pointer;border-bottom:1px solid #003311;font-size:11px;color:#00ff44;letter-spacing:1px`,
  sectionBody: `padding:0 ${PX}px ${PX}px`,
  input: `width:100%;background:#0a1a0a;color:#b0ffb0;border:1px solid #006622;padding:3px 5px;font-family:monospace;font-size:12px;box-sizing:border-box;border-radius:2px`,
  label: `display:block;color:#00cc44;font-size:11px;margin-bottom:2px`,
  btn: `background:#0a1a0a;color:#00ff44;border:1px solid #006622;padding:5px 8px;cursor:pointer;font-family:monospace;font-size:11px;border-radius:2px`,
};

export function createDevMode(lobbyWalls, lobbyColliders, getPlayer, getScene3d, lobbyProps) {
  // lobbyWalls      — the 4-element wall array from buildLobbyWalls(); mutated in-place.
  // lobbyColliders  — the full lobby collider array; custom zones are pushed/spliced here.
  // getPlayer       — function returning the current player object each frame.
  // getScene3d      — function returning the scene3d instance (may be null on first frames).

  const t = 0.5; // wall AABB thickness (matches lobby.js)
  const customZones = [];
  let zoneCounter = 0;

  // ─── Wall mutation helpers ─────────────────────────────────────────────────
  function readBounds() {
    return {
      minX: +(lobbyWalls[1].x + t / 2).toFixed(3),
      maxX: +(lobbyWalls[0].x - t / 2).toFixed(3),
      minY: +(lobbyWalls[2].y + t / 2).toFixed(3),
      maxY: +(lobbyWalls[3].y - t / 2).toFixed(3),
    };
  }

  function applyBounds(B) {
    const cx = (B.minX + B.maxX) / 2;
    const cy = (B.minY + B.maxY) / 2;
    const W  = B.maxX - B.minX;
    const H  = B.maxY - B.minY;
    lobbyWalls[0].x = B.maxX + t / 2; lobbyWalls[0].y = cy; lobbyWalls[0].h = H + 2 * t; // right
    lobbyWalls[1].x = B.minX - t / 2; lobbyWalls[1].y = cy; lobbyWalls[1].h = H + 2 * t; // left
    lobbyWalls[2].x = cx; lobbyWalls[2].y = B.minY - t / 2; lobbyWalls[2].w = W + 2 * t; // far
    lobbyWalls[3].x = cx; lobbyWalls[3].y = B.maxY + t / 2; lobbyWalls[3].w = W + 2 * t; // near
  }

  // ─── Persistence ──────────────────────────────────────────────────────────
  function save() {
    const data = {
      bounds: readBounds(),
      customZones: customZones.map(z => ({
        kind: z.kind, x: z.x, y: z.y, w: z.w, h: z.h, r: z.r, tier: z.tier,
        ...(z.hidden ? { hidden: true } : {}),
        ...(z.wallColor ? { wallColor: z.wallColor, wallOpacity: z.wallOpacity ?? 0.28 } : {}),
        ...(z.yMin !== undefined ? { yMin: z.yMin, yMax: z.yMax } : {}),
      })),
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  // Apply saved bounds immediately (before the panel is ever opened).
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.bounds) applyBounds(data.bounds);
    }
  } catch (_) {}

  // ─── Panel shell ──────────────────────────────────────────────────────────
  const devBtn = document.createElement('button');
  devBtn.id = 'dev-mode-btn';
  devBtn.textContent = '⚙ DEV';
  Object.assign(devBtn.style, {
    position: 'fixed', bottom: '10px', right: '10px', zIndex: '9000',
    padding: '5px 10px', fontFamily: 'monospace', fontSize: '12px',
    background: '#0a1a0a', color: '#00ff44', border: '1px solid #00aa33',
    borderRadius: '3px', cursor: 'pointer', display: 'none', letterSpacing: '1px',
  });
  document.body.appendChild(devBtn);

  const panel = document.createElement('div');
  panel.id = 'dev-mode-panel';
  panel.style.cssText = CSS.panel + ';display:none;opacity:0;transform:translateY(-6px) scale(0.98)';
  document.body.appendChild(panel);

  // Panel header
  const panelHeader = document.createElement('div');
  panelHeader.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:7px ${PX}px 6px;border-bottom:1px solid #003311;cursor:move;user-select:none`;
  panelHeader.innerHTML = '<span style="color:#00ff44;letter-spacing:2px;font-size:11px">◈ DEV TOOLS</span>';
  const xBtn = document.createElement('button');
  xBtn.textContent = '✕';
  xBtn.style.cssText = 'background:none;border:none;color:#00aa33;cursor:pointer;font-size:14px;padding:0;line-height:1';
  xBtn.addEventListener('click', () => setOpen(false));
  panelHeader.appendChild(xBtn);
  panel.appendChild(panelHeader);
  _makeDraggable(panel, panelHeader);
  _addResizeHandle(panel, 260);

  // ─── Section registry ─────────────────────────────────────────────────────
  const sections = new Map(); // id → { container, body, collapsed, onUpdate }

  function addSection(id, title, buildFn) {
    const section = document.createElement('div');
    section.style.cssText = 'border-bottom:1px solid #002208';

    const hdr = document.createElement('div');
    hdr.style.cssText = CSS.sectionHeader;
    hdr.innerHTML = `<span>${title}</span><span class="dev-chevron">▾</span>`;

    const body = document.createElement('div');
    body.style.cssText = CSS.sectionBody + ';padding-top:8px';

    section.appendChild(hdr);
    section.appendChild(body);
    panel.appendChild(section);

    let collapsed = true;
    body.style.display = 'none';
    hdr.querySelector('.dev-chevron').textContent = '▸';
    let headerClickOverride = null;
    hdr.addEventListener('click', () => {
      if (headerClickOverride) { headerClickOverride(); return; }
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : '';
      hdr.querySelector('.dev-chevron').textContent = collapsed ? '▸' : '▾';
    });

    const result = buildFn(body);
    const onUpdate = typeof result === 'function' ? result : (result?.onUpdate || null);
    if (result?.headerClick) headerClickOverride = result.headerClick;
    const collapseSection = () => {
      collapsed = true;
      body.style.display = 'none';
      hdr.querySelector('.dev-chevron').textContent = '▸';
    };
    sections.set(id, { section, body, onUpdate, collapseSection });
    return body;
  }

  // ─── Shared state ─────────────────────────────────────────────────────────
  let collisionCanvas, collisionCtx;
  let _mapWin = null, _mapVisible = false;

  // ─── Section: Collision Map (pop-out window) ─────────────────────────────
  addSection('collision-map', 'COLLISION MAP', (body) => {
    // Pop-out window
    _mapWin = document.createElement('div');
    const mapWin = _mapWin;
    mapWin.id = 'dev-map-window';
    mapWin.style.cssText = `position:fixed;top:60px;left:${PANEL_W + 20}px;background:rgba(4,10,4,0.97);border:1px solid #00aa33;border-radius:4px;z-index:8998;font-family:monospace;font-size:12px;color:#b0ffb0;display:none`;
    document.body.appendChild(mapWin);

    const titleBar = document.createElement('div');
    titleBar.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:5px ${PX}px;background:#021208;cursor:move;border-bottom:1px solid #003311;user-select:none`;
    titleBar.innerHTML = `<span style="color:#00ff44;font-size:11px;letter-spacing:1px">◈ COLLISION MAP</span>`;
    const mapCloseBtn = document.createElement('button');
    mapCloseBtn.textContent = '✕';
    mapCloseBtn.style.cssText = 'background:none;border:none;color:#00aa33;cursor:pointer;font-size:14px;padding:0;line-height:1';
    mapCloseBtn.addEventListener('click', () => { mapWin.style.display = 'none'; });
    titleBar.appendChild(mapCloseBtn);
    mapWin.appendChild(titleBar);
    _makeDraggable(mapWin, titleBar);
    _addResizeHandle(mapWin, 200, 200);

    const mapContent = document.createElement('div');
    mapContent.style.cssText = `padding:${PX}px`;
    mapWin.appendChild(mapContent);

    collisionCanvas = document.createElement('canvas');
    collisionCanvas.width  = CANVAS_W;
    collisionCanvas.height = CANVAS_H;
    collisionCanvas.style.cssText = `display:block;margin:0 auto 8px;background:#030a03;cursor:crosshair`;
    mapContent.appendChild(collisionCanvas);
    collisionCtx = collisionCanvas.getContext('2d');

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px';
    mapContent.appendChild(grid);

    const boundInputs = {};
    for (const [key, label] of [['minX','Min X (left)'],['maxX','Max X (right)'],['minY','Min Y (far)'],['maxY','Max Y (near)']]) {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('label');
      lbl.style.cssText = CSS.label;
      lbl.textContent   = label;
      const inp = document.createElement('input');
      inp.type  = 'number'; inp.step = '0.05';
      inp.style.cssText = CSS.input;
      inp.addEventListener('change', () => {
        const B = readBounds();
        B[key] = parseFloat(inp.value);
        if (key === 'minX') B.minX = Math.min(B.minX, B.maxX - 0.5);
        if (key === 'maxX') B.maxX = Math.max(B.maxX, B.minX + 0.5);
        if (key === 'minY') B.minY = Math.min(B.minY, B.maxY - 0.5);
        if (key === 'maxY') B.maxY = Math.max(B.maxY, B.minY + 0.5);
        applyBounds(B);
        syncBoundInputs(boundInputs);
        save();
      });
      wrap.appendChild(lbl); wrap.appendChild(inp);
      grid.appendChild(wrap);
      boundInputs[key] = inp;
    }

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 Clear saved data';
    clearBtn.title = 'Clear all saved dev data and reset to defaults';
    clearBtn.style.cssText = CSS.btn + ';width:100%;color:#aa4444;border-color:#441111;margin-top:4px';
    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear all saved dev collision data and reset to defaults?')) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
    mapContent.appendChild(clearBtn);

    _setupCanvasDrag(collisionCanvas, readBounds, applyBounds,
      () => syncBoundInputs(boundInputs),
      () => customZones,
      save,
      (gx, gy) => {
        const g = window.__gantz;
        if (g?.player) { g.player.x = gx; g.player.y = gy; }
      });

    // Panel section body is empty — map lives in pop-out
    body.style.display = 'none';

    return {
      headerClick: () => {
        _mapVisible = !_mapVisible;
        mapWin.style.display = _mapVisible ? 'block' : 'none';
      },
      onUpdate: (player) => {
        if (!_mapVisible) return;
        syncBoundInputs(boundInputs);
        _drawCollisionCanvas(collisionCtx, CANVAS_W, CANVAS_H, lobbyWalls, readBounds, player, customZones, collisionCanvas);
      },
    };
  });

  // ─── Section: Collision Zones ─────────────────────────────────────────────
  addSection('collision-zones', 'COLLISION ZONES', (body) => {
    const zonesHeader = document.createElement('div');
    zonesHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:6px';
    zonesHeader.innerHTML = '<span style="color:#00cc44;font-size:11px;letter-spacing:1px">CUSTOM ZONES</span>';
    const addBtn = document.createElement('button');
    addBtn.textContent = '＋ Add Zone';
    addBtn.style.cssText = CSS.btn;
    const pasteBtn = document.createElement('button');
    pasteBtn.textContent = '⧉ Paste';
    pasteBtn.style.cssText = CSS.btn + ';display:none';
    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.style.cssText = CSS.btn;
    function _syncToggleAll() {
      const anyVisible = customZones.some(z => !z.hidden);
      toggleAllBtn.textContent = anyVisible ? '○ All' : '● All';
      toggleAllBtn.title = anyVisible ? 'Hide all wireframes' : 'Show all wireframes';
    }
    _syncToggleAll();
    toggleAllBtn.addEventListener('click', () => {
      const anyVisible = customZones.some(z => !z.hidden);
      for (const z of customZones) { z.hidden = anyVisible; z._visSync?.(); z._rowBorder?.(); }
      _syncToggleAll();
      save();
    });
    zonesHeader.appendChild(addBtn);
    zonesHeader.appendChild(pasteBtn);
    zonesHeader.appendChild(toggleAllBtn);
    body.appendChild(zonesHeader);
    let zoneClipboard = null;

    const zonesContainer = document.createElement('div');
    body.appendChild(zonesContainer);

    function appendZoneRow(z) {
      const row = document.createElement('div');
      const _rowBorder = () => row.style.borderColor = z.hidden ? '#001a00' : '#003311';
      row.style.cssText = 'border:1px solid #003311;border-radius:2px;padding:5px;margin-bottom:5px';
      _rowBorder();

      // Row header: label + vis + copy + shape + tier + delete
      const rowHdr = document.createElement('div');
      rowHdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:2px;margin-bottom:4px';

      const nameLbl = document.createElement('span');
      nameLbl.style.cssText = 'color:#88ffaa;font-size:10px;flex:1';
      nameLbl.textContent = `Zone ${z._devId}`;

      const visBtn = document.createElement('button');
      const _visSync = () => {
        visBtn.textContent = z.hidden ? '○' : '●';
        visBtn.style.color = z.hidden ? '#336633' : '#00ff44';
        nameLbl.style.opacity = z.hidden ? '0.4' : '1';
      };
      visBtn.title = 'Toggle 3D wireframe visibility';
      visBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:0 4px;line-height:1';
      visBtn.addEventListener('click', () => { z.hidden = !z.hidden; _visSync(); _rowBorder(); save(); });
      _visSync();
      z._visSync = _visSync;
      z._rowBorder = _rowBorder;

      const copyZoneBtn = document.createElement('button');
      copyZoneBtn.textContent = '⧉';
      copyZoneBtn.title = 'Copy zone';
      copyZoneBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;padding:0 3px;line-height:1;color:#88aaff';
      copyZoneBtn.addEventListener('click', () => {
        zoneClipboard = {
          kind: z.kind, x: z.x + 0.5, y: z.y + 0.5,
          w: z.w, h: z.h, r: z.r, tier: z.tier,
          ...(z.yMin !== undefined ? { yMin: z.yMin, yMax: z.yMax } : {}),
        };
        pasteBtn.style.display = '';
      });

      const shapeSel = document.createElement('select');
      shapeSel.style.cssText = 'background:#0a1a0a;color:#b0ffb0;border:1px solid #006622;font-family:monospace;font-size:10px;padding:1px 3px;border-radius:2px';
      for (const [val, lbl] of [['aabb','box'],['circle','circle']]) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = lbl;
        if (val === z.kind) opt.selected = true;
        shapeSel.appendChild(opt);
      }

      const tierSel = document.createElement('select');
      tierSel.style.cssText = 'background:#0a1a0a;color:#b0ffb0;border:1px solid #006622;font-family:monospace;font-size:10px;padding:1px 3px;border-radius:2px';
      for (const tier of ['hard', 'prone', 'decorative']) {
        const opt = document.createElement('option');
        opt.value = opt.textContent = tier;
        if (tier === z.tier) opt.selected = true;
        tierSel.appendChild(opt);
      }
      tierSel.addEventListener('change', () => { z.tier = tierSel.value; save(); });

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'background:none;border:none;color:#aa2222;cursor:pointer;font-size:12px;padding:0 2px;line-height:1';
      delBtn.addEventListener('click', () => {
        const ci = customZones.indexOf(z);
        if (ci !== -1) customZones.splice(ci, 1);
        const li = lobbyColliders.indexOf(z);
        if (li !== -1) lobbyColliders.splice(li, 1);
        row.remove();
        save();
      });

      // Wall fill toggle
      const wallFillBtn = document.createElement('button');
      const _wallFillSync = () => {
        wallFillBtn.textContent = z.wallColor ? '■' : '□';
        wallFillBtn.style.color = z.wallColor ? z.wallColor : '#336633';
      };
      wallFillBtn.title = 'Toggle wall fill';
      wallFillBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:0 3px;line-height:1';
      _wallFillSync();

      rowHdr.appendChild(nameLbl);
      rowHdr.appendChild(visBtn);
      rowHdr.appendChild(copyZoneBtn);
      rowHdr.appendChild(wallFillBtn);
      rowHdr.appendChild(shapeSel);
      rowHdr.appendChild(tierSel);
      rowHdr.appendChild(delBtn);
      row.appendChild(rowHdr);

      // Wall fill sub-row (color picker + opacity), revealed when fill is on
      const wallFillRow = document.createElement('div');
      wallFillRow.style.cssText = 'display:' + (z.wallColor ? 'flex' : 'none') + ';align-items:center;gap:6px;padding:4px 0 2px;border-top:1px solid #002208;margin-top:4px';
      const wallColorPicker = document.createElement('input');
      wallColorPicker.type = 'color';
      wallColorPicker.value = z.wallColor || '#ff4444';
      wallColorPicker.style.cssText = 'width:32px;height:22px;border:1px solid #006622;cursor:pointer;padding:1px;border-radius:2px';
      wallColorPicker.addEventListener('input', () => { z.wallColor = wallColorPicker.value; _wallFillSync(); save(); });
      const wallOpacitySlider = document.createElement('input');
      wallOpacitySlider.type = 'range'; wallOpacitySlider.min = '5'; wallOpacitySlider.max = '90'; wallOpacitySlider.step = '5';
      wallOpacitySlider.value = String(Math.round((z.wallOpacity ?? 0.28) * 100));
      wallOpacitySlider.style.cssText = 'flex:1;cursor:pointer';
      const wallOpacityVal = document.createElement('span');
      wallOpacityVal.style.cssText = 'color:#b0ffb0;font-size:10px;width:30px;text-align:right';
      wallOpacityVal.textContent = wallOpacitySlider.value + '%';
      wallOpacitySlider.addEventListener('input', () => {
        z.wallOpacity = parseInt(wallOpacitySlider.value, 10) / 100;
        wallOpacityVal.textContent = wallOpacitySlider.value + '%';
        save();
      });
      wallFillRow.appendChild(wallColorPicker);
      wallFillRow.appendChild(wallOpacitySlider);
      wallFillRow.appendChild(wallOpacityVal);

      wallFillBtn.addEventListener('click', () => {
        if (z.wallColor) {
          z.wallColor = null; z.wallOpacity = undefined;
          wallFillRow.style.display = 'none';
        } else {
          z.wallColor = wallColorPicker.value || '#ff4444';
          wallFillRow.style.display = 'flex';
        }
        _wallFillSync(); save();
      });

      // Input grid: x, y always; w/h for box; r for circle
      const inputGrid = document.createElement('div');
      inputGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px';

      z._inputs = {};
      function makeInputCell(key, lbTxt, minVal) {
        const wrap = document.createElement('div');
        const lbl2 = document.createElement('label');
        lbl2.style.cssText = CSS.label;
        lbl2.textContent = lbTxt;
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = '0.1';
        inp.value = (z[key] ?? 1).toFixed(2);
        inp.style.cssText = CSS.input;
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          if (!isNaN(v)) {
            z[key] = minVal != null ? Math.max(minVal, v) : v;
            inp.value = z[key].toFixed(2);
            save();
          }
        });
        wrap.appendChild(lbl2); wrap.appendChild(inp);
        z._inputs[key] = inp;
        return wrap;
      }

      const xCell = makeInputCell('x', 'X (center)', null);
      const yCell = makeInputCell('y', 'Y (center)', null);
      const wCell = makeInputCell('w', 'Width', 0.1);
      const hCell = makeInputCell('h', 'Height', 0.1);
      const rCell = makeInputCell('r', 'Radius', 0.1);
      rCell.style.gridColumn = '1 / -1';

      inputGrid.appendChild(xCell);
      inputGrid.appendChild(yCell);
      inputGrid.appendChild(wCell);
      inputGrid.appendChild(hCell);
      inputGrid.appendChild(rCell);

      function updateShapeVis() {
        const isCircle = z.kind === 'circle';
        wCell.style.display = isCircle ? 'none' : '';
        hCell.style.display = isCircle ? 'none' : '';
        rCell.style.display = isCircle ? '' : 'none';
      }
      updateShapeVis();

      shapeSel.addEventListener('change', () => {
        z.kind = shapeSel.value;
        updateShapeVis();
        save();
      });

      row.appendChild(inputGrid);

      // ── Vertical range ────────────────────────────────────────────────────
      const heightSep = document.createElement('div');
      heightSep.style.cssText = 'border-top:1px solid #002208;margin:5px 0 4px';
      row.appendChild(heightSep);

      const heightToggleRow = document.createElement('label');
      heightToggleRow.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;color:#00cc44;font-size:10px;margin-bottom:4px';
      const heightChk = document.createElement('input');
      heightChk.type = 'checkbox';
      heightChk.checked = z.yMin !== undefined;
      heightToggleRow.appendChild(heightChk);
      heightToggleRow.appendChild(document.createTextNode('Limit vertical range'));
      row.appendChild(heightToggleRow);

      const heightGrid = document.createElement('div');
      heightGrid.style.cssText = 'display:' + (z.yMin !== undefined ? 'grid' : 'none') + ';grid-template-columns:1fr 1fr;gap:4px';

      for (const [key, lbTxt] of [['yMin','Floor Y (m)'],['yMax','Ceiling Y (m)']]) {
        const wrap = document.createElement('div');
        const lbl3 = document.createElement('label');
        lbl3.style.cssText = CSS.label;
        lbl3.textContent = lbTxt;
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = '0.1';
        inp.value = (z[key] ?? (key === 'yMin' ? 0 : 3)).toFixed(2);
        inp.style.cssText = CSS.input;
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          if (!isNaN(v)) { z[key] = v; inp.value = v.toFixed(2); save(); }
        });
        wrap.appendChild(lbl3); wrap.appendChild(inp);
        heightGrid.appendChild(wrap);
        z._inputs[key] = inp;
      }

      heightChk.addEventListener('change', () => {
        if (heightChk.checked) {
          z.yMin = 0; z.yMax = 3;
          heightGrid.style.display = 'grid';
          z._inputs.yMin.value = '0.00';
          z._inputs.yMax.value = '3.00';
        } else {
          delete z.yMin; delete z.yMax;
          heightGrid.style.display = 'none';
        }
        save();
      });

      row.appendChild(heightGrid);
      row.appendChild(wallFillRow);
      zonesContainer.appendChild(row);
    }

    addBtn.addEventListener('click', () => {
      zoneCounter++;
      const z = { kind: 'aabb', x: 0, y: 0, w: 2, h: 2, r: 1, tier: 'hard', _devId: zoneCounter };
      customZones.push(z);
      lobbyColliders.push(z);
      appendZoneRow(z);
      save();
    });

    pasteBtn.addEventListener('click', () => {
      if (!zoneClipboard) return;
      zoneCounter++;
      const z = { ...zoneClipboard, _devId: zoneCounter };
      customZones.push(z);
      lobbyColliders.push(z);
      appendZoneRow(z);
      save();
    });


    // ── Restore saved custom zones ─────────────────────────────────────────
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.customZones)) {
          for (const saved of data.customZones) {
            zoneCounter++;
            const z = { kind: saved.kind || 'aabb', x: saved.x, y: saved.y,
                        w: saved.w ?? 2, h: saved.h ?? 2, r: saved.r ?? 1,
                        tier: saved.tier || 'hard', _devId: zoneCounter,
                        ...(saved.hidden ? { hidden: true } : {}),
                        ...(saved.wallColor ? { wallColor: saved.wallColor, wallOpacity: saved.wallOpacity ?? 0.28 } : {}),
                        ...(saved.yMin !== undefined ? { yMin: saved.yMin, yMax: saved.yMax } : {}) };
            customZones.push(z);
            lobbyColliders.push(z);
            appendZoneRow(z);
          }
        }
      }
    } catch (_) {}

    return () => {
      _syncToggleAll();
      for (const z of customZones) {
        if (!z._inputs) continue;
        for (const key of ['x', 'y', 'w', 'h', 'r', 'yMin', 'yMax']) {
          const inp = z._inputs[key];
          if (inp && document.activeElement !== inp && z[key] !== undefined)
            inp.value = z[key].toFixed(2);
        }
      }
    };
  });

  // ─── Section: Player ──────────────────────────────────────────────────────
  addSection('player', 'PLAYER', (body) => {
    // God mode
    const godRow = document.createElement('label');
    godRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;color:#b0ffb0;font-size:11px;margin-bottom:8px';
    const godChk = document.createElement('input');
    godChk.type = 'checkbox';
    godChk.addEventListener('change', () => { if (window.__gantz) window.__gantz.godMode = godChk.checked; });
    godRow.appendChild(godChk);
    godRow.appendChild(document.createTextNode('God Mode (no damage)'));
    body.appendChild(godRow);

    // Force phase
    const phaseLbl = document.createElement('div');
    phaseLbl.style.cssText = CSS.label + ';margin-bottom:4px';
    phaseLbl.textContent = 'FORCE PHASE';
    body.appendChild(phaseLbl);
    const phaseRow = document.createElement('div');
    phaseRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:8px';
    for (const phase of ['LOBBY', 'BRIEFING', 'MISSION', 'DEBRIEF']) {
      const btn = document.createElement('button');
      btn.textContent = phase.slice(0, 4);
      btn.title = `Force phase: ${phase}`;
      btn.style.cssText = CSS.btn + ';padding:4px 2px;font-size:10px';
      btn.addEventListener('click', () => window.__gantz?.forcePhase(phase));
      phaseRow.appendChild(btn);
    }
    body.appendChild(phaseRow);

    // Teleport
    const tpLbl = document.createElement('div');
    tpLbl.style.cssText = CSS.label + ';margin-bottom:4px';
    tpLbl.textContent = 'TELEPORT (X, Y)';
    body.appendChild(tpLbl);
    const tpRow = document.createElement('div');
    tpRow.style.cssText = 'display:flex;gap:4px;margin-bottom:4px';
    const tpX = document.createElement('input');
    tpX.type = 'number'; tpX.step = '0.5'; tpX.value = '0';
    tpX.style.cssText = CSS.input;
    const tpY = document.createElement('input');
    tpY.type = 'number'; tpY.step = '0.5'; tpY.value = '0';
    tpY.style.cssText = CSS.input;
    const tpBtn = document.createElement('button');
    tpBtn.textContent = '⌖ Go';
    tpBtn.style.cssText = CSS.btn;
    tpBtn.addEventListener('click', () => {
      const g = window.__gantz;
      if (!g?.player) return;
      g.player.x = parseFloat(tpX.value) || 0;
      g.player.y = parseFloat(tpY.value) || 0;
    });
    tpRow.appendChild(tpX); tpRow.appendChild(tpY); tpRow.appendChild(tpBtn);
    body.appendChild(tpRow);

    const tpHint = document.createElement('div');
    tpHint.style.cssText = 'color:#004422;font-size:10px;margin-bottom:4px';
    tpHint.textContent = 'Tip: Shift+click the collision map to teleport';
    body.appendChild(tpHint);

    return () => {
      const g = window.__gantz;
      if (g) godChk.checked = g.godMode;
    };
  });

  // ─── Section: Scene ───────────────────────────────────────────────────────
  addSection('scene', 'SCENE', (body) => {
    // Weather
    const weatherLbl = document.createElement('div');
    weatherLbl.style.cssText = CSS.label + ';margin-bottom:4px';
    weatherLbl.textContent = 'WEATHER (lobby only)';
    body.appendChild(weatherLbl);
    const weatherSel = document.createElement('select');
    weatherSel.style.cssText = CSS.input + ';margin-bottom:8px';
    for (const [val, lbl] of [
      ['', 'Clear / None'], ['rain', 'Rain'],
      ['thunderstorm', 'Thunderstorm'], ['blizzard', 'Blizzard'], ['light_fog', 'Light Fog'],
    ]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl;
      weatherSel.appendChild(opt);
    }
    weatherSel.addEventListener('change', () => window.__gantz?.setWeatherType(weatherSel.value));
    body.appendChild(weatherSel);

    // Entity labels
    const labelsRow = document.createElement('label');
    labelsRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;color:#b0ffb0;font-size:11px;margin-bottom:4px';
    const labelsChk = document.createElement('input');
    labelsChk.type = 'checkbox'; labelsChk.checked = true;
    labelsChk.addEventListener('change', () => window.__gantz?.scene3d?.toggleEntityLabels(labelsChk.checked));
    labelsRow.appendChild(labelsChk);
    labelsRow.appendChild(document.createTextNode('Show entity name labels'));
    body.appendChild(labelsRow);

    return null;
  });

  // ─── Section: FX & Spawn ─────────────────────────────────────────────────
  addSection('fx-spawn', 'FX & SPAWN', (body) => {
    // Gore
    const goreLbl = document.createElement('div');
    goreLbl.style.cssText = CSS.label + ';margin-bottom:4px';
    goreLbl.textContent = 'BLOOD GORE POWER';
    body.appendChild(goreLbl);
    // Gore power — also applies to alien deaths
    const goreRow = document.createElement('div');
    goreRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';
    const gorePowerSlider = document.createElement('input');
    gorePowerSlider.type = 'range'; gorePowerSlider.min = '0'; gorePowerSlider.max = '5';
    gorePowerSlider.step = '1'; gorePowerSlider.value = '0';
    gorePowerSlider.style.cssText = 'flex:1;cursor:pointer';
    const gorePowerVal = document.createElement('span');
    gorePowerVal.style.cssText = 'color:#00ff44;width:22px;text-align:right;font-size:11px';
    gorePowerVal.textContent = 'off';
    gorePowerSlider.addEventListener('input', () => {
      const v = parseInt(gorePowerSlider.value, 10);
      gorePowerVal.textContent = v === 0 ? 'off' : String(v);
      if (window.__gantz) window.__gantz.goreMultiplier = v;
    });
    goreRow.appendChild(gorePowerSlider); goreRow.appendChild(gorePowerVal);
    body.appendChild(goreRow);
    const goreHint = document.createElement('div');
    goreHint.style.cssText = 'color:#004422;font-size:10px;margin-bottom:6px';
    goreHint.textContent = '0 = default (archetype-based); 1-5 = override all alien deaths';
    body.appendChild(goreHint);
    const goreBtn = document.createElement('button');
    goreBtn.textContent = '🩸 Trigger Blood Gore (ahead)';
    goreBtn.style.cssText = CSS.btn + ';width:100%;margin-bottom:8px';
    goreBtn.addEventListener('click', () => {
      const g = window.__gantz;
      if (!g?.player || !g?.scene3d) return;
      const p = g.player;
      const pow = parseInt(gorePowerSlider.value, 10) || 2;
      const x = p.x + Math.cos(p.facing || 0) * 1.5;
      const y = p.y + Math.sin(p.facing || 0) * 1.5;
      g.scene3d.spawnGibs(x, y, { power: pow });
      window.__gantz?.playGoreExplosion(x, y);
    });
    body.appendChild(goreBtn);

    // Gantz animations
    const animLbl = document.createElement('div');
    animLbl.style.cssText = CSS.label + ';margin-bottom:4px';
    animLbl.textContent = 'GANTZ ANIMATIONS';
    body.appendChild(animLbl);
    const animRow = document.createElement('div');
    animRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px';
    for (const [label, mode] of [['▶ Scan In', 'materialize'], ['◀ Scan Out', 'dematerialize']]) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = CSS.btn;
      btn.addEventListener('click', () => window.__gantz?.triggerGantzScan(mode));
      animRow.appendChild(btn);
    }
    body.appendChild(animRow);
    const ballRow = document.createElement('div');
    ballRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px';
    for (const [label, val] of [['▶ Ball Open', true], ['◀ Ball Close', false]]) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = CSS.btn;
      btn.addEventListener('click', () => { if (window.__gantz) window.__gantz.gantzBallOpen = val; });
      ballRow.appendChild(btn);
    }
    body.appendChild(ballRow);

    // Spawn
    const spawnLbl = document.createElement('div');
    spawnLbl.style.cssText = CSS.label + ';margin-bottom:4px';
    spawnLbl.textContent = 'SPAWN (mission only)';
    body.appendChild(spawnLbl);
    const spawnRow = document.createElement('div');
    spawnRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px';
    const spawnAlienBtn = document.createElement('button');
    spawnAlienBtn.textContent = '👾 Alien Ahead';
    spawnAlienBtn.style.cssText = CSS.btn;
    spawnAlienBtn.addEventListener('click', () => {
      const g = window.__gantz;
      if (!g?.player) return;
      const p = g.player;
      g.spawnAlienAt(p.x + Math.cos(p.facing || 0) * 3, p.y + Math.sin(p.facing || 0) * 3);
    });
    const spawnCivBtn = document.createElement('button');
    spawnCivBtn.textContent = '🧍 Civilian Ahead';
    spawnCivBtn.style.cssText = CSS.btn;
    spawnCivBtn.addEventListener('click', () => {
      const g = window.__gantz;
      if (!g?.player) return;
      const p = g.player;
      g.spawnCivAt(p.x + Math.cos(p.facing || 0) * 3, p.y + Math.sin(p.facing || 0) * 3);
    });
    spawnRow.appendChild(spawnAlienBtn); spawnRow.appendChild(spawnCivBtn);
    body.appendChild(spawnRow);

    return () => {
      const g = window.__gantz;
      if (!g) return;
      const mul = g.goreMultiplier ?? 0;
      gorePowerSlider.value = String(mul);
      gorePowerVal.textContent = mul === 0 ? 'off' : String(mul);
    };
  });

  // ─── Section: City Builder ────────────────────────────────────────────────
  addSection('city-builder', 'CITY BUILDER', (body) => {
    const CB_KEY = 'gantz:cityBuilder';
    let selectedId = null;
    let modelsScanned = false;
    let callbacksSet = false;
    const placedRows = new Map();

    const MODEL_URLS = [
      { label: 'High Rise Apartment 2',      url: 'assets/models/high_rise_apartment2.glb'                          },
      { label: 'Tokyo Tower',                url: 'assets/models/tokyo_tower.glb'                                   },
      { label: 'Asian Night City Buildings', url: 'assets/models/asian_themed_low_poly_night_city_buildings.glb'   },
      { label: 'Low-Poly City Night',        url: 'assets/models/low-poly_city_night.glb',      noSplit: true       },
      { label: 'Low-Poly City',              url: 'assets/models/low-poly_city_buildings.glb',  noSplit: true       },
      { label: 'City Building',              url: 'assets/models/game_ready_city_building.glb'                     },
    ];

    const EXCLUDED_BUILDINGS = new Set(['bina001', 'bina014', 'bina009', 'bina012', 'bina002']);

    // ── Model picker + Place button
    const hdrRow = document.createElement('div');
    hdrRow.style.cssText = 'display:flex;gap:4px;margin-bottom:2px;align-items:center';
    const modelSel = document.createElement('select');
    modelSel.style.cssText = 'flex:1;background:#0a1a0a;color:#b0ffb0;border:1px solid #006622;font-family:monospace;font-size:10px;padding:2px 4px;border-radius:2px';
    for (const m of MODEL_URLS) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ url: m.url, childName: null });
      opt.textContent = m.label;
      modelSel.appendChild(opt);
    }
    const placeBtn = document.createElement('button');
    placeBtn.textContent = '＋ Place';
    placeBtn.style.cssText = CSS.btn;
    placeBtn.addEventListener('click', () => {
      const g = window.__gantz;
      const cb = g?.scene3d?.cityBuilder;
      if (!cb) { console.warn('[cityBuilder] scene3d not ready'); return; }
      const p = g.player;
      let sel;
      try { sel = JSON.parse(modelSel.value); } catch (_) { sel = { url: modelSel.value, childName: null }; }
      const placement = { url: sel.url, childName: sel.childName || null, x: (p?.x ?? 0) + 30, y: 0, z: p?.y ?? 0, rx: 0, ry: 0, rz: 0, scale: 1 };
      const id = cb.place(placement);
      appendRow(id, placement);
      selectObj(id);
      savePlacements();
    });
    hdrRow.appendChild(modelSel);
    hdrRow.appendChild(placeBtn);
    body.appendChild(hdrRow);

    const scanHint = document.createElement('div');
    scanHint.style.cssText = 'color:#004422;font-size:9px;margin-bottom:6px';
    scanHint.textContent = 'Open panel to scan individual buildings…';
    body.appendChild(scanHint);

    // ── Fly cam row
    const fcRow = document.createElement('div');
    fcRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap';
    const flyCamBtn = document.createElement('button');
    flyCamBtn.textContent = '✈ FLY CAM: OFF';
    flyCamBtn.style.cssText = CSS.btn;
    flyCamBtn.addEventListener('click', () => {
      const fc = window.__gantz?.scene3d?.flyCam;
      if (!fc) return;
      if (fc.active) {
        fc.disable();
        document.exitPointerLock?.();
      } else {
        fc.enable();
        document.getElementById('game')?.requestPointerLock?.();
      }
    });
    const fcSpeedLbl = document.createElement('span');
    fcSpeedLbl.style.cssText = 'color:#009933;font-size:10px;white-space:nowrap';
    fcSpeedLbl.textContent = '20 m/s';
    const fcHint = document.createElement('div');
    fcHint.style.cssText = 'color:#004422;font-size:9px;width:100%;margin-bottom:4px';
    fcHint.textContent = 'WASD+Q/E fly · scroll=speed · click building to drag';
    fcRow.appendChild(flyCamBtn);
    fcRow.appendChild(fcSpeedLbl);
    fcRow.appendChild(fcHint);
    body.appendChild(fcRow);

    // ── Object list
    const listLbl = document.createElement('div');
    listLbl.style.cssText = CSS.label + ';margin-bottom:3px';
    listLbl.textContent = 'PLACED OBJECTS';
    body.appendChild(listLbl);
    const listContainer = document.createElement('div');
    listContainer.style.cssText = 'max-height:110px;overflow-y:auto;margin-bottom:6px;border:1px solid #002208;border-radius:2px;padding:2px';
    body.appendChild(listContainer);
    const emptyLbl = document.createElement('div');
    emptyLbl.style.cssText = 'color:#004422;font-size:10px;padding:4px';
    emptyLbl.textContent = 'No objects placed yet';
    listContainer.appendChild(emptyLbl);

    // ── Transform controls
    const tfWrap = document.createElement('div');
    tfWrap.style.cssText = 'border:1px solid #002208;border-radius:2px;padding:6px;margin-bottom:6px;display:none';
    body.appendChild(tfWrap);
    const tfTitle = document.createElement('div');
    tfTitle.style.cssText = CSS.label + ';margin-bottom:4px';
    tfTitle.textContent = '— none selected —';
    tfWrap.appendChild(tfTitle);

    // Duplicate + Snap Y=0 row
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px';
    tfWrap.appendChild(actionRow);
    const dupBtn = document.createElement('button');
    dupBtn.textContent = '⊕ Duplicate';
    dupBtn.style.cssText = CSS.btn;
    dupBtn.addEventListener('click', () => {
      if (!selectedId) return;
      const cb = window.__gantz?.scene3d?.cityBuilder;
      if (!cb) return;
      const src = cb.getAll().find(p => p.id === selectedId);
      if (!src) return;
      const id2 = cb.place({ ...src, x: src.x + 5, z: src.z + 5 });
      appendRow(id2, cb.getAll().find(e => e.id === id2) || src);
      selectObj(id2);
      savePlacements();
    });
    const snapYBtn = document.createElement('button');
    snapYBtn.textContent = '⇩ Snap Y=0';
    snapYBtn.style.cssText = CSS.btn;
    snapYBtn.addEventListener('click', () => {
      if (!selectedId) return;
      inputs.y.value = '0';
      applyTransform();
    });
    actionRow.appendChild(dupBtn);
    actionRow.appendChild(snapYBtn);

    const inputs = {};
    function makeInputRow(fields, rowLabel) {
      const lbl = document.createElement('div');
      lbl.style.cssText = CSS.label + ';margin-bottom:2px';
      lbl.textContent = rowLabel;
      tfWrap.appendChild(lbl);
      const row = document.createElement('div');
      row.style.cssText = `display:grid;grid-template-columns:repeat(${fields.length},1fr);gap:4px;margin-bottom:5px`;
      tfWrap.appendChild(row);
      for (const [key, step] of fields) {
        const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
        const cell = document.createElement('div');
        cell.style.cssText = 'display:flex;flex-direction:column;gap:1px';
        const sub = document.createElement('div');
        sub.style.cssText = 'color:#006633;font-size:10px;text-align:center';
        sub.textContent = key.toUpperCase();
        const btnUp = document.createElement('button');
        btnUp.textContent = '▲';
        btnUp.style.cssText = CSS.btn + ';padding:0;font-size:9px;line-height:1.4;width:100%';
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = String(step); inp.value = key === 'scale' ? '1' : '0';
        inp.style.cssText = CSS.input + ';text-align:center;padding:2px 1px';
        inp.addEventListener('input', applyTransform);
        const btnDown = document.createElement('button');
        btnDown.textContent = '▼';
        btnDown.style.cssText = CSS.btn + ';padding:0;font-size:9px;line-height:1.4;width:100%';
        btnUp.addEventListener('click', () => { inp.value = ((parseFloat(inp.value) || 0) + step).toFixed(dec); applyTransform(); });
        btnDown.addEventListener('click', () => { inp.value = ((parseFloat(inp.value) || 0) - step).toFixed(dec); applyTransform(); });
        cell.appendChild(sub); cell.appendChild(btnUp); cell.appendChild(inp); cell.appendChild(btnDown);
        row.appendChild(cell);
        inputs[key] = inp;
      }
    }
    makeInputRow([['x', 0.5], ['y', 0.1], ['z', 0.5]], 'POSITION (m)');
    makeInputRow([['rx', 5], ['ry', 5], ['rz', 5]], 'ROTATION (°)');
    makeInputRow([['scale', 0.1]], 'SCALE');

    function applyTransform() {
      if (!selectedId) return;
      const cb = window.__gantz?.scene3d?.cityBuilder;
      if (!cb) return;
      const patch = {};
      for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'scale']) {
        const v = parseFloat(inputs[key].value);
        if (!isNaN(v)) patch[key] = v;
      }
      cb.update(selectedId, patch);
      savePlacements();
    }

    function getDisplayLabel(placement) {
      if (placement.childName) return placement.childName;
      return MODEL_URLS.find(m => m.url === placement.url)?.label ?? placement.url.split('/').pop();
    }

    function selectObj(id) {
      selectedId = id;
      window.__gantz?.scene3d?.cityBuilder?.setSelection(id);
      for (const [rid, row] of placedRows) {
        row.style.background = rid === id ? '#001a08' : '';
        row.style.borderColor = rid === id ? '#00ff44' : '#002208';
      }
      if (!id) { tfWrap.style.display = 'none'; return; }
      tfWrap.style.display = '';
      const entry = (window.__gantz?.scene3d?.cityBuilder?.getAll() ?? []).find(p => p.id === id);
      if (!entry) return;
      tfTitle.textContent = `◈ ${getDisplayLabel(entry)}`;
      for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'scale']) {
        if (document.activeElement !== inputs[key])
          inputs[key].value = (entry[key] ?? (key === 'scale' ? 1 : 0)).toFixed(key === 'scale' ? 2 : 1);
      }
    }

    function appendRow(id, placement) {
      emptyLbl.style.display = 'none';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 5px;border:1px solid #002208;border-radius:2px;margin-bottom:2px;cursor:pointer;font-size:10px';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'flex:1;color:#88ffaa;overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
      lbl.textContent = getDisplayLabel(placement) + ' #' + id;
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'background:none;border:none;color:#aa2222;cursor:pointer;font-size:11px;padding:0 2px;line-height:1;flex-shrink:0';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        window.__gantz?.scene3d?.cityBuilder?.remove(id);
        row.remove();
        placedRows.delete(id);
        if (selectedId === id) selectObj(null);
        if (placedRows.size === 0) emptyLbl.style.display = '';
        savePlacements();
      });
      row.addEventListener('click', () => selectObj(id));
      row.appendChild(lbl); row.appendChild(delBtn);
      listContainer.appendChild(row);
      placedRows.set(id, row);
    }

    // ── Export + Clear buttons
    const utilRow = document.createElement('div');
    utilRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px';
    body.appendChild(utilRow);
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⧉ Export JSON';
    exportBtn.style.cssText = CSS.btn;
    exportBtn.addEventListener('click', () => {
      const all = window.__gantz?.scene3d?.cityBuilder?.getAll() ?? [];
      const json = JSON.stringify(all, null, 2);
      try {
        navigator.clipboard.writeText(json).then(() => {
          exportBtn.textContent = '✓ Copied!';
          setTimeout(() => { exportBtn.textContent = '⧉ Export JSON'; }, 1500);
        });
      } catch (_) { console.log('[cityBuilder export]', json); }
    });
    const clearAllBtn = document.createElement('button');
    clearAllBtn.textContent = '🗑 Clear All';
    clearAllBtn.style.cssText = CSS.btn + ';color:#aa4444;border-color:#441111';
    clearAllBtn.addEventListener('click', () => {
      if (!confirm('Remove all city builder objects?')) return;
      window.__gantz?.scene3d?.cityBuilder?.clearAll();
      while (listContainer.children.length > 1) listContainer.removeChild(listContainer.lastChild);
      emptyLbl.style.display = '';
      placedRows.clear();
      selectObj(null);
      savePlacements();
    });
    utilRow.appendChild(exportBtn);
    utilRow.appendChild(clearAllBtn);

    // ── Persistence
    function savePlacements() {
      const cb = window.__gantz?.scene3d?.cityBuilder;
      if (!cb) return;
      try { localStorage.setItem(CB_KEY, JSON.stringify(cb.getAll())); } catch (_) {}
    }

    setTimeout(() => {
      try {
        const raw = localStorage.getItem(CB_KEY);
        if (!raw) return;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return;
        const cb = window.__gantz?.scene3d?.cityBuilder;
        if (!cb) return;
        for (const p of list) { const id = cb.place(p); appendRow(id, p); }
      } catch (_) {}
    }, 1500);

    // ── onUpdate: scan models once, refresh fly cam UI, bounding box + inputs
    return () => {
      const cb = window.__gantz?.scene3d?.cityBuilder;
      if (!cb) return;

      // Fly cam button state
      const fc = window.__gantz?.scene3d?.flyCam;
      if (fc) {
        flyCamBtn.textContent = fc.active ? '✈ FLY CAM: ON' : '✈ FLY CAM: OFF';
        flyCamBtn.style.color = fc.active ? '#00ff44' : '';
        fcSpeedLbl.textContent = Math.round(fc.speed) + ' m/s';
      }

      // Wire drag callbacks once
      if (!callbacksSet) {
        callbacksSet = true;
        cb.onDragSelect = id => selectObj(id);
        cb.onDragEnd = () => savePlacements();
      }

      if (!modelsScanned) {
        modelsScanned = true;
        let pending = MODEL_URLS.length;
        const optGroupData = new Array(MODEL_URLS.length);
        for (let i = 0; i < MODEL_URLS.length; i++) {
          const m = MODEL_URLS[i]; const idx = i;
          cb.getModelChildren(m.url, children => {
            optGroupData[idx] = { label: m.label, url: m.url, children, noSplit: !!m.noSplit };
            if (--pending === 0) {
              modelSel.innerHTML = '';
              for (const grp of optGroupData) {
                if (!grp) continue;
                const og = document.createElement('optgroup');
                og.label = grp.label;
                if (grp.noSplit) {
                  // Place whole model as one object
                  const opt = document.createElement('option');
                  opt.value = JSON.stringify({ url: grp.url, childName: null });
                  opt.textContent = grp.label;
                  og.appendChild(opt);
                } else {
                  if (grp.children.length > 1) {
                    const allOpt = document.createElement('option');
                    allOpt.value = JSON.stringify({ url: grp.url, childName: null });
                    allOpt.textContent = `(All of ${grp.label})`;
                    og.appendChild(allOpt);
                  }
                  for (const c of grp.children) {
                    if (EXCLUDED_BUILDINGS.has(c.name)) continue;
                    const opt = document.createElement('option');
                    opt.value = JSON.stringify({ url: grp.url, childName: c.name });
                    opt.textContent = c.name || `Object_${c.index}`;
                    og.appendChild(opt);
                  }
                }
                modelSel.appendChild(og);
              }
              scanHint.textContent = `${MODEL_URLS.length} GLBs scanned — pick a building above`;
              scanHint.style.color = '#006633';
            }
          });
        }
      }

      cb.refreshSelection();

      if (!selectedId) return;
      const entry = cb.getAll().find(p => p.id === selectedId);
      if (!entry) return;
      for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'scale']) {
        if (document.activeElement !== inputs[key])
          inputs[key].value = (entry[key] ?? (key === 'scale' ? 1 : 0)).toFixed(key === 'scale' ? 2 : 1);
      }
    };
  });

  // ─── Section: Props (removed) ─────────────────────────────────────────────
  if (false) addSection('props', 'PROPS (lobby)', (body) => {
    const hdr2 = document.createElement('div');
    hdr2.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:6px';
    const typeSel = document.createElement('select');
    typeSel.style.cssText = 'background:#0a1a0a;color:#b0ffb0;border:1px solid #006622;font-family:monospace;font-size:10px;padding:2px 4px;border-radius:2px;flex:1';
    for (const t of PROP_TYPES) {
      const opt = document.createElement('option'); opt.value = opt.textContent = t;
      typeSel.appendChild(opt);
    }
    const placeBtn = document.createElement('button');
    placeBtn.textContent = '＋ Place at player';
    placeBtn.style.cssText = CSS.btn;
    placeBtn.addEventListener('click', () => {
      const g = window.__gantz;
      if (!g?.player || !lobbyProps) { return; }
      const p = g.player;
      const type = typeSel.value;
      propCounter++;
      const id = `devprop-${propCounter}`;
      const r = PROP_RADII[type] || 0.4;
      const collider = { kind: 'circle', x: p.x, y: p.y, r, tier: 'hard', _propRef: id };
      const entry = { type, x: p.x, y: p.y, facing: p.facing || 0, _propId: id, collider };
      devProps.push(entry);
      lobbyProps.push({ type, x: p.x, y: p.y });
      lobbyColliders.push(collider);
      appendPropRow(entry);
      savePropData();
    });
    hdr2.appendChild(typeSel); hdr2.appendChild(placeBtn);
    body.appendChild(hdr2);

    const propsContainer = document.createElement('div');
    body.appendChild(propsContainer);

    function appendPropRow(entry) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;border:1px solid #002208;border-radius:2px;padding:4px 5px';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'flex:1;color:#88ffaa;font-size:10px';
      lbl.textContent = `${entry.type} (${entry.x.toFixed(1)}, ${entry.y.toFixed(1)})`;
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'background:none;border:none;color:#aa2222;cursor:pointer;font-size:12px;padding:0 2px;line-height:1';
      delBtn.addEventListener('click', () => {
        const di = devProps.indexOf(entry);
        if (di !== -1) devProps.splice(di, 1);
        // Remove from lobbyProps
        const pi = lobbyProps?.findIndex(p => p.type === entry.type && p.x === entry.x && p.y === entry.y);
        if (pi != null && pi !== -1) lobbyProps.splice(pi, 1);
        // Remove collider
        const ci = lobbyColliders.indexOf(entry.collider);
        if (ci !== -1) lobbyColliders.splice(ci, 1);
        row.remove();
        savePropData();
      });
      row.appendChild(lbl); row.appendChild(delBtn);
      propsContainer.appendChild(row);
    }

    function savePropData() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        data.devProps = devProps.map(e => ({ type: e.type, x: e.x, y: e.y }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (_) {}
    }

    // Restore saved props
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.devProps) && lobbyProps) {
          for (const saved of data.devProps) {
            propCounter++;
            const id = `devprop-${propCounter}`;
            const r = PROP_RADII[saved.type] || 0.4;
            const collider = { kind: 'circle', x: saved.x, y: saved.y, r, tier: 'hard', _propRef: id };
            const entry = { type: saved.type, x: saved.x, y: saved.y, facing: 0, _propId: id, collider };
            devProps.push(entry);
            lobbyProps.push({ type: saved.type, x: saved.x, y: saved.y });
            lobbyColliders.push(collider);
            appendPropRow(entry);
          }
        }
      }
    } catch (_) {}

    return null;
  });

  function syncBoundInputs(inps) {
    const B = readBounds();
    for (const [k, inp] of Object.entries(inps)) {
      if (document.activeElement !== inp) inp.value = B[k].toFixed(2);
    }
  }

  // ─── Open / close ─────────────────────────────────────────────────────────
  let open = false;
  function setOpen(v) {
    open = v;
    devBtn.style.background = v ? '#001a08' : '#0a1a0a';
    for (const { collapseSection } of sections.values()) collapseSection?.();
    if (v) {
      panel.style.display = 'block';
      requestAnimationFrame(() => {
        panel.style.opacity = '1';
        panel.style.transform = 'none';
      });
    } else {
      if (_mapWin) { _mapWin.style.display = 'none'; _mapVisible = false; }
      panel.style.opacity = '0';
      panel.style.transform = 'translateY(-6px) scale(0.98)';
      const onEnd = () => {
        panel.style.display = 'none';
        panel.removeEventListener('transitionend', onEnd);
      };
      panel.addEventListener('transitionend', onEnd);
    }
  }
  devBtn.addEventListener('click', () => setOpen(!open));

  // ─── Main update — call once per frame ────────────────────────────────────
  function update() {
    const player = getPlayer();
    const isLJ   = player?.username === 'LJ';
    devBtn.style.display = isLJ ? 'block' : 'none';
    if (!isLJ && open) setOpen(false);
    if (!open) return;
    for (const { onUpdate } of sections.values()) {
      if (onUpdate) onUpdate(player);
    }
    getScene3d()?.setDevZones(customZones);
  }

  return { update, addSection };
}

// ─── Draggable window ─────────────────────────────────────────────────────────
function _makeDraggable(el, handle) {
  handle.addEventListener('mousedown', ev => {
    if (ev.target.closest?.('button, input, select')) return;
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.left = rect.left + 'px'; el.style.top = rect.top + 'px';
    let sx = ev.clientX, sy = ev.clientY, sl = rect.left, st = rect.top;
    function onMove(e) {
      el.style.left = (sl + e.clientX - sx) + 'px';
      el.style.top  = (st + e.clientY - sy) + 'px';
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ─── Resizable window ─────────────────────────────────────────────────────────
function _addResizeHandle(el, minW = 200, minH = 100) {
  const handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;bottom:0;right:0;width:12px;height:12px;cursor:se-resize;z-index:1;background:linear-gradient(135deg,transparent 50%,#003311 50%)';
  el.style.position = el.style.position || 'fixed';
  el.appendChild(handle);
  handle.addEventListener('mousedown', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const rect = el.getBoundingClientRect();
    let sw = rect.width, sh = rect.height, sx = ev.clientX, sy = ev.clientY;
    function onMove(e) {
      const nw = Math.max(minW, sw + e.clientX - sx);
      const nh = Math.max(minH, sh + e.clientY - sy);
      el.style.width = nw + 'px';
      el.style.height = nh + 'px';
      el.style.maxHeight = 'none';
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ─── Canvas drag setup ────────────────────────────────────────────────────────
function _setupCanvasDrag(canvas, readBounds, applyBounds, onChanged, getCustomZones, onDragEnd, onShiftClick) {
  const THRESH = 9;
  let drag     = null; // room-edge drag: { id, axis, get, set }
  let moveDrag = null; // zone move drag: { zone, startGX, startGY, origX, origY }
  let panDrag  = null; // middle-mouse pan: { sx, sy, x0, x1, y0, y1 }

  function getEdges() {
    return [
      { id: 'maxX', axis: 'x', get: () => readBounds().maxX, set: v => { const b=readBounds(); b.maxX=Math.max(b.minX+0.5,+v.toFixed(2)); applyBounds(b); onChanged(); } },
      { id: 'minX', axis: 'x', get: () => readBounds().minX, set: v => { const b=readBounds(); b.minX=Math.min(b.maxX-0.5,+v.toFixed(2)); applyBounds(b); onChanged(); } },
      { id: 'maxY', axis: 'y', get: () => readBounds().maxY, set: v => { const b=readBounds(); b.maxY=Math.max(b.minY+0.5,+v.toFixed(2)); applyBounds(b); onChanged(); } },
      { id: 'minY', axis: 'y', get: () => readBounds().minY, set: v => { const b=readBounds(); b.minY=Math.min(b.maxY-0.5,+v.toFixed(2)); applyBounds(b); onChanged(); } },
    ];
  }

  function edgePx(edge) {
    const v = edge.get();
    return edge.axis === 'x' ? gameToCanvas(v, 0)[0] : gameToCanvas(0, v)[1];
  }

  function nearestEdge(px, py) {
    for (const e of getEdges()) {
      const ep = edgePx(e);
      if ((e.axis === 'x' ? Math.abs(px - ep) : Math.abs(py - ep)) < THRESH) return e;
    }
    return null;
  }

  function zoneAtPoint(gx, gy) {
    const zones = getCustomZones?.() || [];
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (z.kind === 'circle') {
        if (Math.hypot(gx - z.x, gy - z.y) <= (z.r || 1)) return z;
      } else {
        if (gx >= z.x - z.w / 2 && gx <= z.x + z.w / 2 &&
            gy >= z.y - z.h / 2 && gy <= z.y + z.h / 2) return z;
      }
    }
    return null;
  }

  canvas.addEventListener('mousedown', ev => {
    const r = canvas.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    if (ev.button === 1) {
      ev.preventDefault();
      panDrag = { sx: ev.clientX, sy: ev.clientY, x0: VIEW_X0, x1: VIEW_X1, y0: VIEW_Y0, y1: VIEW_Y1 };
      return;
    }
    if (ev.shiftKey) {
      const [gx, gy] = canvasToGame(px, py);
      onShiftClick?.(gx, gy);
      ev.preventDefault(); return;
    }
    const e = nearestEdge(px, py);
    if (e) { drag = e; ev.preventDefault(); return; }
    const [gx, gy] = canvasToGame(px, py);
    const z = zoneAtPoint(gx, gy);
    if (z) { moveDrag = { zone: z, startGX: gx, startGY: gy, origX: z.x, origY: z.y }; ev.preventDefault(); }
  });

  window.addEventListener('mousemove', ev => {
    const r = canvas.getBoundingClientRect();
    if (panDrag) {
      const dx = (ev.clientX - panDrag.sx) / CANVAS_W * (panDrag.x1 - panDrag.x0);
      const dy = (ev.clientY - panDrag.sy) / CANVAS_H * (panDrag.y1 - panDrag.y0);
      VIEW_X0 = panDrag.x0 - dx; VIEW_X1 = panDrag.x1 - dx;
      VIEW_Y0 = panDrag.y0 - dy; VIEW_Y1 = panDrag.y1 - dy;
      return;
    }
    if (drag) {
      const [gx, gy] = canvasToGame(ev.clientX - r.left, ev.clientY - r.top);
      drag.set(drag.axis === 'x' ? gx : gy);
    }
    if (moveDrag) {
      const [gx, gy] = canvasToGame(ev.clientX - r.left, ev.clientY - r.top);
      moveDrag.zone.x = +(moveDrag.origX + gx - moveDrag.startGX).toFixed(2);
      moveDrag.zone.y = +(moveDrag.origY + gy - moveDrag.startGY).toFixed(2);
    }
  });

  window.addEventListener('mouseup', ev => {
    if (ev.button === 1) { panDrag = null; return; }
    const wasDragging = drag || moveDrag;
    drag = null; moveDrag = null;
    if (wasDragging) onDragEnd?.();
  });

  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  canvas.addEventListener('mousemove', ev => {
    if (drag || moveDrag || panDrag) return;
    const r  = canvas.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const e  = nearestEdge(px, py);
    if (e) { canvas.style.cursor = e.axis === 'x' ? 'ew-resize' : 'ns-resize'; return; }
    const [gx, gy] = canvasToGame(px, py);
    canvas.style.cursor = zoneAtPoint(gx, gy) ? 'move' : 'crosshair';
  });

  canvas._getDrag     = () => drag;
  canvas._getMoveDrag = () => moveDrag;

  // Scroll to zoom around mouse cursor
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const [gx, gy] = canvasToGame(px, py);
    const factor = ev.deltaY > 0 ? 1.18 : 1 / 1.18;
    VIEW_X0 = gx + (VIEW_X0 - gx) * factor;
    VIEW_X1 = gx + (VIEW_X1 - gx) * factor;
    VIEW_Y0 = gy + (VIEW_Y0 - gy) * factor;
    VIEW_Y1 = gy + (VIEW_Y1 - gy) * factor;
  }, { passive: false });
}

// ─── Collision canvas draw ────────────────────────────────────────────────────
function _drawCollisionCanvas(ctx, W, H, lobbyWalls, readBounds, player, customZones, canvas) {
  ctx.clearRect(0, 0, W, H);
  const B        = readBounds();
  const drag     = canvas._getDrag?.();
  const moveDrag = canvas._getMoveDrag?.();

  // Grid
  ctx.strokeStyle = '#0a200a'; ctx.lineWidth = 0.5;
  for (let gx = Math.ceil(VIEW_X0); gx <= VIEW_X1; gx++) {
    const [px] = gameToCanvas(gx, 0);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }
  for (let gy = Math.ceil(VIEW_Y0); gy <= VIEW_Y1; gy++) {
    const [, py] = gameToCanvas(0, gy);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = '#0a380a'; ctx.lineWidth = 1;
  const [ox, oy] = gameToCanvas(0, 0);
  ctx.beginPath(); ctx.moveTo(ox, 0);  ctx.lineTo(ox, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,  oy); ctx.lineTo(W,  oy); ctx.stroke();

  // Room fill
  const [rx0, ry0] = gameToCanvas(B.minX, B.minY);
  const [rx1, ry1] = gameToCanvas(B.maxX, B.maxY);
  ctx.fillStyle = 'rgba(0,80,0,0.12)';
  ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);

  // Lobby walls (cyan)
  for (const w of lobbyWalls) {
    const [wx0, wy0] = gameToCanvas(w.x - w.w / 2, w.y - w.h / 2);
    const [wx1, wy1] = gameToCanvas(w.x + w.w / 2, w.y + w.h / 2);
    ctx.fillStyle = 'rgba(0,200,100,0.2)'; ctx.strokeStyle = '#00cc44'; ctx.lineWidth = 1;
    ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    ctx.strokeRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  }

  // Custom zones (orange; yellow when dragged; dimmed when player is outside height range)
  const eBottom = player?.jumpY || 0;
  const eTop    = eBottom + 1.8;
  for (const z of customZones) {
    const hot = moveDrag?.zone === z;
    const hasHeight = z.yMin !== undefined;
    const inRange   = !hasHeight || (eTop > (z.yMin ?? -Infinity) && eBottom < (z.yMax ?? Infinity));
    const off = !!z.hidden;
    ctx.fillStyle   = hot ? 'rgba(255,220,0,0.28)' : off ? 'rgba(255,140,0,0.04)' : inRange ? 'rgba(255,140,0,0.18)' : 'rgba(255,140,0,0.06)';
    ctx.strokeStyle = hot ? '#ffdd00' : off ? '#443300' : inRange ? '#ff8800' : '#664400';
    ctx.lineWidth   = hot ? 2 : 1;
    if (off) ctx.setLineDash([3, 3]);
    const label = (off ? '○ ' : '') + (hasHeight ? `Z${z._devId} ↕${z.yMin?.toFixed(1)}-${z.yMax?.toFixed(1)}` : `Z${z._devId}`);
    if (z.kind === 'circle') {
      const [czx, czy] = gameToCanvas(z.x, z.y);
      const cr = Math.abs(gameToCanvas(z.x + (z.r || 1), z.y)[0] - czx);
      ctx.beginPath(); ctx.arc(czx, czy, cr, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(czx, czy, cr, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hot ? '#ffdd00' : off ? '#554422' : inRange ? '#ffaa44' : '#885522';
      ctx.font = '9px monospace';
      ctx.fillText(label, czx - label.length * 2.7, czy + 3);
    } else {
      const [zx0, zy0] = gameToCanvas(z.x - z.w / 2, z.y - z.h / 2);
      const [zx1, zy1] = gameToCanvas(z.x + z.w / 2, z.y + z.h / 2);
      ctx.fillRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
      ctx.strokeRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
      ctx.setLineDash([]);
      ctx.fillStyle = hot ? '#ffdd00' : off ? '#554422' : inRange ? '#ffaa44' : '#885522';
      ctx.font = '9px monospace';
      ctx.fillText(label, (zx0 + zx1) / 2 - label.length * 2.7, (zy0 + zy1) / 2 + 3);
    }
  }

  // Room-edge drag indicators (dashed lines)
  for (const [edgeId, axis, getVal] of [
    ['maxX','x', () => B.maxX], ['minX','x', () => B.minX],
    ['maxY','y', () => B.maxY], ['minY','y', () => B.minY],
  ]) {
    const v   = getVal();
    const ep  = axis === 'x' ? gameToCanvas(v, 0)[0] : gameToCanvas(0, v)[1];
    const hot = drag?.id === edgeId;
    ctx.strokeStyle = hot ? '#ffff00' : '#00ff88';
    ctx.lineWidth   = hot ? 2 : 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (axis === 'x') { ctx.moveTo(ep, 0); ctx.lineTo(ep, H); }
    else              { ctx.moveTo(0, ep); ctx.lineTo(W, ep); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = hot ? '#ffff00' : '#00ff44';
    ctx.font = '9px monospace';
    if (axis === 'x') ctx.fillText(`${edgeId}=${v.toFixed(2)}`, ep + 3, 12);
    else              ctx.fillText(`${edgeId}=${v.toFixed(2)}`, 3, ep - 3);
  }

  // Gantz ball collider
  const [bx, by] = gameToCanvas(0, -4);
  const br = Math.abs(gameToCanvas(1.2 * 0.8, -4)[0] - bx);
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#666'; ctx.font = '8px monospace';
  ctx.fillText('GANTZ', bx + br + 2, by + 3);

  // Player dot + facing arrow
  if (player?.x != null) {
    const [px, py] = gameToCanvas(player.x, player.y);
    const f = player.facing ?? 0;
    const [fpx, fpy] = gameToCanvas(player.x + Math.cos(f) * 1.0, player.y + Math.sin(f) * 1.0);
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff44'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fpx, fpy);
    ctx.strokeStyle = '#88ff88'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#88ff88'; ctx.font = '9px monospace';
    ctx.fillText('YOU', px + 5, py - 4);
  }

  // Footer hint
  ctx.fillStyle = '#004422'; ctx.font = '9px monospace';
  ctx.fillText(`drag edges/zones · shift+click to teleport  |  X:${VIEW_X0}→${VIEW_X1}  Y:${VIEW_Y0}→${VIEW_Y1}`, 3, H - 3);
}
