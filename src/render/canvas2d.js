const PIXELS_PER_METER = 40;

export function createCanvas2DRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let cam = { x: 0, y: 0, zoom: 1 };

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
  }
  addEventListener('resize', resize);
  resize();

  function worldTransform() {
    const s = PIXELS_PER_METER * cam.zoom * dpr;
    ctx.setTransform(s, 0, 0, s,
      (W * 0.5) * dpr - cam.x * s,
      (H * 0.5) * dpr - cam.y * s);
  }

  function screenTransform() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(x, y) {
    const s = PIXELS_PER_METER * cam.zoom;
    return { x: (x - cam.x) * s + W * 0.5, y: (y - cam.y) * s + H * 0.5 };
  }

  function setStyle(s) {
    ctx.globalAlpha = s?.alpha ?? 1;
    if (s?.fill) ctx.fillStyle = s.fill;
    if (s?.stroke) ctx.strokeStyle = s.stroke;
    if (s?.lineWidth != null) ctx.lineWidth = s.lineWidth;
  }

  return {
    resize,

    beginFrame() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      worldTransform();
    },

    endFrame() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    },

    setCamera(c) {
      cam = { ...cam, ...c };
      worldTransform();
    },

    getCamera() { return { ...cam }; },

    getSize() { return { w: W, h: H }; },

    drawGrid(step = 1, color = '#0e1320') {
      const halfW = (W * 0.5) / (PIXELS_PER_METER * cam.zoom);
      const halfH = (H * 0.5) / (PIXELS_PER_METER * cam.zoom);
      const x0 = Math.floor((cam.x - halfW) / step) * step;
      const x1 = Math.ceil((cam.x + halfW) / step) * step;
      const y0 = Math.floor((cam.y - halfH) / step) * step;
      const y1 = Math.ceil((cam.y + halfH) / step) * step;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / (PIXELS_PER_METER * cam.zoom);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    },

    drawCircle(x, y, r, s) {
      setStyle(s);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (s?.fill) ctx.fill();
      if (s?.stroke) ctx.stroke();
      ctx.globalAlpha = 1;
    },

    drawEllipse(x, y, rx, ry, rotation, s) {
      setStyle(s);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rotation || 0, 0, Math.PI * 2);
      if (s?.fill) ctx.fill();
      if (s?.stroke) ctx.stroke();
      ctx.globalAlpha = 1;
    },

    drawRect(x, y, w, h, s) {
      setStyle(s);
      if (s?.fill) ctx.fillRect(x, y, w, h);
      if (s?.stroke) ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha = 1;
    },

    drawLine(x1, y1, x2, y2, s) {
      setStyle(s);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },

    drawPolygon(points, s) {
      setStyle(s);
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      ctx.closePath();
      if (s?.fill) ctx.fill();
      if (s?.stroke) ctx.stroke();
      ctx.globalAlpha = 1;
    },

    drawText(x, y, text, st = {}) {
      screenTransform();
      const p = worldToScreen(x, y);
      ctx.fillStyle = st.fill || '#e8e8ee';
      ctx.font = `${st.weight ? st.weight + ' ' : ''}${st.size || 12}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = st.align || 'center';
      ctx.textBaseline = st.baseline || 'middle';
      ctx.globalAlpha = st.alpha ?? 1;
      ctx.fillText(text, p.x, p.y);
      ctx.globalAlpha = 1;
      worldTransform();
    },

    screenToWorld(sx, sy) {
      const s = PIXELS_PER_METER * cam.zoom;
      return { x: cam.x + (sx - W * 0.5) / s, y: cam.y + (sy - H * 0.5) / s };
    },
  };
}
