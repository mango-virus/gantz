const keys = new Set();
const keysPressed = new Set();
const keysReleased = new Set();
const mouse = {
  x: 0, y: 0,
  worldX: 0, worldY: 0,
  left: false, right: false,
  leftPressed: false, rightPressed: false,
};

const PREVENT_DEFAULT_KEYS = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab',
]);

let suspended = false;

export function setInputSuspended(v) {
  suspended = !!v;
  if (suspended) {
    keys.clear();
    keysPressed.clear();
    keysReleased.clear();
  }
}

export function isInputSuspended() { return suspended; }

export function initInput(canvas) {
  addEventListener('keydown', e => {
    if (suspended) return;
    const k = e.key.toLowerCase();
    if (PREVENT_DEFAULT_KEYS.has(k)) e.preventDefault();
    if (!keys.has(k)) keysPressed.add(k);
    keys.add(k);
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    keysReleased.add(k);
  });
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  });
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) { if (!mouse.left) mouse.leftPressed = true; mouse.left = true; }
    if (e.button === 2) { if (!mouse.right) mouse.rightPressed = true; mouse.right = true; }
  });
  canvas.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', () => {
    keys.clear();
    mouse.left = mouse.right = false;
  });
}

export function isDown(k) { return keys.has(k); }
export function wasPressed(k) { return keysPressed.has(k); }
export function wasReleased(k) { return keysReleased.has(k); }

export function moveAxis() {
  if (suspended) return { x: 0, y: 0 };
  let x = 0, y = 0;
  if (isDown('w') || isDown('arrowup'))    y -= 1;
  if (isDown('s') || isDown('arrowdown'))  y += 1;
  if (isDown('a') || isDown('arrowleft'))  x -= 1;
  if (isDown('d') || isDown('arrowright')) x += 1;
  const l = Math.hypot(x, y);
  return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

export function getMouse() { return mouse; }

export function setMouseWorld(wx, wy) {
  mouse.worldX = wx;
  mouse.worldY = wy;
}

export function endFrameInput() {
  keysPressed.clear();
  keysReleased.clear();
  mouse.leftPressed = false;
  mouse.rightPressed = false;
}
