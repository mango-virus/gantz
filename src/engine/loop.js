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
    render(delta);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
