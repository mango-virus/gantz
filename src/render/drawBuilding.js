export function drawBuilding(r, b) {
  const hw = b.w * 0.5, hh = b.h * 0.5;

  r.drawRect(b.x - hw + 0.08, b.y - hh + 0.12, b.w, b.h, { fill: 'rgba(0,0,0,0.45)' });

  r.drawRect(b.x - hw, b.y - hh, b.w, b.h, { fill: '#22232a' });
  r.drawRect(b.x - hw, b.y - hh, b.w, b.h, { stroke: '#060608', lineWidth: 0.05 });

  // roof trim highlight
  r.drawRect(b.x - hw + 0.08, b.y - hh + 0.08, b.w - 0.16, 0.10, {
    fill: '#c8142b', alpha: 0.55,
  });

  // front window
  const winX = b.x - hw + 0.3;
  const winY = b.y - hh + 0.4;
  const winW = b.w - 0.6;
  const winH = Math.min(0.9, b.h * 0.45);
  r.drawRect(winX, winY, winW, winH, { fill: '#1ea5c8', alpha: 0.35 });
  r.drawRect(winX, winY, winW, winH, { stroke: '#2a4060', lineWidth: 0.02 });
  // warm interior glow
  r.drawRect(winX + 0.04, winY + winH * 0.55, winW - 0.08, winH * 0.3, {
    fill: '#e8c070', alpha: 0.25,
  });

  // awning stripe
  const awY = winY + winH + 0.04;
  if (awY < b.y + hh - 0.15) {
    r.drawRect(b.x - hw + 0.12, awY, b.w - 0.24, 0.12, { fill: '#c8142b', alpha: 0.7 });
  }

  // signage
  if (b.name) {
    r.drawText(b.x, b.y - hh + 0.22, b.name, { size: 11, fill: '#ffffff', weight: '700' });
  }

  // door
  const doorW = 0.6;
  const doorH = 0.5;
  r.drawRect(b.x - doorW / 2, b.y + hh - doorH, doorW, doorH, { fill: '#0a0a0a' });
  r.drawRect(b.x - doorW / 2, b.y + hh - doorH, doorW, doorH, { stroke: '#c8142b', lineWidth: 0.02, alpha: 0.6 });
}
