import { isInputSuspended } from '../engine/input.js';

const HISTORY_KEY = 'gantz:chat-history';
const MAX = 40;

// Load persisted history from localStorage (array of serialised message objects)
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(entries) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-MAX))); } catch {}
}

export function createChatUI({ onSend, onSuspendInput }) {
  const logWrapEl  = document.getElementById('chat-log-wrap');
  const logEl      = document.getElementById('chat-log');
  const formEl     = document.getElementById('chat-form');
  const inputEl    = document.getElementById('chat-input');
  const huntersEl  = document.getElementById('chat-hunters-list');

  let open = false;
  let userScrolled = false;
  // In-memory list mirrors what's in localStorage
  let history = loadHistory();

  // Track manual scroll so auto-scroll doesn't fight the user
  logWrapEl.addEventListener('scroll', () => {
    const atBottom = logWrapEl.scrollHeight - logWrapEl.scrollTop - logWrapEl.clientHeight < 10;
    userScrolled = !atBottom;
  });

  function scrollToBottom() {
    logWrapEl.scrollTop = logWrapEl.scrollHeight;
  }

  // ── DOM builders ─────────────────────────────────────────────────────────
  function timestamp() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `[${h}:${m}]`;
  }

  function buildMsgEl(entry) {
    const row = document.createElement('div');
    row.className = 'chat-msg';
    const ts = document.createElement('span');
    ts.className = 'chat-ts';
    ts.textContent = entry.ts;
    const u = document.createElement('span');
    u.className = 'chat-u';
    u.style.color = '#' + String(entry.color || 'c8142b').replace('#', '');
    u.textContent = entry.username || 'Hunter';
    row.appendChild(ts);
    row.appendChild(u);
    row.appendChild(document.createTextNode(': ' + (entry.text || '')));
    return row;
  }

  function buildSystemEl(entry) {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-system';
    const ts = document.createElement('span');
    ts.className = 'chat-ts';
    ts.textContent = entry.ts;
    row.appendChild(ts);
    row.appendChild(document.createTextNode(entry.text || ''));
    return row;
  }

  // ── Render persisted history on load ────────────────────────────────────
  for (const entry of history) {
    logEl.appendChild(entry.type === 'system' ? buildSystemEl(entry) : buildMsgEl(entry));
  }
  scrollToBottom();

  function persist(entry) {
    history.push(entry);
    if (history.length > MAX) history = history.slice(-MAX);
    // Prune DOM to match
    while (logEl.children.length > MAX) logEl.removeChild(logEl.firstChild);
    saveHistory(history);
    if (!userScrolled) scrollToBottom();
  }

  // ── Open / close (only the input row toggles) ────────────────────────────
  function openChat() {
    if (open) return;
    open = true;
    formEl.style.display = 'flex';
    inputEl.focus();
    onSuspendInput(true);
    userScrolled = false;
    scrollToBottom();
  }

  function closeChat() {
    if (!open) return;
    open = false;
    formEl.style.display = 'none';
    inputEl.value = '';
    inputEl.blur();
    onSuspendInput(false);
  }

  addEventListener('keydown', e => {
    if (document.activeElement === inputEl) return;
    if (isInputSuspended() && !open) return;
    const k = e.key;
    if (k === 't' || k === 'T' || k === 'Enter') { e.preventDefault(); openChat(); }
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
  });

  formEl.addEventListener('submit', e => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (text) onSend(text);
    closeChat();
  });

  // ── Public API ────────────────────────────────────────────────────────────
  function add(msg) {
    const entry = {
      type: 'msg',
      ts: timestamp(),
      username: msg.username || 'Hunter',
      color: String(msg.color || 'c8142b').replace('#', ''),
      text: msg.text || '',
    };
    logEl.appendChild(buildMsgEl(entry));
    persist(entry);
  }

  function addSystem(text) {
    const entry = { type: 'system', ts: timestamp(), text: text || '' };
    logEl.appendChild(buildSystemEl(entry));
    persist(entry);
  }

  // hunters: array of { name, color, local, status }
  // status: 'lobby' | 'mission_alive' | 'mission_dead'
  function updateHunters(hunters) {
    huntersEl.innerHTML = '';
    for (const h of hunters) {
      const icon =
        h.status === 'mission_alive' ? '⚔\uFE0E' :
        h.status === 'mission_dead'  ? '☠\uFE0E' :
                                       '●';          // gantz ball (lobby)
      const div = document.createElement('div');
      div.className = 'chat-hunter' + (h.local ? ' chat-hunter-local' : '');
      div.style.color = '#' + String(h.color || '00e05a').replace('#', '');

      const iconSpan = document.createElement('span');
      iconSpan.className = 'hunter-icon';
      iconSpan.textContent = icon + ' ';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = h.name || 'Hunter';

      div.appendChild(iconSpan);
      div.appendChild(nameSpan);
      div.title = h.name || 'Hunter';
      huntersEl.appendChild(div);
    }
  }

  return { add, addSystem, openChat, closeChat, isOpen: () => open, updateHunters };
}
