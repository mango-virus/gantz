import { isInputSuspended } from '../engine/input.js';

export function createChatUI({ onSend, onSuspendInput }) {
  const logWrapEl  = document.getElementById('chat-log-wrap');
  const logEl      = document.getElementById('chat-log');
  const formEl     = document.getElementById('chat-form');
  const inputEl    = document.getElementById('chat-input');
  const huntersEl  = document.getElementById('chat-hunters-list');
  const countEl    = document.getElementById('chat-hunters-count');

  const MAX = 40;
  let open = false;
  let userScrolled = false;

  // Track manual scroll so auto-scroll doesn't fight the user
  logWrapEl.addEventListener('scroll', () => {
    const atBottom = logWrapEl.scrollHeight - logWrapEl.scrollTop - logWrapEl.clientHeight < 10;
    userScrolled = !atBottom;
  });

  function scrollToBottom() {
    logWrapEl.scrollTop = logWrapEl.scrollHeight;
  }

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
    if (k === 't' || k === 'T' || k === 'Enter') {
      e.preventDefault();
      openChat();
    }
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

  function timestamp() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `[${h}:${m}]`;
  }

  function appendMsg(el) {
    logEl.appendChild(el);
    while (logEl.children.length > MAX) logEl.removeChild(logEl.firstChild);
    if (!userScrolled) scrollToBottom();
  }

  function add(msg) {
    const row = document.createElement('div');
    row.className = 'chat-msg';

    const ts = document.createElement('span');
    ts.className = 'chat-ts';
    ts.textContent = timestamp();

    const u = document.createElement('span');
    u.className = 'chat-u';
    u.style.color = '#' + String(msg.color || 'c8142b').replace('#', '');
    u.textContent = msg.username || 'Hunter';

    row.appendChild(ts);
    row.appendChild(u);
    row.appendChild(document.createTextNode(': ' + (msg.text || '')));
    appendMsg(row);
  }

  function addSystem(text) {
    const row = document.createElement('div');
    row.className = 'chat-msg chat-system';
    const ts = document.createElement('span');
    ts.className = 'chat-ts';
    ts.textContent = timestamp();
    row.appendChild(ts);
    row.appendChild(document.createTextNode(text || ''));
    appendMsg(row);
  }

  // hunters: array of { name, color, local }
  function updateHunters(hunters) {
    huntersEl.innerHTML = '';
    for (const h of hunters) {
      const div = document.createElement('div');
      div.className = 'chat-hunter' + (h.local ? ' chat-hunter-local' : '');
      div.style.color = '#' + String(h.color || '00e05a').replace('#', '');
      div.textContent = '▸ ' + (h.name || 'Hunter');
      div.title = h.name || 'Hunter';
      huntersEl.appendChild(div);
    }
    if (countEl) {
      const n = hunters.length;
      countEl.textContent = n + (n === 1 ? ' HUNTER' : ' HUNTERS');
    }
  }

  return { add, addSystem, openChat, closeChat, isOpen: () => open, updateHunters };
}
