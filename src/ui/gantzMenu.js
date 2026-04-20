function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const SHOP_ITEMS = [
  { key: 'weapon_rare', cost: 100, label: 'Get a Powerful Weapon' },
  { key: 'suit',        cost: 100, label: 'Upgrade Gantz Suit' },
  { key: 'revive',      cost: 100, label: 'Revive Player From Memory' },
];

export function createGantzMenu({ onOpen, onClose, onReadyToggle, onShopBuy, onBuyResult, getState, getPhase, getGantzTalking }) {
  const menuEl = document.getElementById('gantz-menu');
  const readyBtn = document.getElementById('menu-ready');
  const shopBtn = document.getElementById('menu-shop');
  const pointsBtn = document.getElementById('menu-points');
  const panelEl = document.getElementById('menu-panel');

  let open = false;
  let activeTab = null;

  function phaseAllowsShop() {
    const p = getPhase ? getPhase() : 'LOBBY';
    return p === 'LOBBY' || p === 'DEBRIEF';
  }
  function phaseAllowsReady() {
    const p = getPhase ? getPhase() : 'LOBBY';
    return p === 'LOBBY' || p === 'DEBRIEF';
  }

  function updateReadyBtn() {
    const s = getState();
    const afk = s.localAfk;
    readyBtn.classList.toggle('active', s.localReady);
    readyBtn.disabled = !phaseAllowsReady();
    shopBtn.disabled = !phaseAllowsShop();
    if (!phaseAllowsReady()) {
      readyBtn.textContent = 'Ready for Mission (locked)';
    } else if (afk && s.localReady) {
      readyBtn.textContent = 'READY (auto — AFK)';
    } else if (s.localReady) {
      readyBtn.textContent = '✓ READY — click to cancel';
    } else {
      readyBtn.textContent = 'Ready for Mission';
    }
  }

  function openMenu() {
    if (open) return;
    open = true;
    // Don't show HTML panel — display is rendered on the ball canvas.
    // Still set the style attribute so the MutationObserver triggers pointer-lock exit.
    menuEl.style.display = 'flex';
    activeTab = null;
    panelEl.innerHTML = '<div class="menu-hint">You stand before the black sphere. It waits.</div>';
    updateReadyBtn();
    onOpen();
  }

  function closeMenu() {
    if (!open) return;
    open = false;
    menuEl.style.display = 'none';
    activeTab = null;
    onClose();
  }

  let lastShopResult = null;
  function renderShop() {
    const s = getState();
    const pts = s.localPoints;
    const rows = [
      { key: 'weapon_rare', cost: 100, label: 'Get a Powerful Weapon' },
      { key: 'suit',        cost: 100, label: 'Upgrade Gantz Suit' },
      { key: 'revive',      cost: 100, label: 'Revive Player From Memory' },
    ];
    const btns = rows.map(r => {
      const canAfford = pts >= r.cost;
      return `<button class="shop-btn ${canAfford ? '' : 'disabled'}" data-key="${r.key}" data-cost="${r.cost}" ${canAfford ? '' : 'disabled'}>
        <span class="sb-label">${r.label}</span>
        <span class="sb-cost">${r.cost} pt</span>
      </button>`;
    }).join('');
    const resultHtml = lastShopResult
      ? `<div id="shop-result" class="shop-result ${lastShopResult.ok ? 'ok' : 'bad'}">${escapeHtml(lastShopResult.msg)}</div>`
      : `<div id="shop-result" class="shop-result"></div>`;
    panelEl.innerHTML = `
      <div class="menu-section-title">HUNDRED POINT MENU</div>
      <div class="menu-info dim">You have <span class="accent">${pts} pt</span>. Gantz never tells you exactly what you'll get.</div>
      <div class="shop-list">${btns}</div>
      ${resultHtml}
    `;
    panelEl.querySelectorAll('.shop-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const cost = parseInt(btn.dataset.cost, 10);
        if (onShopBuy) {
          lastShopResult = onShopBuy(key, cost) || null;
          if (lastShopResult && onBuyResult) onBuyResult(lastShopResult);
        }
        renderShop();
      });
    });
  }

  function renderPoints() {
    const s = getState();
    const rows = [];
    rows.push({
      type: 'self',
      name: s.localName + ' (you)',
      points: s.localPoints,
      ready: s.localReady,
    });
    for (const p of s.remotes) {
      rows.push({
        type: 'human',
        name: p.username || '?',
        points: p.points || 0,
        ready: !!p.ready,
      });
    }
    const total = rows.length;
    const readyCount = rows.filter(r => r.ready).length;
    const headerHtml = `
      <div class="menu-section-title">POINT TOTALS</div>
      <div class="menu-info dim">${readyCount} of ${total} ready</div>
    `;
    const rowsHtml = rows.map(r => `
      <div class="pt-row ${r.type}">
        <span class="pt-name">${escapeHtml(r.name)}</span>
        <span class="pt-points">${r.points}pt</span>
        <span class="pt-ready ${r.ready ? 'on' : ''}">${r.ready ? 'READY' : '—'}</span>
      </div>
    `).join('');
    panelEl.innerHTML = `${headerHtml}<div class="pt-list">${rowsHtml}</div>`;
  }

  function refreshActiveTab() {
    if (activeTab === 'shop') renderShop();
    else if (activeTab === 'points') renderPoints();
  }

  readyBtn.addEventListener('click', () => {
    onReadyToggle();
    updateReadyBtn();
    refreshActiveTab();
  });

  shopBtn.addEventListener('click', () => {
    if (!phaseAllowsShop()) return;
    activeTab = 'shop';
    renderShop();
  });

  pointsBtn.addEventListener('click', () => {
    activeTab = 'points';
    renderPoints();
  });

  addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'e' || e.key === 'E') {
      if (getGantzTalking && getGantzTalking()) return;
      e.preventDefault();
      closeMenu();
    }
  });

  menuEl.addEventListener('click', (e) => {
    if (e.target === menuEl) closeMenu();
  });

  function getMenuData() {
    return {
      open,
      activeTab,
      state: getState(),
      phase: getPhase ? getPhase() : 'LOBBY',
      shopItems: SHOP_ITEMS,
      lastShopResult,
    };
  }

  function handleAction(action) {
    if (!open) return;
    switch (action) {
      case 'ready':
        if (phaseAllowsReady()) { onReadyToggle(); updateReadyBtn(); }
        break;
      case 'shop':
        if (phaseAllowsShop()) activeTab = 'shop';
        break;
      case 'buy:revive':
        if (phaseAllowsShop()) activeTab = 'revive';
        break;
      case 'points':
        activeTab = 'points';
        break;
      case 'lifetime':
        activeTab = 'lifetime';
        break;
      case 'back':
        activeTab = null;
        lastShopResult = null;
        break;
      case 'close':
        closeMenu();
        break;
      default:
        if (action.startsWith('buy:')) {
          const key = action.slice(4);
          const item = SHOP_ITEMS.find(i => i.key === key);
          if (item && onShopBuy) {
            lastShopResult = onShopBuy(key, item.cost) || null;
            if (lastShopResult && onBuyResult) onBuyResult(lastShopResult);
          }
        } else if (action.startsWith('revive:')) {
          const targetId = action.slice(7);
          if (onShopBuy) {
            lastShopResult = onShopBuy('revive', 100, targetId) || null;
            if (lastShopResult && onBuyResult) onBuyResult(lastShopResult);
          }
        }
    }
  }

  return {
    openMenu,
    closeMenu,
    isOpen: () => open,
    refresh: () => { updateReadyBtn(); refreshActiveTab(); },
    getMenuData,
    handleAction,
  };
}
