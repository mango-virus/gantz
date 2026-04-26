// ─────────────────────────────────────────────────────────────────────────────
// Level edit overlays
//
// The hand-authored levels (kabukichō, future ones) live in giant JS files
// with thousands of literal numeric values. Iterating on collision and prop
// placement by editing those files is brutal, so the level editor at
// `level.html` writes a small JSON "edits" file per level that this module
// then applies on top of the freshly built level — both inside the editor
// and inside the running game.
//
// File path: `assets/data/level-edits/<levelId>.json`
//
// Schema (all fields optional):
//   {
//     "colliders": {
//       "modified": { "<editorId>": { bounds, category, tier, ... } },
//       "removed":  [<editorId>, ...],
//       "added":    [{ kind, type, bounds, category, tier, tag, ... }]
//     },
//     "props": {
//       "modified": { "<index>": { x, z, rot } },
//       "added":    [{ type, x, z, rot, ...type-specific fields }],
//       "removed":  [<index>, ...]
//     },
//     "buildings": {
//       "modified": { "<index>": { x, z, rot } },
//       "removed":  [<index>, ...]
//     }
//   }
//
// Removal semantics: the index refers to the slot in level.props /
// level.buildings AFTER `added` props have been appended (so editor-added
// props can also be removed in a later session). Removal tears down the
// Three.js child group(s) tagged with that editorRef and drops every
// collider with matching propIndex/buildingIndex. The list slot is left as
// a `_removed: true` tombstone to keep subsequent indices stable across
// reloads.
//
// Identity:
//   - Colliders use `editorId`, the build-order index assigned in
//     `pushAABB`/`pushRotatedAABB`.
//   - Props and buildings use their array index in PROPS_INITIAL / BUILDINGS.
//   - Both rely on the level builder being deterministic so the same physical
//     entity gets the same id across reloads.
//
// Prop/building modifications store ABSOLUTE final values (x, z, rot), not
// deltas. On apply we compare to the freshly built (= source) values to
// compute the delta we need to translate the Three.js group AND shift any
// colliders tagged with that prop's `propIndex` / `buildingIndex`.
// ─────────────────────────────────────────────────────────────────────────────

const EDITS_BASE = 'assets/data/level-edits';

// Resolve the URL relative to wherever the module lives, so the same call
// works from `index.html`, `level.html`, and `levels.html`.
function editsURL(levelId) {
  return new URL(`../../${EDITS_BASE}/${levelId}.json`, import.meta.url).toString();
}

/**
 * Fetch the saved edits for a level. Resolves to `null` when no edit file
 * exists or the fetch fails (404 on a level that's never been edited is
 * the common case — treat as "no overrides").
 */
export async function loadLevelEdits(levelId) {
  if (!levelId) return null;
  try {
    const res = await fetch(editsURL(levelId), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Mutate `level` in-place to reflect `edits`. No-op when `edits` is null
 * or empty. Returns `level` for chaining convenience.
 */
export function applyLevelEdits(level, edits) {
  if (!level || !edits) return level;

  // Order matters:
  //   1. Append added props first so the indices used by `modified` resolve.
  //   2. Apply prop/building modifications.
  //   3. Apply collider edits (modifications, removals, additions).
  //   4. Remove props/buildings last — tearing down meshes and tagged
  //      colliders. Done after collider-add so editor-added colliders that
  //      reference a now-removed entity (rare) still go through the same
  //      tag-based filter.
  applyAddedProps(level, edits.props);
  applyPropOrBuildingEdits(level, 'prop',     edits.props);
  applyPropOrBuildingEdits(level, 'building', edits.buildings);
  applyColliderEdits(level, edits.colliders);
  applyRemovedEntities(level, 'prop',     edits.props);
  applyRemovedEntities(level, 'building', edits.buildings);

  return level;
}

// ── Added props (catalog) ───────────────────────────────────────────────────
// Each entry in `edits.props.added` is a full prop spec (type + position +
// any type-specific fields). We call level.appendProp to build the meshes
// and tag them with editorAdded = true.
function applyAddedProps(level, section) {
  if (!section?.added) return;
  if (typeof level.appendProp !== 'function') return;
  for (const a of section.added) {
    level.appendProp({ ...a }, { editorAdded: true });
  }
}

// ── Removed props / buildings ───────────────────────────────────────────────
// `kind` = 'prop' | 'building'. We tear down Three.js children tagged with
// `editorRef.{kind,index}`, drop colliders tagged with the matching index,
// and tombstone the spec slot so later reloads don't re-shift indices.
function applyRemovedEntities(level, kind, section) {
  const removed = section?.removed;
  if (!removed?.length) return;
  const list = kind === 'prop' ? level.props : level.buildings;
  if (!Array.isArray(list)) return;
  const groupRoot = kind === 'prop' ? level.groups?.props : level.groups?.buildings;
  const tagKey = kind === 'prop' ? 'propIndex' : 'buildingIndex';
  const removedSet = new Set(removed);

  // 1) Detach Three.js groups that match a removed index.
  if (groupRoot) {
    // Walk children backwards because we splice.
    for (let i = groupRoot.children.length - 1; i >= 0; i--) {
      const ch = groupRoot.children[i];
      const ref = ch.userData?.editorRef;
      if (!ref || ref.kind !== kind) continue;
      if (!removedSet.has(ref.index)) continue;
      groupRoot.remove(ch);
    }
  }

  // 2) Drop colliders tagged for removed entities.
  if (Array.isArray(level.colliders)) {
    for (let i = level.colliders.length - 1; i >= 0; i--) {
      const c = level.colliders[i];
      const idx = c?.[tagKey];
      if (typeof idx === 'number' && removedSet.has(idx)) {
        level.colliders.splice(i, 1);
      }
    }
  }

  // 3) Tombstone the spec — keeps array indices stable for future edits.
  for (const idx of removed) {
    if (list[idx]) list[idx]._removed = true;
  }
}

// ── Colliders ───────────────────────────────────────────────────────────────
function applyColliderEdits(level, section) {
  if (!section) return;
  const list = level.colliders;
  if (!Array.isArray(list)) return;

  const removed = new Set(section.removed ?? []);
  const modified = section.modified ?? {};

  // Apply modifications first, while indices still match.
  for (const c of list) {
    const m = modified[c.editorId];
    if (!m) continue;
    if (m.bounds) {
      c.bounds = {
        min: { ...m.bounds.min },
        max: { ...m.bounds.max },
      };
      // Mirror to legacy fields used by the 2D collision system.
      c.x = (c.bounds.min.x + c.bounds.max.x) / 2;
      c.y = (c.bounds.min.z + c.bounds.max.z) / 2;
      c.w = c.bounds.max.x - c.bounds.min.x;
      c.h = c.bounds.max.z - c.bounds.min.z;
      c.minY = c.bounds.min.y;
      c.maxY = c.bounds.max.y;
    }
    if (m.category) c.category = m.category;
    if (m.tier) c.tier = m.tier;
    if (m.tag !== undefined) c.tag = m.tag;
  }

  // Filter removed colliders.
  if (removed.size) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (removed.has(list[i].editorId)) list.splice(i, 1);
    }
  }

  // Append added colliders. They get their own editorId namespace
  // (negative numbers) so they don't collide with build-order ids.
  let nextAddedId = -1;
  for (const a of (section.added ?? [])) {
    const b = a.bounds || { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 2, z: 1 } };
    const c = {
      kind: a.kind ?? 'aabb',
      type: a.type ?? 'aabb',
      x: (b.min.x + b.max.x) / 2,
      y: (b.min.z + b.max.z) / 2,
      w: b.max.x - b.min.x,
      h: b.max.z - b.min.z,
      minY: b.min.y,
      maxY: b.max.y,
      tier: a.tier ?? 'hard',
      category: a.category ?? 'solid',
      bounds: {
        min: { ...b.min },
        max: { ...b.max },
      },
      jumpable: a.jumpable ?? true,
      requires_crouch: a.requires_crouch ?? false,
      tags: a.tags ?? (a.tag ? [a.tag] : []),
      tag: a.tag,
      editorId: nextAddedId--,
      editorAdded: true,
    };
    list.push(c);
  }
}

// ── Props + buildings (shared logic) ────────────────────────────────────────
//
// Edits store absolute target values { x, z, rot }. `applyEntityTransform`
// computes the delta vs the entity's CURRENT spec values and:
//   1. Translates every Three.js child whose userData.editorRef points at the
//      entry by (dx, 0, dz) and adds drot to rotation.y
//   2. Shifts collider bounds tagged with propIndex/buildingIndex around the
//      entity's pivot (orbit + axis-aligned rebake for non-zero drot)
//   3. Mutates the source spec in place so other code reading level.props[i].x
//      sees the new position.
//
// `kind`     = 'prop' | 'building'
// `section`  = edits.props or edits.buildings
function applyPropOrBuildingEdits(level, kind, section) {
  if (!section || !section.modified) return;
  const list = kind === 'prop' ? level.props : level.buildings;
  if (!Array.isArray(list)) return;

  for (const [keyStr, mod] of Object.entries(section.modified)) {
    const i = parseInt(keyStr, 10);
    if (!Number.isFinite(i)) continue;
    const spec = list[i];
    if (!spec) continue;
    const newX   = mod.x   ?? spec.x ?? 0;
    const newZ   = mod.z   ?? spec.z ?? 0;
    const newRot = mod.rot ?? spec.rot ?? 0;
    applyEntityTransform(level, kind, i, newX, newZ, newRot);
  }
}

/**
 * Move/rotate one prop or building to absolute (x, z, rot). Re-uses the same
 * code path as bulk-applying saved edits so the editor and the live game stay
 * in sync. Safe to call repeatedly during a gizmo drag.
 *
 *   kind   'prop' | 'building'
 *   index  array index into level.props / level.buildings
 */
export function applyEntityTransform(level, kind, index, newX, newZ, newRot) {
  if (!level) return;
  const list = kind === 'prop' ? level.props : level.buildings;
  if (!Array.isArray(list)) return;
  const spec = list[index];
  if (!spec) return;

  const curX   = spec.x   ?? 0;
  const curZ   = spec.z   ?? 0;
  const curRot = spec.rot ?? 0;
  const dx   = newX   - curX;
  const dz   = newZ   - curZ;
  const drot = newRot - curRot;
  if (!dx && !dz && !drot) return;

  // 1) Translate Three.js child groups carrying matching editorRef.
  const groupRoot = kind === 'prop' ? level.groups?.props : level.groups?.buildings;
  if (groupRoot) {
    for (const child of groupRoot.children) {
      const ref = child.userData?.editorRef;
      if (!ref || ref.kind !== kind || ref.index !== index) continue;
      child.position.x += dx;
      child.position.z += dz;
      child.rotation.y += drot;
    }
  }

  // 2) Shift colliders tagged for this entity. Off-centre colliders orbit the
  //    entity pivot when drot != 0; AABB extents are rebaked to axis-aligned.
  const tagKey = kind === 'prop' ? 'propIndex' : 'buildingIndex';
  const cs = (level.colliders ?? []);
  if (cs.length && (dx || dz || drot)) {
    const cosD = Math.cos(drot);
    const sinD = Math.sin(drot);
    const ac = Math.abs(cosD), as = Math.abs(sinD);
    for (const c of cs) {
      if (c[tagKey] !== index) continue;
      const b = c.bounds;
      if (!b) continue;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const halfW = (b.max.x - b.min.x) / 2;
      const halfD = (b.max.z - b.min.z) / 2;
      const ox = cx - curX;
      const oz = cz - curZ;
      const rx = drot ? (ox * cosD - oz * sinD) : ox;
      const rz = drot ? (ox * sinD + oz * cosD) : oz;
      const ncx = curX + dx + rx;
      const ncz = curZ + dz + rz;
      const nHalfW = drot ? (halfW * ac + halfD * as) : halfW;
      const nHalfD = drot ? (halfW * as + halfD * ac) : halfD;
      b.min.x = ncx - nHalfW;
      b.max.x = ncx + nHalfW;
      b.min.z = ncz - nHalfD;
      b.max.z = ncz + nHalfD;
      c.x = ncx;
      c.y = ncz;
      c.w = nHalfW * 2;
      c.h = nHalfD * 2;
    }
  }

  // 3) Mutate the source spec so callers reading level.props[i].x see new pos.
  spec.x = newX;
  spec.z = newZ;
  spec.rot = newRot;
}
