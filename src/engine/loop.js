export function startLoop({ update, render }) {
  const STEP = 1 / 60;
  const MAX_ACC = 0.25;
  let last = performance.now();
  let acc = 0;

  function tick(now) {
    const delta = (now - last) / 1000;
    last = now;
    acc = Math.min(MAX_ACC, acc + delta);
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
    // Fractional position inside the current fixed step (0..1). render()
    // uses this to smoothly interpolate the local player's pose between
    // the last two simulated states so movement looks smooth on displays
    // with refresh rates higher than the fixed-step rate (120/144/165Hz),
    // which otherwise produces a stroboscopic stutter relative to objects
    // that are interpolated every render frame (remote players, bullets).
    const alpha = acc / STEP;
    render(delta, alpha);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
