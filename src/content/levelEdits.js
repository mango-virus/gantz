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
//     }
//     // (props/buildings — Phase 2)
//   }
//
// `editorId` is the build-order index assigned in `pushAABB` /
// `pushRotatedAABB`. As long as the level builder stays deterministic the
// same physical collider gets the same id across reloads, so saved edits
// keep pointing at the right thing without us hand-naming each collider.
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
 *
 * Currently only the `colliders` section is implemented. Modifying a
 * collider rewrites both the spec-style `bounds` and the legacy
 * `x/y/w/h/minY/maxY` fields so existing 2D collision code keeps
 * working without a rewrite.
 */
export function applyLevelEdits(level, edits) {
  if (!level || !edits) return level;

  if (edits.colliders) {
    const list = level.colliders;
    if (Array.isArray(list)) {
      const removed = new Set(edits.colliders.removed ?? []);
      const modified = edits.colliders.modified ?? {};

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
      for (const a of (edits.colliders.added ?? [])) {
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
  }

  return level;
}
