import { isInputSuspended } from '../engine/input.js';

export function createChatUI({ onSend, onSuspendInput }) {
  const chatEl  = document.getElementById('chat');
  const logEl   = document.getElementById('chat-log');
  const formEl  = document.getElementById('chat-form');
  const inputEl = document.getElementById('chat-input');
  const MAX = 20;
  let open = false;
  let userScrolled = false;
  let fadeTimer = null;
  const FADE_DELAY_MS = 6000;

  function scheduleFade() {
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { chatEl.style.opacity = '0'; }, FADE_DELAY_MS);
  }

  function showChat() {
    clearTimeout(fadeTimer);
    chatEl.style.opacity = '1';
  }

  // Start faded until first message
  chatEl.style.opacity = '0';

  logEl.addEventListener('scroll', () => {
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 10;
    userScrolled = !atBottom;
  });

  function openChat() {
    if (open) return;
    open = true;
    showChat();
    formEl.style.display = 'block';
    inputEl.focus();
    onSuspendInput(true);
  }

  function closeChat() {
    if (!open) return;
    open = false;
    formEl.style.display = 'none';
    inputEl.value = '';
    inputEl.blur();
    onSuspendInput(false);
    scheduleFade();
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
    if (e.key === 'Escape') {
      e.preventDefault();
      closeChat();
    }
  });

  formEl.addEventListener('submit', e => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (text) onSend(text);
    closeChat();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function add(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const u = document.createElement('span');
    u.className = 'u';
    u.style.color = '#' + (msg.color || 'c8142b');
    u.textContent = msg.username;
    div.appendChild(u);
    div.appendChild(document.createTextNode(': '));
    div.appendChild(document.createTextNode(msg.text));
    logEl.appendChild(div);

    while (logEl.children.length > MAX) logEl.removeChild(logEl.firstChild);

    if (!userScrolled) logEl.scrollTop = logEl.scrollHeight;

    showChat();
    scheduleFade();
  }

  return { add, openChat, closeChat, isOpen: () => open };
}
