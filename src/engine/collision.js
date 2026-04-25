// Simple 2D collision: circle-vs-circle and circle-vs-AABB push-out.
// Everything moving is treated as a circle (radius on the entity).
// Static colliders can be circles or axis-aligned boxes.
//
// Collider shape:
//   { kind: 'circle', x, y, r, tier }
//   { kind: 'aabb',   x, y, w, h, tier }   // x,y is center; w,h are full extents
//
// Tier: 'hard' (blocks movement), 'prone' (blocks movement but bullets pass),
//       'decorative' (ignored by movement and bullets).

export function circleVsCircle(ax, ay, ar, bx, by, br) {
  const dx = ax - bx, dy = ay - by;
  const rsum = ar + br;
  const dSq = dx * dx + dy * dy;
  if (dSq >= rsum * rsum) return null;
  const d = Math.sqrt(dSq);
  if (d < 1e-5) return { nx: 1, ny: 0, depth: rsum };
  return { nx: dx / d, ny: dy / d, depth: rsum - d };
}

export function circleVsAABB(cx, cy, cr, bx, by, bw, bh) {
  const hw = bw * 0.5, hh = bh * 0.5;
  const clampedX = Math.max(bx - hw, Math.min(cx, bx + hw));
  const clampedY = Math.max(by - hh, Math.min(cy, by + hh));
  const dx = cx - clampedX, dy = cy - clampedY;
  const dSq = dx * dx + dy * dy;

  if (dSq < 1e-10) {
    // Center is inside the box — push out along the nearest face.
    const fL = cx - (bx - hw);
    const fR = (bx + hw) - cx;
    const fT = cy - (by - hh);
    const fB = (by + hh) - cy;
    const minD = Math.min(fL, fR, fT, fB);
    if (minD === fL) return { nx: -1, ny: 0, depth: cr + fL };
    if (minD === fR) return { nx:  1, ny: 0, depth: cr + fR };
    if (minD === fT) return { nx: 0, ny: -1, depth: cr + fT };
    return              { nx: 0, ny:  1, depth: cr + fB };
  }
  if (dSq >= cr * cr) return null;
  const d = Math.sqrt(dSq);
  return { nx: dx / d, ny: dy / d, depth: cr - d };
}

export function resolveAgainstStatic(e, colliders) {
  const r = e.radius || 0.35;
  // Entity vertical extent in 3D world Y (jumpY = offset from floor, height ≈ 1.8m).
  const eBottom = e.jumpY || 0;
  const eTop    = eBottom + 1.8;
  for (let pass = 0; pass < 3; pass++) {
    let touched = false;
    for (const c of colliders) {
      if (!c || c.tier === 'decorative' || c.disabled) continue;
      // Skip collider if entity is entirely above or below its vertical range.
      if (c.yMin !== undefined || c.yMax !== undefined) {
        if (eTop <= (c.yMin ?? -Infinity) || eBottom >= (c.yMax ?? Infinity)) continue;
      }
      let hit = null;
      if (c.kind === 'circle') {
        hit = circleVsCircle(e.x, e.y, r, c.x, c.y, c.r);
      } else if (c.kind === 'aabb') {
        hit = circleVsAABB(e.x, e.y, r, c.x, c.y, c.w, c.h);
      }
      if (hit) {
        e.x += hit.nx * hit.depth;
        e.y += hit.ny * hit.depth;
        touched = true;
      }
    }
    if (!touched) break;
  }
}

export function rayVsCircle(ox, oy, dx, dy, maxT, cx, cy, cr) {
  const fx = ox - cx, fy = oy - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - cr * cr;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  if (t1 >= 0 && t1 <= maxT) return t1;
  const t2 = (-b + sq) / (2 * a);
  if (t2 >= 0 && t2 <= maxT) return t2;
  return null;
}

export function rayVsAABB(ox, oy, dx, dy, maxT, bx, by, bw, bh) {
  const hw = bw * 0.5, hh = bh * 0.5;
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-6) {
    if (ox < bx - hw || ox > bx + hw) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (bx - hw - ox) * inv;
    let t2 = (bx + hw - ox) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-6) {
    if (oy < by - hh || oy > by + hh) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (by - hh - oy) * inv;
    let t2 = (by + hh - oy) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : null;
}

export function hitscan(ox, oy, dx, dy, maxDist, staticCols, targets) {
  // Normalize dir
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  let bestT = maxDist;
  let bestTarget = null;
  // Check static walls first (hard tier blocks; prone/decorative ignored)
  for (const c of staticCols || []) {
    if (!c || c.tier !== 'hard') continue;
    let t = null;
    if (c.kind === 'aabb') t = rayVsAABB(ox, oy, dx, dy, bestT, c.x, c.y, c.w, c.h);
    else if (c.kind === 'circle') t = rayVsCircle(ox, oy, dx, dy, bestT, c.x, c.y, c.r);
    if (t != null && t < bestT) { bestT = t; bestTarget = null; }
  }
  // Check targets (entities)
  for (const tgt of targets || []) {
    if (!tgt || tgt.alive === false) continue;
    const t = rayVsCircle(ox, oy, dx, dy, bestT, tgt.x, tgt.y, tgt.radius || 0.4);
    if (t != null && t < bestT) { bestT = t; bestTarget = tgt; }
  }
  return {
    distance: bestT,
    target: bestTarget,
    point: { x: ox + dx * bestT, y: oy + dy * bestT },
  };
}

export function resolveCharacterOverlaps(entities) {
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i];
    if (a.alive === false) continue;
    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j];
      if (b.alive === false) continue;
      const hit = circleVsCircle(
        a.x, a.y, a.radius || 0.35,
        b.x, b.y, b.radius || 0.35,
      );
      if (hit) {
        a.x += hit.nx * hit.depth * 0.5;
        a.y += hit.ny * hit.depth * 0.5;
        b.x -= hit.nx * hit.depth * 0.5;
        b.y -= hit.ny * hit.depth * 0.5;
      }
    }
  }
}
