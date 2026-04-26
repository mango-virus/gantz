// ─────────────────────────────────────────────────────────────────────────────
// Level registry — single source of truth for all hand-authored levels that
// should appear in the dev preview hub.
//
// Add a new level by:
//   1. Building it under `src/content/<name>Level.js` exporting at least
//      `build<Name>Level(THREE, opts)`, `LEVEL_BOUNDS`, `SPAWNS`, and
//      `exportColliderJSON(level)`.
//   2. Pushing an entry to LEVELS below with its id, title, description, a
//      lazy `load()` that dynamic-imports the module, and the export names
//      to look up on the module.
// The generic preview page (`level.html`) and picker (`levels.html`) read
// from this registry — no other wiring needed per level.
// ─────────────────────────────────────────────────────────────────────────────

export const LEVELS = [
  {
    id: 'kabukicho',
    title: 'Kabukichō',
    description:
      'Hand-authored neon district — 35+ buildings, 4-quadrant road grid with traffic, club spotlights, rooftop bird flocks, hazards, and 800+ colliders.',
    bounds: '250 × 250 u',
    load: () => import('./kabukichoLevel.js'),
    exports: {
      build:       'buildKabukichoLevel',
      spawns:      'SPAWNS',
      bounds:      'LEVEL_BOUNDS',
      exportJSON:  'exportColliderJSON',
    },
    camera: { pos: [60, 70, 110], target: [0, 4, 0] },
  },
];

export function getLevel(id) {
  return LEVELS.find(l => l.id === id) || null;
}
