// kabukichoLevel.js — Tokyo Kabukichō night combat level for Gantz.
//
// Self-contained scene builder. Pass the THREE module in (so this works both
// from the main game's import map and from the standalone preview).
//
// Usage:
//   import * as THREE from 'https://esm.sh/three@0.160.0';
//   import { buildKabukichoLevel } from './src/content/kabukichoLevel.js';
//   const level = buildKabukichoLevel(THREE);
//   scene.add(level.root);
//   // level.colliders -> AABB array (JSON-serializable)
//   // level.spawns    -> { player: [...], enemies: [...] }
//   // level.hazards   -> [{ kind:'manhole', ... }, ...]
//
// All geometry is built from BoxGeometry / CylinderGeometry primitives so no
// external models are required.  Materials use MeshStandardMaterial with
// emissive properties on every neon element.
//
// Coordinate convention follows the rest of the codebase: gameplay uses 2D
// (x, y) which maps to 3D (x, 0, y).  Inside this builder we work directly in
// Three.js world space (x, y, z) for clarity.

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const LEVEL_BOUNDS = { minX: -125, maxX: 125, minZ: -125, maxZ: 125 };
export const TIER_GROUND  = 0;
export const TIER_ROOF    = 15;

// Neon palette — saturated, bias toward pink/cyan/red/purple.
const NEON = {
  pink:    0xff2d8a,
  cyan:    0x00e5ff,
  red:     0xff2030,
  purple:  0xa040ff,
  yellow:  0xffd200,
  green:   0x32ff7a,
  orange:  0xff8a1a,
  white:   0xfff7e0,
};

// Building palette — desaturated greys and dark teals; neon does the lifting.
const BLDG = {
  facadeA: 0x3a3a44,
  facadeB: 0x4a4250,
  facadeC: 0x2a2e3c,
  facadeD: 0x584038,
  trim:    0x55505a,
  glassDark: 0x10141c,
  glassLit:  0xffd66b,  // warm interior spill
  concrete:  0x2c2c30,
  asphalt:   0x1c1c24,
  sidewalk:  0x32323e,
  curb:      0x2e2e34,
  wood:      0x3b2a1c,
};

// ─────────────────────────────────────────────────────────────────────────────
// Building data — 9 buildings flanking an L-shaped main street.
// All positions/sizes in metres.  type drives the renderer.
// ─────────────────────────────────────────────────────────────────────────────

export const BUILDINGS = [
  {
    id: 'pachinko',
    type: 'pachinko',
    x: 22, z: -28, w: 24, d: 22, h: 14,
    rot: 0,
    neon: NEON.pink,
    sign: 'パチンコ',
    enterable: true,
    rooftopAccess: true,
  },
  {
    id: 'izakaya',
    type: 'izakaya',
    x: -22, z: 38, w: 16, d: 14, h: 11,
    rot: 0,
    neon: NEON.red,
    sign: '居酒屋',
    enterable: true,
    floors: 3,
  },
  {
    id: 'capsuleHotel',
    type: 'capsule',
    x: 24, z: 56, w: 18, d: 16, h: 16,
    rot: 0,
    neon: NEON.cyan,
    sign: 'カプセル',
    serviceAlleyBehind: true,
    enterable: true,
  },
  {
    id: 'konbini',
    type: 'konbini',
    x: -22, z: 4, w: 16, d: 12, h: 4.5,
    rot: 0,
    neon: NEON.green,
    sign: 'KONBINI',
    glassFront: true,
    enterable: true,
  },
  {
    id: 'loveHotel',
    type: 'love',
    x: 50, z: -94, w: 22, d: 18, h: 13,
    rot: 0,
    neon: NEON.purple,
    sign: 'LOVE',
    enterable: true,
  },
  {
    id: 'shrine',
    type: 'shrine',
    x: -15, z: -16, w: 10, d: 12, h: 4,
    rot: 0,
    elevation: 0.6, // slight raised platform
  },
  {
    id: 'midriseA',
    type: 'midrise',
    x: -28, z: -34, w: 16, d: 16, h: 22,
    rot: 0,
    neon: NEON.yellow,
    sign: 'ホテル',
    fireEscape: 'east',
    rooftopAccess: true,
  },
  {
    id: 'midriseB',
    type: 'midrise',
    x: -32, z: -78, w: 16, d: 16, h: 20,
    rot: 0,
    neon: NEON.cyan,
    sign: 'ＢＡＲ',
    fireEscape: 'east',
    rooftopAccess: true,
  },
  {
    id: 'midriseC',
    type: 'midrise',
    x: 20, z: -95, w: 18, d: 16, h: 24,
    rot: 0,
    neon: NEON.pink,
    sign: 'クラブ',
    fireEscape: 'south',
    rooftopAccess: true,
  },
  // ── New zone-filling buildings (positioned to flank the road grid) ───────
  {
    id: 'billboardTower',
    type: 'billboardTower',
    x: 95, z: 55, w: 14, d: 14, h: 34,
    rot: 0,
    neon: NEON.pink,
    sign: 'TOKYO',
    rooftopAccess: true,
  },
  {
    id: 'sento',
    type: 'sento',
    x: -95, z: 55, w: 22, d: 18, h: 7,
    rot: 0,
    neon: NEON.orange,
    sign: '銭湯',
    enterable: true,
  },
  {
    id: 'gasStation',
    type: 'gasStation',
    x: 95, z: -8, w: 26, d: 22, h: 6,
    rot: 0,
    neon: NEON.cyan,
    sign: 'GAS',
  },
  {
    id: 'parkingGarage',
    type: 'parkingGarage',
    x: -95, z: -6, w: 26, d: 26, h: 18,
    rot: 0,
    neon: NEON.yellow,
    sign: 'P',
    rooftopAccess: true,
  },
  {
    id: 'koban',
    type: 'koban',
    x: -22, z: -50, w: 5, d: 5, h: 4,
    rot: 0,
    neon: NEON.red,
    sign: 'KOBAN',
  },
  {
    id: 'noodleStand',
    type: 'noodleStand',
    x: 56, z: 8, w: 5, d: 4, h: 3,
    rot: -Math.PI / 2,
    neon: NEON.red,
    sign: 'らーめん',
  },
  {
    id: 'midriseD',
    type: 'midrise',
    x: 92, z: -95, w: 16, d: 16, h: 26,
    rot: 0,
    neon: NEON.purple,
    sign: 'スナック',
    fireEscape: 'west',
    rooftopAccess: true,
  },
  {
    id: 'midriseE',
    type: 'midrise',
    x: -95, z: -100, w: 18, d: 18, h: 22,
    rot: 0,
    neon: NEON.green,
    sign: 'マンガ',
    noSign: true,
    fireEscape: 'east',
    rooftopAccess: true,
  },
  {
    id: 'midriseF',
    type: 'midrise',
    x: 95, z: 108, w: 16, d: 16, h: 18,
    rot: 0,
    neon: NEON.cyan,
    sign: 'ＤＶＤ',
    rooftopAccess: true,
  },
  {
    id: 'midriseG',
    type: 'midrise',
    x: -100, z: -44, w: 18, d: 16, h: 20,
    rot: 0,
    neon: NEON.pink,
    sign: 'ライブ',
    fireEscape: 'south',
    rooftopAccess: true,
  },
  {
    id: 'midriseH',
    type: 'midrise',
    x: 52, z: 100, w: 18, d: 16, h: 20,
    rot: 0,
    neon: NEON.orange,
    sign: 'カラオケ',
    rooftopAccess: true,
  },
  // ── Filler zone buildings — adds height variety + plugs empty quadrants ──
  {
    id: 'officeTower',
    type: 'midrise',
    x: -50, z: -30, w: 14, d: 14, h: 42,  // TALL glass office tower
    rot: 0,
    neon: NEON.cyan,
    sign: 'ＴＯＫＹＯ',
    noSign: true,
    fireEscape: 'south',
    rooftopAccess: true,
  },
  {
    id: 'hotelTower',
    type: 'midrise',
    x: -50, z: 4, w: 14, d: 14, h: 44,    // TALL hotel skyscraper
    rot: 0,
    neon: NEON.purple,
    sign: 'ＨＯＴＥＬ',
    noSign: true,
    fireEscape: 'east',
    rooftopAccess: true,
  },
  {
    id: 'departmentStore',
    type: 'midrise',
    x: 50, z: 36, w: 20, d: 18, h: 18,
    rot: 0,
    neon: NEON.yellow,
    sign: 'デパート',
    rooftopAccess: true,
  },
  {
    id: 'apartmentBlock',
    type: 'midrise',
    x: -50, z: 66, w: 18, d: 14, h: 24,
    rot: 0,
    neon: NEON.green,
    sign: 'アパート',
    noSign: true,
    fireEscape: 'east',
    rooftopAccess: true,
  },
  {
    id: 'billboardTower2',
    type: 'billboardTower',
    x: -58, z: -86, w: 10, d: 8, h: 36,    // TALL billboard tower
    rot: 0,
    neon: NEON.cyan,
    sign: 'ネオン',
    adText: 'ネオン',
    rooftopAccess: true,
  },
  {
    id: 'officeBlock2',
    type: 'midrise',
    x: 55, z: -30, w: 14, d: 14, h: 28,
    rot: 0,
    neon: NEON.red,
    sign: 'オフィス',
    fireEscape: 'west',
    rooftopAccess: true,
  },
  {
    id: 'shopArcade',
    type: 'midrise',
    x: 84, z: 92, w: 14, d: 10, h: 10,
    rot: 0,
    neon: NEON.pink,
    sign: 'アーケード',
    rooftopAccess: false,
  },
  {
    id: 'karaokePlaza',
    type: 'midrise',
    x: -55, z: -45, w: 14, d: 10, h: 14,
    rot: 0,
    neon: NEON.orange,
    sign: '歌',
    noSign: true,
    rooftopAccess: true,
  },
  // ── New tall edge buildings filling empty perimeter gaps ────────────────
  {
    id: 'edgeTowerNW',
    type: 'midrise',
    x: -114, z: 100, w: 12, d: 12, h: 32,
    rot: 0,
    neon: NEON.purple,
    sign: 'タワー',
    noSign: true,
    rooftopAccess: true,
  },
  {
    id: 'edgeTowerNE',
    type: 'midrise',
    x: 112, z: 100, w: 12, d: 12, h: 30,
    rot: 0,
    neon: NEON.cyan,
    sign: 'スカイ',
    rooftopAccess: true,
  },
  {
    id: 'edgeTowerSE',
    type: 'midrise',
    x: 112, z: -45, w: 12, d: 12, h: 36,
    rot: 0,
    neon: NEON.pink,
    sign: 'ＮＥＯＮ',
    rooftopAccess: true,
  },
  {
    id: 'edgeTowerSW',
    type: 'midrise',
    x: -112, z: -82, w: 12, d: 12, h: 30,
    rot: 0,
    neon: NEON.yellow,
    sign: 'ホール',
    noSign: true,
    rooftopAccess: true,
  },
  // ── Grand shrine (the WOW building) ─────────────────────────────────────
  {
    id: 'grandShrine',
    type: 'grandShrine',
    x: 40, z: 0, w: 20, d: 18, h: 14,
    rot: 0,
    neon: NEON.red,
    sign: '神社',
  },
  // ── NW-quadrant filler — empty zone between apartmentBlock & edgeTowerNW ─
  {
    id: 'midriseI',
    type: 'midrise',
    x: -50, z: 100, w: 14, d: 14, h: 30,
    rot: 0,
    neon: NEON.cyan,
    sign: 'シネマ',
    fireEscape: 'south',
    rooftopAccess: true,
  },
  {
    id: 'midriseJ',
    type: 'midrise',
    x: -25, z: 100, w: 14, d: 14, h: 22,
    rot: 0,
    neon: NEON.orange,
    sign: 'バー',
    fireEscape: 'south',
    rooftopAccess: true,
  },
  {
    id: 'cinemaTower',
    type: 'billboardTower',
    x: -85, z: 115, w: 10, d: 8, h: 44,
    rot: 0,
    neon: NEON.yellow,
    sign: 'シネマ',
    adText: 'シネマ',
    rooftopAccess: true,
  },
  {
    id: 'arcadeJ',
    type: 'midrise',
    x: -95, z: 92, w: 12, d: 10, h: 10,
    rot: 0,
    neon: NEON.pink,
    sign: 'ゲーム',
    noSign: true,
    rooftopAccess: false,
  },
  {
    id: 'liveHouseN',
    type: 'midrise',
    x: -25, z: 64, w: 12, d: 10, h: 16,
    rot: 0,
    neon: NEON.purple,
    sign: 'ライブ',
    noSign: true,
    fireEscape: 'east',
    rooftopAccess: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Prop layouts.  Each entry = { type, x, z, y?, rot?, params? }.
// Many props are emitted by helpers to keep this section terse — but every
// instance ends up in PROPS_RUNTIME at scene-build time so it's still
// data-driven (you can mutate the array before calling build).
// ─────────────────────────────────────────────────────────────────────────────

export const PROPS_INITIAL = [
  // Vending-machine clusters (groups of 2-3, glowing) — usable as cover.
  { type: 'vendingCluster', x: -14, z: 50, count: 3, color: NEON.cyan, rot: Math.PI / 2 },
  { type: 'vendingCluster', x:  14, z: 12, count: 2, color: NEON.red,  rot: -Math.PI / 2 },
  { type: 'vendingCluster', x:  -5, z:  -8, count: 3, color: NEON.green, rot: Math.PI / 2 },
  { type: 'vendingCluster', x:  10, z: -50, count: 2, color: NEON.pink, rot: Math.PI },
  { type: 'vendingCluster', x: -42, z: -50, count: 3, color: NEON.yellow, rot: 0 },
  { type: 'vendingCluster', x:  30, z: -82, count: 2, color: NEON.cyan, rot: -Math.PI / 2 },

  // Vertical kanji neon signs mounted on building facades.
  // Each sign sits ~0.3u outside its host wall so the bracket reaches into the wall.
  { type: 'verticalSign', x: -13.7, z: 33,  height: 8, text: 'ラーメン', color: NEON.red,    facing: 'east' },
  { type: 'verticalSign', x: -13.7, z: 42,  height: 9, text: '焼鳥',     color: NEON.orange, facing: 'east' },
  { type: 'verticalSign', x:  15.3, z: 60,  height: 9, text: 'ホテル',   color: NEON.cyan,   facing: 'west' },
  { type: 'verticalSign', x:   9.7, z: -22, height: 11,text: 'パチンコ', color: NEON.pink,   facing: 'west' },
  { type: 'verticalSign', x: -13.7, z: 4,   height: 1.8, text: 'コンビニ', color: NEON.green,  facing: 'east' },
  { type: 'verticalSign', x: -19.7, z: -28, height: 14,text: 'カラオケ', color: NEON.yellow, facing: 'east' },
  { type: 'verticalSign', x: -23.7, z: -72, height: 13,text: 'バー',     color: NEON.purple, facing: 'east' },
  { type: 'verticalSign', x:  10.7, z: -90, height: 15,text: 'クラブ',   color: NEON.pink,   facing: 'west' },
  { type: 'verticalSign', x:  40.0, z: -84.7, height: 9, text: 'LOVE',   color: NEON.purple, facing: 'south' },

  // Power-line poles with tangled cables criss-crossing the street.
  { type: 'powerPole', x: -12, z:  90 },
  { type: 'powerPole', x:  12, z:  60 },
  { type: 'powerPole', x: -12, z:  30 },
  { type: 'powerPole', x:  12, z: -10 },
  { type: 'powerPole', x: -12, z: -45 },
  { type: 'powerPole', x:  35, z: -47 },
  { type: 'powerPole', x:  62, z: -47 },

  // Parked vehicles.
  { type: 'bicycle', x: -10, z: 56,  rot: 0 },
  { type: 'bicycle', x: -10, z: 58,  rot: 0 },
  { type: 'bicycle', x: -10, z: 60,  rot: 0 },
  { type: 'bicycle', x:  11, z: 4,   rot: Math.PI },
  { type: 'bicycle', x:  11, z: 6,   rot: Math.PI },
  { type: 'keiTruck', x: -13, z: 88, rot: -Math.PI / 2 },
  { type: 'scooter',  x:  10,  z: 30, rot: Math.PI / 2 },
  { type: 'scooter',  x: -9,   z: -38, rot: -Math.PI / 2 },

  // Trash bag piles at alley entrances.
  { type: 'trashPile', x: -34, z: -50, count: 7 },
  { type: 'trashPile', x: -56, z: -54, count: 6 },
  { type: 'trashPile', x:  32, z: -10, count: 5 },
  { type: 'trashPile', x:  -8, z:  72, count: 4 },

  // Plastic crates / beer cases stacked outside the izakaya.
  { type: 'crateStack', x: -13, z: 32, count: 4 },
  { type: 'crateStack', x: -13, z: 44, count: 5 },
  { type: 'crateStack', x: -30.6, z: 38, count: 3 },

  // Akachōchin (paper lanterns) hanging from awnings.
  { type: 'lanternRow', x: -13.7, z: 38, count: 5, axis: 'z', spacing: 1.6, color: NEON.red },
  { type: 'lanternRow', x:   9.7, z: -25, count: 6, axis: 'z', spacing: 1.6, color: NEON.red },
  { type: 'lanternRow', x: -13.7, z: 4,   count: 4, axis: 'z', spacing: 1.4, color: NEON.white },

  // A-frame restaurant signs.
  { type: 'aFrame', x: -10, z: 30, rot: 0,         color: NEON.yellow },
  { type: 'aFrame', x:  10, z: 30, rot: Math.PI,   color: NEON.cyan },
  { type: 'aFrame', x: -10, z: -14, rot: 0,        color: NEON.red },
  { type: 'aFrame', x:  35, z: -54, rot: -Math.PI/2, color: NEON.purple },

  // AC units bolted to building exteriors (usable as ledges).
  // x = (wall x) ± 0.25 so body sits flush against wall, vent points outward.
  { type: 'acUnit', x: -13.75, z: 36, y: 4.0, rot: Math.PI / 2 },
  { type: 'acUnit', x: -13.75, z: 42, y: 7.5, rot: Math.PI / 2 },
  { type: 'acUnit', x:  14.75, z: 50, y: 5.5, rot: -Math.PI / 2 },
  { type: 'acUnit', x:  14.75, z: 64, y: 9.0, rot: -Math.PI / 2 },
  { type: 'acUnit', x: -19.75, z: -28, y: 10.0, rot: Math.PI / 2 },
  { type: 'acUnit', x: -19.75, z: -38, y: 14.0, rot: Math.PI / 2 },
  { type: 'acUnit', x:   9.75, z: -28, y: 8.0, rot: -Math.PI / 2 },
  { type: 'acUnit', x: -23.75, z: -72, y: 12.0, rot: Math.PI / 2 },

  // Steam vents.
  { type: 'steamVent', x: -12, z: 26 },
  { type: 'steamVent', x:  8, z: -42 },
  { type: 'steamVent', x: -38, z: -50 },
  { type: 'steamVent', x:  62, z: -50 },

  // Puddles reflecting neon light.
  { type: 'puddle', x: -3, z: 26, w: 3.2, d: 1.8 },
  { type: 'puddle', x:  4, z: 50, w: 2.4, d: 1.4 },
  { type: 'puddle', x: -1, z: -22, w: 4.5, d: 2.6 },
  { type: 'puddle', x:  5, z: -60, w: 3.0, d: 1.8 },
  { type: 'puddle', x: -38, z: -52, w: 2.4, d: 1.4 },
  { type: 'puddle', x: 46, z: -78, w: 3.5, d: 2.0 },

  // Taiyaki food cart.
  { type: 'foodCart', x: 10, z: 88, rot: -Math.PI / 2, color: NEON.orange, label: 'たい焼' },

  // Sake barrels near the shrine (east face).
  { type: 'sakeBarrels', x: -9, z: -16, count: 6 },

  // Rooftop water tanks + ducts (placed at building roof height).
  // pachinko h=14
  { type: 'waterTank', x: 22, z: -32, y: 14.05 },
  // midriseA h=22
  { type: 'waterTank', x: -28, z: -38, y: 22.05 },
  // midriseC h=24 — moved inward (x range 11..29, was at 14 too close to edge)
  { type: 'waterTank', x: 18, z: -100, y: 24.05 },
  // pachinko duct — moved inward so far end stays well inside footprint
  { type: 'duct', x: 22, z: -25, y: 14.05, length: 6, axis: 'z' },
  // midriseB
  { type: 'duct', x: -32, z: -78, y: 20.05, length: 8, axis: 'x' },
  // midriseC — shorter length, centered on building x (was hanging off west edge)
  { type: 'duct', x: 20, z: -95, y: 24.05, length: 6, axis: 'x' },

  // Stone lanterns flanking the shrine torii.
  { type: 'stoneLantern', x: -18.5, z: -10.6 },
  { type: 'stoneLantern', x: -11.5, z: -10.6 },

  // Offering box at the shrine.
  { type: 'offeringBox', x: -15, z: -18 },

  // Bollards at street entrances (T-intersection).
  { type: 'bollardLine', x: 0, z: -48, count: 5, axis: 'x', spacing: 1.4 },
  { type: 'bollardLine', x: 0, z: 100, count: 6, axis: 'x', spacing: 1.4 },

  // ── More signs (kanji on more facades + flickering broken ones) ──────────
  { type: 'verticalSign', x: -83.7, z: 50, height: 3.5, text: '銭湯',    color: NEON.orange, facing: 'east' },
  { type: 'verticalSign', x:  87.7, z: 55, height: 14, text: '東京',    color: NEON.pink,   facing: 'west', flicker: true },
  { type: 'verticalSign', x:  86.7, z: 105, height: 9, text: 'ＤＶＤ',  color: NEON.cyan,   facing: 'west' },
  { type: 'verticalSign', x:  47,   z: 91.3, height: 10, text: 'カラオケ', color: NEON.orange, facing: 'north' },
  { type: 'verticalSign', x: -85.7, z: -100, height: 11, text: 'マンガ', color: NEON.green,  facing: 'east', flicker: true },
  { type: 'verticalSign', x:  83.3, z: -95, height: 13, text: 'スナック', color: NEON.purple, facing: 'west' },
  { type: 'verticalSign', x: -90.3, z: -50, height: 11, text: 'ライブ',  color: NEON.pink,   facing: 'east' },
  // Signs on the new filler buildings (officeTower, hotelTower, etc.)
  { type: 'verticalSign', x: -42.7, z: -30, height: 18, text: 'ＴＯＫＹＯ', color: NEON.cyan,   facing: 'east', flicker: true },
  { type: 'verticalSign', x: -42.7, z:   4, height: 20, text: 'ＨＯＴＥＬ', color: NEON.purple, facing: 'east' },
  { type: 'verticalSign', x:  40.3, z:  36, height: 9,  text: 'デパート',  color: NEON.yellow, facing: 'west' },
  { type: 'verticalSign', x: -40.7, z:  66, height: 11, text: 'アパート',  color: NEON.green,  facing: 'east' },
  { type: 'verticalSign', x: -52.3, z: -86, height: 16, text: 'ネオン',    color: NEON.cyan,   facing: 'east', flicker: true },
  { type: 'verticalSign', x:  47.7, z: -30, height: 13, text: 'オフィス',  color: NEON.red,    facing: 'west' },
  { type: 'verticalSign', x:  76.7, z:  92, height: 6,  text: '街',        color: NEON.pink,   facing: 'west' },
  { type: 'verticalSign', x: -47.7, z: -45, height: 7,  text: '歌',        color: NEON.orange, facing: 'east' },
  // ── Edge towers + new NW filler buildings (added round) ──────────────────
  { type: 'verticalSign', x: -107.7, z: 100, height: 16, text: 'タワー',   color: NEON.purple, facing: 'east' },
  { type: 'verticalSign', x:  105.7, z: 100, height: 14, text: 'スカイ',   color: NEON.cyan,   facing: 'west', flicker: true },
  { type: 'verticalSign', x:  105.7, z: -45, height: 18, text: 'ＮＥＯＮ', color: NEON.pink,   facing: 'west', flicker: true },
  { type: 'verticalSign', x: -105.7, z: -82, height: 14, text: 'ホール',   color: NEON.yellow, facing: 'east' },
  { type: 'verticalSign', x: -50,    z: 107.3, height: 14, text: 'シネマ', color: NEON.cyan,   facing: 'south' },
  { type: 'verticalSign', x: -25,    z: 107.3, height: 11, text: 'バー',   color: NEON.orange, facing: 'south', flicker: true },
  { type: 'verticalSign', x: -88.7,  z:  92, height: 6,  text: 'ゲーム',   color: NEON.pink,   facing: 'east' },
  { type: 'verticalSign', x: -18.7,  z:  64, height: 8,  text: 'ライブ',   color: NEON.purple, facing: 'east' },

  // ── Hanging signs (sway) ─────────────────────────────────────────────────
  { type: 'hangingSign', x: -12, z: 32, height: 6.0, w: 1.6, h: 0.9, text: '焼鳥', color: NEON.orange, attach: 'east', armLen: 1.8 },
  { type: 'hangingSign', x:   8, z: -20, height: 6.5, w: 1.8, h: 1.0, text: 'パチ', color: NEON.pink,   attach: 'east', armLen: 1.8 },
  { type: 'hangingSign', x: -16, z: -30, height: 6.0, w: 1.4, h: 0.8, text: 'バー', color: NEON.purple, attach: 'east', armLen: 1.8 },
  { type: 'hangingSign', x:  12, z:  64, height: 5.8, w: 1.5, h: 0.8, text: '鮨',  color: NEON.cyan,   attach: 'west', armLen: 1.8 },
  { type: 'hangingSign', x: -82, z:  46, height: 5.5, w: 1.6, h: 0.9, text: '湯',  color: NEON.orange, attach: 'east', armLen: 1.8 },
  { type: 'hangingSign', x:  60, z:   6, height: 5.5, w: 1.5, h: 0.8, text: '茶',  color: NEON.green,  attach: 'east', armLen: 1.8 },

  // ── Sidewalk signs ────────────────────────────────────────────────────────
  { type: 'sidewalkSign', x:   8, z:  44, rot: 0, text: 'OPEN', color: NEON.cyan },
  { type: 'sidewalkSign', x:  -8, z:  10, rot: Math.PI, text: 'バル', color: NEON.red },
  { type: 'sidewalkSign', x:  44, z: -54, rot: -Math.PI/2, text: '麺', color: NEON.yellow },
  { type: 'sidewalkSign', x:  -8, z: -52, rot: 0, text: 'カフェ', color: NEON.green },

  // ── Billboards (standalone) ──────────────────────────────────────────────
  { type: 'billboard', x:  82, z: 32, rot: -Math.PI / 2, w: 6, h: 3, text: 'KIRIN', color: NEON.cyan },
  { type: 'billboard', x: -82, z: 88, rot: Math.PI / 2,  w: 6, h: 3, text: 'COCA', color: NEON.red },
  { type: 'billboard', x:  -8, z: -106, rot: 0,           w: 8, h: 3.4, text: 'GANTZ', color: NEON.pink },

  // ── Hazard interactables ─────────────────────────────────────────────────
  { type: 'gasMain', x: 88, z: -2, rot: Math.PI / 2 },
  { type: 'gasMain', x: -38, z: -56, rot: 0 },
  { type: 'gasMain', x: 28, z: -100, rot: 0 },

  // ── Crashed / tipped vehicles (irregular cover) ──────────────────────────
  { type: 'crashedCar', x:  10, z: -54, rot: 0.4, color: 0x404048 },
  { type: 'crashedCar', x: -54, z:  30, rot: 1.2, color: 0x6a4040 },
  { type: 'crashedCar', x:  46, z: -78, rot: -0.8, color: 0x405060 },
  { type: 'tippedDumpster', x: -50, z:  -8, rot: 0.7, tipped: true },
  { type: 'tippedDumpster', x:  38, z:  44, rot: 0.0, tipped: false },
  { type: 'tippedDumpster', x: -54, z:  88, rot: -0.5, tipped: true },

  // ── Phone booths / utility ────────────────────────────────────────────────
  { type: 'phoneBooth', x:  -8, z: 32, rot: 0 },
  { type: 'phoneBooth', x: 60, z:  4, rot: -Math.PI/2 },
  { type: 'gachapon', x: -12, z: 8,  rot: Math.PI / 2 },
  { type: 'gachapon', x:  12, z: 38, rot: -Math.PI / 2 },
  { type: 'postBox', x:  8, z:  8 },
  { type: 'postBox', x: -8, z: -42 },
  { type: 'postBox', x: 48, z: -54 },
  { type: 'parkingMeter', x: -9, z: 30 },
  { type: 'parkingMeter', x: -9, z: 34 },
  { type: 'parkingMeter', x:  9, z: 28 },
  { type: 'parkingMeter', x:  9, z: 32 },
  { type: 'parkingMeter', x: -9, z: -28 },
  { type: 'parkingMeter', x: -9, z: -32 },
  { type: 'utilityBox', x: 14.6, z: 30, rot: -Math.PI / 2 },
  { type: 'utilityBox', x: -14.6, z: 60, rot: Math.PI / 2 },
  { type: 'utilityBox', x: 14.6, z: -82, rot: -Math.PI / 2 },
  { type: 'utilityBox', x:  78, z: -36, rot: 0 },

  // ── Construction / barriers ──────────────────────────────────────────────
  { type: 'cardboardBoxes', x: -36, z: -52, count: 5, seed: 11 },
  { type: 'cardboardBoxes', x: 24, z: -8, count: 4, seed: 22 },
  { type: 'cardboardBoxes', x: -10, z: -24, count: 6, seed: 33 },
  { type: 'cardboardBoxes', x: 60, z: 90, count: 5, seed: 44 },
  { type: 'trafficCones', x: -40, z: 0, axis: 'x', count: 5, spacing: 1.5 },
  { type: 'trafficCones', x:  40, z: -20, axis: 'z', count: 4, spacing: 1.4 },
  { type: 'trafficCones', x: 30, z: -100, axis: 'x', count: 5, spacing: 1.6 },
  { type: 'roadBarrier', x: -42, z:  10, rot: 0, len: 4 },
  { type: 'roadBarrier', x:  36, z:  46, rot: Math.PI / 2, len: 4 },
  { type: 'roadBarrier', x: -16, z: -52, rot: 0, len: 3 },
  { type: 'roadBarrier', x: 38, z: -38, rot: Math.PI / 2, len: 3 },

  // ── Wall posters & graffiti (decals) ─────────────────────────────────────
  { type: 'posterStrip', x: -13.7, z: 50, y: 2.0, rot: -Math.PI / 2, w: 5.5, h: 1.6, count: 6, seed: 7 },
  { type: 'posterStrip', x:  15.3, z: 56, y: 2.0, rot:  Math.PI / 2, w: 5.5, h: 1.6, count: 6, seed: 8 },
  { type: 'posterStrip', x: -19.7, z: -30, y: 2.0, rot: -Math.PI / 2, w: 5.0, h: 1.6, count: 5, seed: 9 },
  { type: 'posterStrip', x: 9.7,  z: -86, y: 2.0, rot:  Math.PI / 2, w: 5.0, h: 1.6, count: 5, seed: 10 },
  { type: 'graffitiDecal', x: -13.85, z: 33, y: 2.5, rot:  Math.PI / 2, w: 4, h: 2, seed: 1 }, // izakaya east wall
  { type: 'graffitiDecal', x:  30.15, z: 4,  y: 2.5, rot: -Math.PI / 2, w: 3.5, h: 1.8, seed: 2 }, // grandShrine west wall
  { type: 'graffitiDecal', x: -23.85, z: -72, y: 2.0, rot:  Math.PI / 2, w: 4, h: 2, seed: 3 }, // midriseB east wall
  { type: 'graffitiDecal', x:  10.85, z: -100, y: 2.5, rot: -Math.PI / 2, w: 4.5, h: 2.2, seed: 4 }, // midriseC west wall

  // ── Benches ──────────────────────────────────────────────────────────────
  { type: 'benchPair', x: -12, z: -14, rot: 0 },
  { type: 'benchPair', x:  10, z:  64, rot: Math.PI / 2 },
  { type: 'benchPair', x:  60, z:  10, rot: 0 },
  { type: 'benchPair', x: -78, z:  30, rot: 0 },

  // ── Rooftop clutter (HVAC, satellites, ducts) — placed precisely at each
  //    host building's roof height with ≥1u inset from any wall edge.
  { type: 'rooftopUnit', x:  18, z: -26, y: 14.05 }, // pachinko (h=14)
  { type: 'rooftopUnit', x: -28, z: -32, y: 22.05 }, // midriseA (h=22)
  { type: 'rooftopUnit', x: -30, z: -78, y: 20.05 }, // midriseB (h=20)
  { type: 'rooftopUnit', x:  18, z: -100, y: 24.05 }, // midriseC (h=24)
  { type: 'rooftopUnit', x:  95, z:  55, y: 34.05 }, // billboardTower (h=34)
  { type: 'rooftopUnit', x: -95, z:  -6, y: 18.05 }, // parkingGarage (h=18)
  { type: 'satellite',   x:  18, z: -32, y: 14.05 }, // pachinko (moved inward from 22)
  { type: 'satellite',   x: -32, z: -82, y: 20.05 }, // midriseB
  { type: 'satellite',   x:  95, z:  60, y: 34.05 }, // billboardTower (z=60 inside z range 48..62)
  { type: 'satellite',   x: -95, z: -104, y: 22.05 }, // midriseE (h=22, z=-104 inside -109..-91)

  // ── More vending clusters in new zones ───────────────────────────────────
  { type: 'vendingCluster', x:  82, z:  44, count: 2, color: NEON.pink, rot: -Math.PI / 2 },
  { type: 'vendingCluster', x: -82, z:  68, count: 2, color: NEON.green, rot: Math.PI / 2 },
  { type: 'vendingCluster', x:  82, z: -22, count: 3, color: NEON.cyan, rot: -Math.PI / 2 },
  { type: 'vendingCluster', x: -82, z: -50, count: 2, color: NEON.yellow, rot: Math.PI / 2 },
  { type: 'vendingCluster', x: -50, z:  90, count: 2, color: NEON.red, rot: Math.PI / 2 },

  // ── More bicycles / scooters / trash / crates ────────────────────────────
  { type: 'bicycle', x: -78, z: 66, rot: 0 }, { type: 'bicycle', x: -78, z: 68, rot: 0 },
  { type: 'bicycle', x: -78, z: 70, rot: 0 }, { type: 'bicycle', x: -78, z: 72, rot: 0 },
  { type: 'bicycle', x:  74, z: 100, rot: Math.PI }, { type: 'bicycle', x:  74, z: 102, rot: Math.PI },
  { type: 'scooter',  x:  60, z:  10, rot: -Math.PI / 2 },
  { type: 'scooter',  x: -62, z: -38, rot: Math.PI / 2 },
  { type: 'scooter',  x:  62, z: -28, rot: 0 },
  { type: 'trashPile', x:  60, z: -44, count: 5 },
  { type: 'trashPile', x: -82, z:   8, count: 6 },
  { type: 'trashPile', x:  84, z: -36, count: 4 },
  { type: 'trashPile', x: -50, z: -100, count: 5 },
  { type: 'crateStack', x: -78, z: 48, count: 4 },
  { type: 'crateStack', x:  60, z: 12, count: 3 },
  { type: 'crateStack', x:  62, z: -38, count: 4 },

  // ── More AC units on new buildings ───────────────────────────────────────
  { type: 'acUnit', x:  87.75, z:  50, y: 6.0,  rot: -Math.PI / 2 },
  { type: 'acUnit', x:  87.75, z:  60, y: 12.0, rot: -Math.PI / 2 },
  { type: 'acUnit', x:  87.75, z:  55, y: 22.0, rot: -Math.PI / 2 },
  { type: 'acUnit', x: -83.75, z:  60, y: 4.0,  rot: Math.PI / 2 },
  { type: 'acUnit', x: -81.75, z:  -8, y: 6.0,  rot: Math.PI / 2 },
  { type: 'acUnit', x: -81.75, z:  -2, y: 12.0, rot: Math.PI / 2 },
  { type: 'acUnit', x:  83.75, z: -90, y: 12.0, rot: -Math.PI / 2 },
  { type: 'acUnit', x: -85.75, z:-100, y: 14.0, rot: Math.PI / 2 },
  { type: 'acUnit', x:  86.75, z: 110, y: 12.0, rot: -Math.PI / 2 },
  { type: 'acUnit', x: -90.75, z: -50, y: 12.0, rot: Math.PI / 2 },

  // ── More steam vents / puddles ──────────────────────────────────────────
  { type: 'steamVent', x: 80, z: 12 },
  { type: 'steamVent', x: -82, z: -26 },
  { type: 'steamVent', x:  38, z: 30 },
  { type: 'steamVent', x: -40, z:  72 },
  { type: 'steamVent', x:  20, z: -106 },
  { type: 'puddle', x: 80, z: -10, w: 3.6, d: 1.8 },
  { type: 'puddle', x: -80, z:  10, w: 3.0, d: 2.2 },
  { type: 'puddle', x: -36, z: 90, w: 4.5, d: 1.8 },
  { type: 'puddle', x:   8, z: -100, w: 4.0, d: 2.6 },
  { type: 'puddle', x: -54, z: -90, w: 3.0, d: 1.6 },

  // ── More lantern rows ────────────────────────────────────────────────────
  { type: 'lanternRow', x:  9.7, z: 38, count: 5, axis: 'z', spacing: 1.6, color: NEON.red },
  { type: 'lanternRow', x: -78.7, z: 50, count: 4, axis: 'z', spacing: 1.4, color: NEON.orange },
  { type: 'lanternRow', x:  62, z: 10, count: 4, axis: 'x', spacing: 1.4, color: NEON.red },
  { type: 'lanternRow', x: -10, z: -50, count: 4, axis: 'x', spacing: 1.4, color: NEON.white },

  // ── More A-frame signs ────────────────────────────────────────────────────
  { type: 'aFrame', x:  60, z:  6, rot: 0, color: NEON.green },
  { type: 'aFrame', x: -78, z:  60, rot: Math.PI / 2, color: NEON.orange },
  { type: 'aFrame', x:  72, z:  92, rot: Math.PI, color: NEON.pink },
  { type: 'aFrame', x: -78, z: -100, rot: 0, color: NEON.cyan },

  // ── More power poles around new layout ──────────────────────────────────
  { type: 'powerPole', x: -78, z:  30 },
  { type: 'powerPole', x: -78, z: -20 },
  { type: 'powerPole', x: -78, z: -52 },
  { type: 'powerPole', x:  78, z:  30 },
  { type: 'powerPole', x:  78, z: -20 },
  { type: 'powerPole', x:  78, z: -52 },
];

// Power-cable sequences — each sub-array is a polyline of pole positions; cables
// will connect each consecutive pair so wires visibly span pole-to-pole.
export const POWER_CABLE_SEQUENCES = [
  // Main vertical street zigzag (south → north)
  [
    { x: -12, z: -45 },
    { x:  12, z: -10 },
    { x: -12, z:  30 },
    { x:  12, z:  60 },
    { x: -12, z:  90 },
  ],
  // Horizontal alley north sidewalk
  [
    { x:  35, z: -47 },
    { x:  62, z: -47 },
  ],
  // West perimeter pole chain
  [
    { x: -78, z: -52 },
    { x: -78, z: -20 },
    { x: -78, z:  30 },
  ],
  // East perimeter pole chain
  [
    { x:  78, z: -52 },
    { x:  78, z: -20 },
    { x:  78, z:  30 },
  ],
];

// Vehicle traffic — cars travel the road grid as closed loops with proper
// turns at intersections.  Japan-style LEFT-HAND traffic: northbound on the
// west side of N-S roads, southbound on the east; eastbound on the north
// side of E-W roads, westbound on the south.  This means cars going one way
// are physically separated from oncoming traffic on the other side.
//
// Roads: x ∈ {-70, 0, 70} (N-S), z ∈ {-62, 20, 80} (E-W).
// Lane offset = 2.2u from centerline.  At each intersection a car can
// continue straight, turn left, or turn right; these tours hand-pick paths
// that exercise every road segment with a mix of CW and CCW circuits.

const LANE_OFF = 2.2;          // distance from road centerline to lane centre
const TURN_APR = 3.6;          // approach distance at intersection turns
const _DIR_VEC = {
  N: [ 0,  1], S: [ 0, -1],
  E: [ 1,  0], W: [-1,  0],
};

// Lane-centre {x,z} for travel direction `d` passing through intersection (ix, iz).
function _laneXZ(d, ix, iz) {
  if (d === 'N') return { x: ix - LANE_OFF, z: iz };
  if (d === 'S') return { x: ix + LANE_OFF, z: iz };
  if (d === 'E') return { x: ix, z: iz + LANE_OFF };
  if (d === 'W') return { x: ix, z: iz - LANE_OFF };
}

// Build a closed-loop polyline from a sequence of intersection stops.
// Each stop = { ix, iz, out }.  The car arrives at stop i in the direction
// stops[i-1].out and leaves in direction stops[i].out — change of direction
// implies a turn at that intersection.  Two waypoints per stop (pre/post)
// give a clean diagonal across the intersection during turns and a straight
// line for continue-through cases.
function _tour(stops) {
  const N = stops.length;
  const wps = [];
  for (let i = 0; i < N; i++) {
    const cur = stops[i];
    const prev = stops[(i - 1 + N) % N];
    const inLane  = _laneXZ(prev.out, cur.ix, cur.iz);
    const outLane = _laneXZ(cur.out,  cur.ix, cur.iz);
    const [idx, idz] = _DIR_VEC[prev.out];
    const [odx, odz] = _DIR_VEC[cur.out];
    wps.push({ x: inLane.x  - idx * TURN_APR, z: inLane.z  - idz * TURN_APR });
    wps.push({ x: outLane.x + odx * TURN_APR, z: outLane.z + odz * TURN_APR });
  }
  wps.push({ ...wps[0] }); // close loop
  return wps;
}

// Tour catalogue — closed circuits visiting 4–6 intersections each.
// CCW = all left turns, CW = all right turns.  Mixed routes weave around.
const _ROUTES = {
  // 4-stop block loops
  swCCW: _tour([
    { ix: -70, iz: -62, out: 'E' },
    { ix:   0, iz: -62, out: 'N' },
    { ix:   0, iz:  20, out: 'W' },
    { ix: -70, iz:  20, out: 'S' },
  ]),
  swCW: _tour([
    { ix: -70, iz: -62, out: 'N' },
    { ix: -70, iz:  20, out: 'E' },
    { ix:   0, iz:  20, out: 'S' },
    { ix:   0, iz: -62, out: 'W' },
  ]),
  seCCW: _tour([
    { ix:   0, iz: -62, out: 'E' },
    { ix:  70, iz: -62, out: 'N' },
    { ix:  70, iz:  20, out: 'W' },
    { ix:   0, iz:  20, out: 'S' },
  ]),
  seCW: _tour([
    { ix:   0, iz: -62, out: 'N' },
    { ix:   0, iz:  20, out: 'E' },
    { ix:  70, iz:  20, out: 'S' },
    { ix:  70, iz: -62, out: 'W' },
  ]),
  nwCCW: _tour([
    { ix: -70, iz:  20, out: 'E' },
    { ix:   0, iz:  20, out: 'N' },
    { ix:   0, iz:  80, out: 'W' },
    { ix: -70, iz:  80, out: 'S' },
  ]),
  nwCW: _tour([
    { ix: -70, iz:  20, out: 'N' },
    { ix: -70, iz:  80, out: 'E' },
    { ix:   0, iz:  80, out: 'S' },
    { ix:   0, iz:  20, out: 'W' },
  ]),
  neCCW: _tour([
    { ix:   0, iz:  20, out: 'E' },
    { ix:  70, iz:  20, out: 'N' },
    { ix:  70, iz:  80, out: 'W' },
    { ix:   0, iz:  80, out: 'S' },
  ]),
  neCW: _tour([
    { ix:   0, iz:  20, out: 'N' },
    { ix:   0, iz:  80, out: 'E' },
    { ix:  70, iz:  80, out: 'S' },
    { ix:  70, iz:  20, out: 'W' },
  ]),
  // 6-stop big band loops (north + south halves separately)
  bigSouthCCW: _tour([
    { ix: -70, iz: -62, out: 'E' },
    { ix:   0, iz: -62, out: 'E' },
    { ix:  70, iz: -62, out: 'N' },
    { ix:  70, iz:  20, out: 'W' },
    { ix:   0, iz:  20, out: 'W' },
    { ix: -70, iz:  20, out: 'S' },
  ]),
  bigSouthCW: _tour([
    { ix: -70, iz: -62, out: 'N' },
    { ix: -70, iz:  20, out: 'E' },
    { ix:   0, iz:  20, out: 'E' },
    { ix:  70, iz:  20, out: 'S' },
    { ix:  70, iz: -62, out: 'W' },
    { ix:   0, iz: -62, out: 'W' },
  ]),
  bigNorthCCW: _tour([
    { ix: -70, iz:  20, out: 'E' },
    { ix:   0, iz:  20, out: 'E' },
    { ix:  70, iz:  20, out: 'N' },
    { ix:  70, iz:  80, out: 'W' },
    { ix:   0, iz:  80, out: 'W' },
    { ix: -70, iz:  80, out: 'S' },
  ]),
  bigNorthCW: _tour([
    { ix: -70, iz:  20, out: 'N' },
    { ix: -70, iz:  80, out: 'E' },
    { ix:   0, iz:  80, out: 'E' },
    { ix:  70, iz:  80, out: 'S' },
    { ix:  70, iz:  20, out: 'W' },
    { ix:   0, iz:  20, out: 'W' },
  ]),
  // Full perimeter (corner intersections only — straight-shoots along long roads)
  fullCCW: _tour([
    { ix: -70, iz: -62, out: 'E' },
    { ix:  70, iz: -62, out: 'N' },
    { ix:  70, iz:  80, out: 'W' },
    { ix: -70, iz:  80, out: 'S' },
  ]),
  fullCW: _tour([
    { ix: -70, iz: -62, out: 'N' },
    { ix: -70, iz:  80, out: 'E' },
    { ix:  70, iz:  80, out: 'S' },
    { ix:  70, iz: -62, out: 'W' },
  ]),
  // S-shape weave (two left turns, two right turns)
  weaveA: _tour([
    { ix: -70, iz: -62, out: 'E' },
    { ix:   0, iz: -62, out: 'N' },
    { ix:   0, iz:  20, out: 'E' },
    { ix:  70, iz:  20, out: 'N' },
    { ix:  70, iz:  80, out: 'W' },
    { ix:   0, iz:  80, out: 'W' },
    { ix: -70, iz:  80, out: 'S' },
    { ix: -70, iz:  20, out: 'S' },
  ]),
  weaveB: _tour([
    { ix:  70, iz:  80, out: 'W' },
    { ix:   0, iz:  80, out: 'S' },
    { ix:   0, iz:  20, out: 'W' },
    { ix: -70, iz:  20, out: 'S' },
    { ix: -70, iz: -62, out: 'E' },
    { ix:   0, iz: -62, out: 'E' },
    { ix:  70, iz: -62, out: 'N' },
    { ix:  70, iz:  20, out: 'N' },
  ]),
};

export const VEHICLE_PATHS = [
  { kind: 'taxi',          speed: 9,    color: 0xf0d040, tStart: 0.00, path: _ROUTES.bigSouthCCW },
  { kind: 'sedan',         speed: 7,    color: 0x202028, tStart: 0.40, path: _ROUTES.bigSouthCW },
  { kind: 'van',           speed: 6,    color: 0xffffff, tStart: 0.70, path: _ROUTES.fullCCW },
  { kind: 'kei',           speed: 5,    color: 0x60a060, tStart: 0.20, path: _ROUTES.fullCW },
  { kind: 'taxi',          speed: 8,    color: 0x40c0d0, tStart: 0.55, path: _ROUTES.bigNorthCCW },
  { kind: 'sedan',         speed: 6.5,  color: 0x802020, tStart: 0.15, path: _ROUTES.swCW },
  { kind: 'bus',           speed: 5,    color: 0x4a90c0, tStart: 0.85, path: _ROUTES.bigSouthCCW },
  { kind: 'policeCar',     speed: 10,   color: 0x101820, tStart: 0.35, path: _ROUTES.weaveA },
  { kind: 'deliveryTruck', speed: 5.5,  color: 0xd0c060, tStart: 0.60, path: _ROUTES.swCCW },
  { kind: 'taxi',          speed: 8.5,  color: 0xf0a020, tStart: 0.05, path: _ROUTES.seCW },
  { kind: 'kei',           speed: 5.8,  color: 0x9060a0, tStart: 0.45, path: _ROUTES.seCCW },
  { kind: 'sedan',         speed: 7.5,  color: 0x506070, tStart: 0.90, path: _ROUTES.bigNorthCW },
  { kind: 'van',           speed: 5.5,  color: 0xc0c0c0, tStart: 0.25, path: _ROUTES.nwCCW },
  { kind: 'kei',           speed: 6,    color: 0xa04040, tStart: 0.65, path: _ROUTES.nwCW },
  { kind: 'sedan',         speed: 7.5,  color: 0x8a3030, tStart: 0.12, path: _ROUTES.bigSouthCCW },
  { kind: 'taxi',          speed: 9.5,  color: 0x40d0a0, tStart: 0.32, path: _ROUTES.weaveB },
  { kind: 'policeCar',     speed: 9,    color: 0x101820, tStart: 0.78, path: _ROUTES.fullCW },
  { kind: 'ambulance',     speed: 11,   color: 0xf2f2f2, tStart: 0.18, path: _ROUTES.weaveA },
  { kind: 'fireTruck',     speed: 8,    color: 0xc01818, tStart: 0.50, path: _ROUTES.bigSouthCW },
  { kind: 'sportsCar',     speed: 13,   color: 0xff2050, tStart: 0.62, path: _ROUTES.fullCCW },
  { kind: 'sportsCar',     speed: 12,   color: 0x20d0ff, tStart: 0.08, path: _ROUTES.neCCW },
  { kind: 'limo',          speed: 5,    color: 0x080810, tStart: 0.40, path: _ROUTES.bigNorthCW },
  { kind: 'limo',          speed: 6,    color: 0x101218, tStart: 0.70, path: _ROUTES.swCW },
  { kind: 'van',           speed: 6.2,  color: 0xa07840, tStart: 0.05, path: _ROUTES.seCW },
  { kind: 'bus',           speed: 5.5,  color: 0xb04030, tStart: 0.27, path: _ROUTES.neCW },
  { kind: 'sportsCar',     speed: 11,   color: 0xfff060, tStart: 0.88, path: _ROUTES.weaveB },
  { kind: 'ambulance',     speed: 10,   color: 0xfafafa, tStart: 0.55, path: _ROUTES.bigNorthCCW },
  { kind: 'taxi',          speed: 8.8,  color: 0xf0d040, tStart: 0.42, path: _ROUTES.neCCW },
  { kind: 'kei',           speed: 5.2,  color: 0x4080a0, tStart: 0.58, path: _ROUTES.swCCW },
  { kind: 'sedan',         speed: 7.2,  color: 0x60584a, tStart: 0.83, path: _ROUTES.nwCW },
];

// Micro-prop scatter — instanced ground-clutter regions.  Avoid building
// footprints to keep clutter on roads/sidewalks.
const _bldgAvoid = [
  { minX: 10, maxX: 34, minZ: -39, maxZ: -17 },   // pachinko
  { minX: -30, maxX: -14, minZ: 31, maxZ: 45 },   // izakaya
  { minX: 15, maxX: 33, minZ: 48, maxZ: 64 },     // capsule
  { minX: -30, maxX: -14, minZ: -2, maxZ: 10 },   // konbini
  { minX: 39, maxX: 61, minZ: -103, maxZ: -85 },  // love
  { minX: -36, maxX: -20, minZ: -42, maxZ: -26 }, // midriseA
  { minX: -40, maxX: -24, minZ: -86, maxZ: -70 }, // midriseB
  { minX: 11, maxX: 29, minZ: -103, maxZ: -87 },  // midriseC
  { minX: 88, maxX: 102, minZ: 48, maxZ: 62 },    // billboardTower
  { minX: -106, maxX: -84, minZ: 46, maxZ: 64 },  // sento
  { minX: 82, maxX: 108, minZ: -19, maxZ: 3 },    // gasStation
  { minX: -108, maxX: -82, minZ: -19, maxZ: 7 },  // parkingGarage
  { minX: -24.5, maxX: -19.5, minZ: -52.5, maxZ: -47.5 }, // koban
  { minX: 84, maxX: 100, minZ: -103, maxZ: -87 }, // midriseD
  { minX: -104, maxX: -86, minZ: -109, maxZ: -91 }, // midriseE
  { minX: 87, maxX: 103, minZ: 100, maxZ: 116 },  // midriseF
  { minX: -109, maxX: -91, minZ: -58, maxZ: -42 },// midriseG
  { minX: 47, maxX: 65, minZ: 92, maxZ: 108 },    // midriseH
  { minX: -57, maxX: -43, minZ: -37, maxZ: -23 }, // officeTower
  { minX: -57, maxX: -43, minZ: -3,  maxZ: 11 },  // hotelTower
  { minX: 40,  maxX: 60,  minZ: 27,  maxZ: 45 },  // departmentStore
  { minX: -59, maxX: -41, minZ: 59,  maxZ: 73 },  // apartmentBlock
  { minX: -63, maxX: -53, minZ: -90, maxZ: -82 }, // billboardTower2
  { minX: 48,  maxX: 62,  minZ: -37, maxZ: -23 }, // officeBlock2
  { minX: 77,  maxX: 91,  minZ: 87,  maxZ: 97 },  // shopArcade
  { minX: -62, maxX: -48, minZ: -50, maxZ: -40 }, // karaokePlaza
  { minX: -120, maxX: -108, minZ: 94,  maxZ: 106 }, // edgeTowerNW
  { minX: 106,  maxX: 118,  minZ: 94,  maxZ: 106 }, // edgeTowerNE
  { minX: 106,  maxX: 118,  minZ: -51, maxZ: -39 }, // edgeTowerSE
  { minX: -118, maxX: -106, minZ: -88, maxZ: -76 }, // edgeTowerSW
  { minX: 28,   maxX: 52,   minZ: -12, maxZ: 12 }, // grandShrine (extended for torii path + lanterns)
  { minX: -22,  maxX: -8,   minZ: -24, maxZ: -8 }, // small shrine (incl. torii in front)
  { minX: -57,  maxX: -43,  minZ: 93,  maxZ: 107 }, // midriseI
  { minX: -32,  maxX: -18,  minZ: 93,  maxZ: 107 }, // midriseJ
  { minX: -90,  maxX: -80,  minZ: 111, maxZ: 119 }, // cinemaTower
  { minX: -101, maxX: -89,  minZ: 87,  maxZ: 97 },  // arcadeJ
  { minX: -31,  maxX: -19,  minZ: 59,  maxZ: 69 },  // liveHouseN
  // Roads (avoid scattering clutter on driving lanes)
  { minX: -5, maxX: 5, minZ: -125, maxZ: 125 },   // main N-S (narrowed)
  { minX: -76, maxX: -64, minZ: -125, maxZ: 125 },// west N-S
  { minX: 64, maxX: 76, minZ: -125, maxZ: 125 },  // east N-S
  { minX: -125, maxX: 125, minZ: -69, maxZ: -55 },// main E-W
  { minX: -125, maxX: 125, minZ: 14, maxZ: 26 },  // sec E-W
  { minX: -125, maxX: 125, minZ: 74, maxZ: 86 },  // far north E-W
  // Sidewalk signs — small footprints to keep tree foliage off them.
  { minX:   6, maxX:  10, minZ:  42, maxZ:  46 }, // sidewalkSign OPEN (8, 44)
  { minX: -10, maxX:  -6, minZ:   8, maxZ:  12 }, // sidewalkSign バル (-8, 10)
  { minX:  42, maxX:  46, minZ: -56, maxZ: -52 }, // sidewalkSign 麺 (44, -54)
  { minX: -10, maxX:  -6, minZ: -54, maxZ: -50 }, // sidewalkSign カフェ (-8, -52)
];

export const MICRO_SCATTERS = [
  { type: 'cigButt',     count: 80, minX: -110, maxX: 110, minZ: -110, maxZ: 110, avoid: _bldgAvoid, seed: 1 },
  { type: 'paperTrash',  count: 60, minX: -110, maxX: 110, minZ: -110, maxZ: 110, avoid: _bldgAvoid, seed: 2 },
  { type: 'leaf',        count: 70, minX: -110, maxX: 110, minZ: -110, maxZ: 110, avoid: _bldgAvoid, seed: 3 },
  { type: 'bottleCap',   count: 40, minX: -110, maxX: 110, minZ: -110, maxZ: 110, avoid: _bldgAvoid, seed: 4 },
  { type: 'streetGarbage', count: 30, minX: -110, maxX: 110, minZ: -110, maxZ: 110, avoid: _bldgAvoid, seed: 5 },
  { type: 'glassShards', count: 50, minX: -110, maxX: 110, minZ: -110, maxZ: 110, avoid: _bldgAvoid, seed: 6 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tactical features
// ─────────────────────────────────────────────────────────────────────────────

export const TACTICAL_FEATURES = [
  // Fire-escape ladders (vertical traversal on at least 3 buildings).
  { kind: 'fireLadder', wall: 'east', buildingId: 'midriseA', wallOffset: 3 },
  { kind: 'fireLadder', wall: 'east', buildingId: 'midriseB', wallOffset: 3 },
  { kind: 'fireLadder', wall: 'south', buildingId: 'midriseC' },
  { kind: 'fireLadder', wall: 'north', buildingId: 'pachinko' },
  // Rooftop-spawn buildings — every alien-spawn rooftop now has ground access.
  { kind: 'fireLadder', wall: 'south', buildingId: 'billboardTower' },
  { kind: 'fireLadder', wall: 'east',  buildingId: 'parkingGarage' },
  { kind: 'fireLadder', wall: 'east',  buildingId: 'sento' },
  { kind: 'fireLadder', wall: 'west',  buildingId: 'midriseD', wallOffset: 3 },
  { kind: 'fireLadder', wall: 'east',  buildingId: 'midriseE', wallOffset: 3 },
  { kind: 'fireLadder', wall: 'south', buildingId: 'midriseF' },
  { kind: 'fireLadder', wall: 'south', buildingId: 'midriseG' },
  { kind: 'fireLadder', wall: 'north', buildingId: 'midriseH' },
  // Ladders on the new tall fillers
  { kind: 'fireLadder', wall: 'east',  buildingId: 'officeTower', wallOffset: 3 },
  { kind: 'fireLadder', wall: 'west',  buildingId: 'hotelTower' },
  { kind: 'fireLadder', wall: 'west',  buildingId: 'apartmentBlock' },
  { kind: 'fireLadder', wall: 'south', buildingId: 'billboardTower2' },
  { kind: 'fireLadder', wall: 'east',  buildingId: 'officeBlock2', wallOffset: 3 },
  // Remaining rooftop-spawn buildings.
  { kind: 'fireLadder', wall: 'north', buildingId: 'midriseI' },
  { kind: 'fireLadder', wall: 'east',  buildingId: 'cinemaTower' },
  { kind: 'fireLadder', wall: 'east',  buildingId: 'departmentStore', wallOffset: 3 },

  // Wooden plank between two rooftops (risky shortcut).
  { kind: 'plank', from: { x: -28, z: -42, y: TIER_ROOF + 7 }, to: { x: -32, z: -70, y: TIER_ROOF + 5 }, w: 1.2 },

  // Rooftop traversal beams — horizontal connectors between adjacent buildings.
  // Endpoints sit ~1u inside each roof so the beam appears to rest on both rooftops.
  // officeTower (-50,-30,h=42) ↔ hotelTower (-50,4,h=44) — 20u gap, both very tall
  { kind: 'rooftopBeam', from: { x: -50, z: -25.0, y: 42.5 }, to: { x: -50, z: -1.0, y: 42.5 } },
  // midriseA (-28,-34,h=22) ↔ karaokePlaza (-55,-45,h=14) — sloped beam (x gap 12, h drop 8)
  { kind: 'rooftopBeam', from: { x: -35.0, z: -41.0, y: 22.4 }, to: { x: -49.0, z: -42.5, y: 14.4 } },
  // departmentStore (50,36,h=18) ↔ capsuleHotel (24,56,h=16) — diagonal slight slope
  { kind: 'rooftopBeam', from: { x: 41.0, z: 44.0, y: 18.4 }, to: { x: 32.5, z: 49.0, y: 16.4 } },

  // Open manhole + storm drain (~30u underground, two exits).
  { kind: 'manhole', x: 0, z: 70 },
  { kind: 'manhole', x: 0, z: 40 },
  { kind: 'stormDrain', from: { x: 0, z: 70 }, to: { x: 0, z: 40 }, w: 4, depth: 4 },
  // Second storm drain — runs east-west under the main avenue (z=-65) between
  // the pachinko parlor and the gas station, two new exit manholes.
  { kind: 'manhole', x: 36, z: -65 },
  { kind: 'manhole', x: 72, z: -65 },
  { kind: 'stormDrain', from: { x: 36, z: -65 }, to: { x: 72, z: -65 }, w: 4, depth: 4 },

  // ── Environmental hazards (damage-on-contact / area-denial) ─────────────
  // Sidewalk steam-vent grates — boiling steam erupts on a duty cycle.
  { kind: 'steamGrate', x: -12, z:  24, period: 5.0, dutyOn: 0.55 },
  { kind: 'steamGrate', x:  62, z: -10, period: 4.2, dutyOn: 0.5 },
  // Sparking downed power line near the parking garage — continuous arc.
  { kind: 'electricArc', x: -82, z:  10 },
  // Ignited gas leak at the gas-station forecourt — burning column of fire.
  { kind: 'gasFire',     x:  86, z: -22 },
  // Toxic chemical puddle in the dept-store loading zone — glowing green sludge.
  { kind: 'toxicSpill',  x:  45, z:  70, w: 4.5, d: 3.0 },

  // Vault window into izakaya 2nd floor.
  { kind: 'vaultWindow', buildingId: 'izakaya', wall: 'east', y: 4.2 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Spawn points (named)
// ─────────────────────────────────────────────────────────────────────────────

export const SPAWNS = {
  player: [
    // Spread across all four quadrants on sidewalks/open ground.
    // NE quadrant
    { name: 'spawn_player_ne_a', x:  35, z:  10, facing: Math.PI },
    { name: 'spawn_player_ne_b', x:  82, z:  68, facing: -Math.PI / 2 },
    { name: 'spawn_player_ne_c', x:  40, z:  60, facing: Math.PI / 2 },
    // NW quadrant
    { name: 'spawn_player_nw_a', x: -40, z:  30, facing: 0 },
    { name: 'spawn_player_nw_b', x: -78, z:  44, facing: 0 },
    { name: 'spawn_player_nw_c', x: -38, z:  92, facing: 0 },
    // SE quadrant
    { name: 'spawn_player_se_a', x:  35, z: -45, facing: Math.PI },
    { name: 'spawn_player_se_b', x:  82, z: -45, facing: Math.PI / 2 },
    { name: 'spawn_player_se_c', x:  60, z: -110, facing: Math.PI / 2 },
    // SW quadrant
    { name: 'spawn_player_sw_a', x: -42, z: -10, facing: 0 },
    { name: 'spawn_player_sw_b', x: -82, z: -75, facing: 0 },
    { name: 'spawn_player_sw_c', x: -45, z: -110, facing: -Math.PI / 2 },
  ],
  enemies: [
    { name: 'spawn_enemy_north_main',    x:   0, z: -110, facing: Math.PI / 2 },
    { name: 'spawn_enemy_pachinko_roof', x:  22, z:  -28, y: TIER_ROOF + 0.2, facing: Math.PI },
    { name: 'spawn_enemy_midrise_roof',  x: -32, z:  -78, y: TIER_ROOF + 5.5, facing: 0 },
    { name: 'spawn_enemy_alley_hidden',  x: -56, z:  -53, facing: 0 },
    { name: 'spawn_enemy_billboard_roof', x:  95, z:  55, y: TIER_ROOF + 19.4, facing: Math.PI },
    { name: 'spawn_enemy_garage_roof',   x: -95, z:  -6, y: TIER_ROOF + 3.4, facing: Math.PI / 2 },
    { name: 'spawn_enemy_gas_station',   x:  88, z: -10, facing: Math.PI },
    { name: 'spawn_enemy_west_alley',    x: -104, z: 100, facing: -Math.PI / 4 },
    { name: 'spawn_enemy_south_east',    x: 102, z: -100, facing: Math.PI },
    { name: 'spawn_enemy_south_west',    x: -95, z: -110, facing: Math.PI / 4 },
    { name: 'spawn_enemy_midriseD_roof', x:  92, z: -95, y: TIER_ROOF + 11.4, facing: Math.PI },
    { name: 'spawn_enemy_sento_roof',    x: -95, z:  55, y: 7.2, facing: 0 },
    // ── Extra spawn variety (ground + rooftop) ─────────────────────────────
    { name: 'spawn_enemy_north_far',         x: -10, z:  118, facing: -Math.PI / 2 },
    { name: 'spawn_enemy_north_east',        x:  60, z:  115, facing: -Math.PI / 2 },
    { name: 'spawn_enemy_central_alley',     x:  35, z:   12, facing: Math.PI },
    { name: 'spawn_enemy_west_central',      x: -60, z:   30, facing: 0 },
    { name: 'spawn_enemy_southwest_alley',   x: -50, z:  -90, facing: Math.PI / 4 },
    { name: 'spawn_enemy_southeast_park',    x:  35, z:  -65, facing: Math.PI },
    { name: 'spawn_enemy_midriseI_roof',     x: -50, z:  100, y: TIER_ROOF + 15.4, facing: Math.PI },
    { name: 'spawn_enemy_cinema_roof',       x: -85, z:  115, y: TIER_ROOF + 29.4, facing: Math.PI / 2 },
    { name: 'spawn_enemy_apartment_roof',    x: -50, z:   66, y: TIER_ROOF + 9.4, facing: Math.PI / 2 },
    { name: 'spawn_enemy_dept_roof',         x:  50, z:   36, y: TIER_ROOF + 3.4, facing: -Math.PI / 2 },
    { name: 'spawn_enemy_office_tower_roof', x: -50, z:  -30, y: TIER_ROOF + 27.4, facing: 0 },
    { name: 'spawn_enemy_grandshrine_side',  x:  44, z:   11, facing: -Math.PI / 2 },
    { name: 'spawn_enemy_far_north_avenue',  x: -90, z:   78, facing: -Math.PI / 2 },
    { name: 'spawn_enemy_east_secondary',    x:  90, z:   12, facing: Math.PI },
  ],
  cover: [
    { name: 'cover_vending_a', x: -14, z:  50 },
    { name: 'cover_vending_b', x:  14, z:  12 },
    { name: 'cover_vending_c', x:  -9, z: -16 },
    { name: 'cover_crates_izakaya', x: -13, z: 32 },
    { name: 'cover_truck',     x: -8.5, z:  88 },
    { name: 'cover_torii',     x: -15,  z:  -9.5 },
    { name: 'cover_alley_trash', x: -34, z: -50 },
    { name: 'cover_pole_a',    x:  12, z: -10 },
    { name: 'cover_crashed_a', x:  10, z: -54 },
    { name: 'cover_crashed_b', x: -54, z:  30 },
    { name: 'cover_crashed_c', x:  46, z: -78 },
    { name: 'cover_dumpster_a', x: -50, z: -8 },
    { name: 'cover_dumpster_b', x:  38, z:  44 },
    { name: 'cover_dumpster_c', x: -54, z:  88 },
    { name: 'cover_phonebooth', x: -8, z: 32 },
    { name: 'cover_postbox_a',  x:  8, z:  8 },
    { name: 'cover_barrier_a', x: -42, z:  10 },
    { name: 'cover_barrier_b', x:  36, z:  50 },
    { name: 'cover_barrier_c', x: -16, z: -52 },
    { name: 'cover_cones_a',    x: -40, z:   0 },
    { name: 'cover_boxes_a',   x: -36, z: -52 },
    { name: 'cover_boxes_b',   x:  24, z:  -8 },
    { name: 'cover_vending_e', x:  82, z:  44 },
    { name: 'cover_vending_f', x: -82, z:  68 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Lighting plan (data-driven)
// ─────────────────────────────────────────────────────────────────────────────

export const LIGHT_PLAN = [
  // Sky / hemi — strong base ambient
  { kind: 'hemi', sky: 0x6a78a8, ground: 0x2a2e44, intensity: 2.6 },
  // Cool moonlight key
  { kind: 'directional', x: 60, y: 80, z: 40, color: 0xb8c8f0, intensity: 1.8 },
  // Opposite-side fill
  { kind: 'directional', x: -50, y: 60, z: -60, color: 0x90a0d8, intensity: 1.0 },
  // Top-down soft fill
  { kind: 'directional', x: 0, y: 100, z: 0, color: 0xa8b8e0, intensity: 0.7 },

  // Neon spillover lights — only a handful of hero anchors. Forward renderer
  // cost is per-light-per-fragment-per-mesh, so we keep total point lights
  // under ~12 and rely on emissive materials for the rest of the neon glow.
  { kind: 'point', x:  22, z: -28, y: 8, color: NEON.pink,   intensity: 12.0, dist: 42 }, // pachinko
  { kind: 'point', x: -22, z:  38, y: 6, color: NEON.red,    intensity: 9.0,  dist: 32 }, // izakaya
  { kind: 'point', x:  50, z: -94, y: 7, color: NEON.purple, intensity: 10.0, dist: 38 }, // love hotel
  { kind: 'point', x: -22, z:   4, y: 4, color: NEON.green,  intensity: 8.0,  dist: 30 }, // konbini

  // Warm window spill (izakaya)
  { kind: 'point', x: -22, z:   4, y: 2.0, color: 0xfff0c0, intensity: 5.5, dist: 24 },

  // Ambient fill points removed — hemi + 3 directional already provide base
  // illumination, and 5 extra points were costing ~5x fragment time for
  // marginal lift on distant geo.

  // Flickering streetlight — flag for animator
  { kind: 'streetlight', x:  -6, z:  60, flicker: true },
  { kind: 'streetlight', x:   6, z:  10 },
  { kind: 'streetlight', x:  -6, z: -34 },
  { kind: 'streetlight', x:  20, z: -52 },
  { kind: 'streetlight', x:  60, z: -47 },
  { kind: 'streetlight', x: -60, z:   0, flicker: true },
  { kind: 'streetlight', x:  60, z:  40 },
  { kind: 'streetlight', x: -60, z:  60 },
  { kind: 'streetlight', x: -60, z: -54 },
  { kind: 'streetlight', x:  60, z: -80, flicker: true },
  { kind: 'streetlight', x: -100, z: 27 },
  { kind: 'streetlight', x:  100, z: 27 },

  // Big-building hero neons (kept few — emissive signs on each building still glow).
  { kind: 'point', x:  95, z:  55, y: 16, color: NEON.pink,   intensity: 14.0, dist: 56 }, // billboard tower N
  { kind: 'point', x: -58, z: -86, y: 36, color: NEON.pink,   intensity: 11.0, dist: 42 }, // billboard tower S
  { kind: 'point', x:  92, z: -95, y: 12, color: NEON.purple, intensity: 9.0,  dist: 36 },

  // Grand shrine — single warm anchor down the torii path
  { kind: 'point', x:  40, z:  -3, y: 5,  color: 0xff6030, intensity: 9.0,  dist: 22 }, // honden glow
];

// ─────────────────────────────────────────────────────────────────────────────
// Build helpers
// ─────────────────────────────────────────────────────────────────────────────

function mat(THREE, color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.05,
    emissive:  opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1.0,
    transparent: opts.transparent ?? false,
    opacity:    opts.opacity ?? 1.0,
    side:       opts.side ?? THREE.FrontSide,
  });
}

function box(THREE, w, h, d, material) {
  const g = new THREE.BoxGeometry(w, h, d);
  return new THREE.Mesh(g, material);
}

function cyl(THREE, rTop, rBot, h, material, segs = 16) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs);
  return new THREE.Mesh(g, material);
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural canvas-texture helpers — for kanji signs, posters, graffiti,
// asphalt noise, and the night-sky backdrop.  All textures cached by key so
// repeated content (e.g. 30 cigarette-butt instances) shares one texture.
// ─────────────────────────────────────────────────────────────────────────────

const _texCache = new Map();
function makeCanvasTexture(THREE, key, size, drawFn) {
  if (_texCache.has(key)) return _texCache.get(key);
  const c = document.createElement('canvas');
  c.width = size.w; c.height = size.h;
  const ctx = c.getContext('2d');
  drawFn(ctx, size.w, size.h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

function hex2rgb(hex) {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}
function rgbStr(hex, a = 1) { const [r, g, b] = hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; }

// Vertical-kanji sign face: black background + glowing kanji painted vertically.
function makeKanjiTexture(THREE, text, color, h) {
  const key = `kanji|${text}|${color}|${h.toFixed(1)}`;
  return makeCanvasTexture(THREE, key, { w: 128, h: 512 }, (ctx, w, hh) => {
    ctx.fillStyle = '#0a0a0e';
    ctx.fillRect(0, 0, w, hh);
    // Outer neon border
    ctx.strokeStyle = rgbStr(color, 0.9);
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, hh - 16);
    const chars = Array.from(text);
    const cellH = (hh - 32) / Math.max(chars.length, 1);
    const fontSize = Math.min(96, cellH * 0.78);
    ctx.font = `bold ${fontSize}px "Yu Gothic","Noto Sans JP","Hiragino Kaku Gothic ProN","Meiryo",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Glow under-pass
    ctx.shadowColor = rgbStr(color, 1);
    ctx.shadowBlur = 24;
    ctx.fillStyle = rgbStr(color, 1);
    for (let i = 0; i < chars.length; i++) {
      const cy = 16 + cellH * (i + 0.5);
      ctx.fillText(chars[i], w / 2, cy);
    }
    // Bright core
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < chars.length; i++) {
      const cy = 16 + cellH * (i + 0.5);
      ctx.fillText(chars[i], w / 2, cy);
    }
  });
}

// Horizontal billboard art (kanji-heavy ad).
function makeBillboardTexture(THREE, text, color) {
  const key = `bb|${text}|${color}`;
  return makeCanvasTexture(THREE, key, { w: 1024, h: 256 }, (ctx, w, hh) => {
    // Dark backing — deep navy/black so neon pops.
    ctx.fillStyle = '#08080e';
    ctx.fillRect(0, 0, w, hh);
    // Vertical scanline / panel-divider pattern for industrial feel
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < w; i += 6) ctx.fillRect(i, 0, 2, hh);
    // Soft color wash from edges
    const wash = ctx.createLinearGradient(0, 0, w, 0);
    wash.addColorStop(0,    rgbStr(color, 0.55));
    wash.addColorStop(0.18, rgbStr(color, 0.10));
    wash.addColorStop(0.5,  'rgba(0,0,0,0)');
    wash.addColorStop(0.82, rgbStr(color, 0.10));
    wash.addColorStop(1,    rgbStr(color, 0.55));
    ctx.fillStyle = wash; ctx.fillRect(0, 0, w, hh);
    // Outer neon-tube border (double line)
    ctx.strokeStyle = rgbStr(color, 1);
    ctx.lineWidth = 8;
    ctx.shadowColor = rgbStr(color, 1);
    ctx.shadowBlur = 22;
    ctx.strokeRect(14, 14, w - 28, hh - 28);
    ctx.lineWidth = 3;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(20, 20, w - 40, hh - 40);
    // Decorative star / asterisk corners
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = rgbStr(color, 1);
    ctx.shadowBlur = 16;
    ctx.fillStyle = rgbStr(color, 1);
    ctx.fillText('★', 50, 36);
    ctx.fillText('★', w - 50, 36);
    ctx.fillText('★', 50, hh - 36);
    ctx.fillText('★', w - 50, hh - 36);
    // Main kanji/katakana — render under-glow then white core for that
    // saturated neon-tube look.
    ctx.font = 'bold 168px "Yu Gothic","Noto Sans JP","Hiragino Kaku Gothic ProN",sans-serif';
    ctx.shadowColor = rgbStr(color, 1);
    ctx.shadowBlur = 56;
    ctx.fillStyle = rgbStr(color, 1);
    ctx.fillText(text, w / 2, hh / 2 + 6);
    ctx.shadowBlur = 24;
    ctx.fillStyle = rgbStr(color, 1);
    ctx.fillText(text, w / 2, hh / 2 + 6);
    // White core
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, hh / 2 + 6);
    // Underline / katakana subtitle for that stacked-billboard feel
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgbStr(color, 0.85);
    ctx.fillRect(w * 0.18, hh - 50, w * 0.64, 4);
  });
}

// Wall poster (small).  Random colour palette per seed.
function makePosterTexture(THREE, seed) {
  const palettes = [
    ['#ff2d8a', '#ffd200', '#0a0a14'],
    ['#00e5ff', '#ff2030', '#0a0a14'],
    ['#a040ff', '#fff7e0', '#0a0a14'],
    ['#32ff7a', '#ff8a1a', '#0a0a14'],
  ];
  const pal = palettes[seed % palettes.length];
  const key = `poster|${seed}`;
  return makeCanvasTexture(THREE, key, { w: 256, h: 384 }, (ctx, w, h) => {
    ctx.fillStyle = pal[2]; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = pal[0]; ctx.fillRect(8, 8, w - 16, h * 0.55);
    ctx.fillStyle = pal[1];
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★ LIVE ★', w / 2, h * 0.32);
    ctx.font = 'bold 100px "Yu Gothic","Noto Sans JP",sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(['歌', '舞', '伎', '町'][seed % 4], w / 2, h * 0.78);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(0, 0, w, h);
  });
}

// Graffiti tag — irregular sprayed patch.
function makeGraffitiTexture(THREE, seed) {
  const colors = [0xff2d8a, 0x00e5ff, 0x32ff7a, 0xff8a1a, 0xa040ff];
  const c = colors[seed % colors.length];
  const key = `graf|${seed}`;
  return makeCanvasTexture(THREE, key, { w: 256, h: 128 }, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // Spray base
    const grd = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    grd.addColorStop(0, rgbStr(c, 0.95));
    grd.addColorStop(1, rgbStr(c, 0));
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    // Tag glyphs
    ctx.font = 'bold 72px "Impact","Arial Black",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rgbStr(c, 1);
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    const tags = ['XKILL', '666', 'GANTZ', 'XYZ', 'KBKCH', 'NOIR'];
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(((seed * 17) % 13 - 6) * 0.02);
    ctx.fillText(tags[seed % tags.length], 0, 0);
    ctx.restore();
  });
}

// Asphalt with cracks + oil stains.
function makeAsphaltTexture(THREE) {
  return makeCanvasTexture(THREE, 'asphalt', { w: 512, h: 512 }, (ctx, w, h) => {
    ctx.fillStyle = '#1c1c24'; ctx.fillRect(0, 0, w, h);
    // Speckle
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() * 30 - 15) | 0;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i] + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n));
    }
    ctx.putImageData(img, 0, 0);
    // Cracks
    ctx.strokeStyle = '#0a0a0e'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 20; i++) {
      ctx.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (Math.random() - 0.5) * 60;
        y += (Math.random() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Oil stains
    for (let i = 0; i < 6; i++) {
      const cx = Math.random() * w, cy = Math.random() * h;
      const r = 20 + Math.random() * 40;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, 'rgba(8,8,12,0.7)');
      grd.addColorStop(1, 'rgba(8,8,12,0)');
      ctx.fillStyle = grd; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  });
}

function makeSidewalkTexture(THREE) {
  return makeCanvasTexture(THREE, 'sidewalk_v2', { w: 512, h: 512 }, (ctx, w, h) => {
    const TILE = 64, JOINT = 2;
    // Seeded LCG so the pattern is deterministic
    let rng = 0x3a7c1f;
    const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };

    // Draw each tile with per-tile color variation and optional stain
    for (let ty = 0; ty * TILE < h; ty++) {
      for (let tx = 0; tx * TILE < w; tx++) {
        const px = tx * TILE + JOINT;
        const py = ty * TILE + JOINT;
        const tw = TILE - JOINT * 2;
        const th = TILE - JOINT * 2;
        const v = (rand() * 28 - 14) | 0;
        const r = Math.max(0, Math.min(255, 0x3a + v));
        const g2 = Math.max(0, Math.min(255, 0x37 + v - 2));
        const b = Math.max(0, Math.min(255, 0x33 + v - 4));
        ctx.fillStyle = `rgb(${r},${g2},${b})`;
        ctx.fillRect(px, py, tw, th);
        // Dark stain on ~14% of tiles
        if (rand() < 0.14) {
          const sx = px + tw * (0.2 + rand() * 0.6);
          const sy = py + th * (0.2 + rand() * 0.6);
          const sr = 5 + rand() * 14;
          const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
          grd.addColorStop(0, 'rgba(10,8,6,0.55)');
          grd.addColorStop(1, 'rgba(10,8,6,0)');
          ctx.fillStyle = grd;
          ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
        }
        // Hairline crack on ~7% of tiles
        if (rand() < 0.07) {
          ctx.strokeStyle = 'rgba(12,10,8,0.5)';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(px + rand() * tw, py + rand() * th);
          ctx.lineTo(px + rand() * tw, py + rand() * th);
          ctx.stroke();
        }
      }
    }
    // Grout lines drawn over tiles
    ctx.strokeStyle = '#1a1714';
    ctx.lineWidth = JOINT;
    for (let x = 0; x <= w; x += TILE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  });
}

// Raked gravel for shrine courtyards.
function makeShrineGravelTexture(THREE) {
  return makeCanvasTexture(THREE, 'shrineGravel', { w: 512, h: 512 }, (ctx, w, h) => {
    ctx.fillStyle = '#3c3a30'; ctx.fillRect(0, 0, w, h);
    let rng = 0xb4c2d1;
    const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
    // Dense gravel speckle
    for (let i = 0; i < 9000; i++) {
      const x = rand() * w, y = rand() * h;
      const r = 0.5 + rand() * 1.8;
      const v = (rand() * 50 - 20) | 0;
      const c = Math.max(0, Math.min(255, 0x48 + v));
      ctx.fillStyle = `rgb(${c},${c - 4},${c - 10})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Raked lines — horizontal with subtle waviness
    ctx.strokeStyle = 'rgba(18,16,10,0.28)';
    ctx.lineWidth = 1;
    for (let y = 10; y < h; y += 14) {
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.05) * 2.5);
      ctx.stroke();
    }
    // A few larger pebbles
    for (let i = 0; i < 120; i++) {
      const x = rand() * w, y = rand() * h;
      const rx = 2 + rand() * 4, ry = 1.5 + rand() * 3;
      const v = (rand() * 30 - 10) | 0;
      const c = Math.max(0, Math.min(255, 0x50 + v));
      ctx.fillStyle = `rgb(${c},${c - 3},${c - 8})`;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// Dark cracked concrete for back alleys — grimier than sidewalk.
function makeAlleyTexture(THREE) {
  return makeCanvasTexture(THREE, 'alley', { w: 512, h: 512 }, (ctx, w, h) => {
    ctx.fillStyle = '#1e1e22'; ctx.fillRect(0, 0, w, h);
    let rng = 0x9f2a4b;
    const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
    // Pixel-level noise
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() * 22 - 8) | 0;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i] + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n - 2));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n + 3));
    }
    ctx.putImageData(img, 0, 0);
    // Heavy cracks
    ctx.strokeStyle = '#0c0c10'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      let x = rand() * w, y = rand() * h;
      ctx.moveTo(x, y);
      for (let s = 0; s < 7; s++) { x += (rand() - 0.5) * 90; y += (rand() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // Water-stain streaks (vertical dark drips)
    for (let i = 0; i < 10; i++) {
      const sx = rand() * w, sy = rand() * h * 0.6, sh = 50 + rand() * 100;
      const grd = ctx.createLinearGradient(sx, sy, sx + 6, sy + sh);
      grd.addColorStop(0, 'rgba(6,8,12,0)');
      grd.addColorStop(0.3, 'rgba(6,8,12,0.55)');
      grd.addColorStop(1, 'rgba(6,8,12,0)');
      ctx.fillStyle = grd; ctx.fillRect(sx - 4, sy, 14, sh);
    }
    // Oil patches
    for (let i = 0; i < 5; i++) {
      const cx = rand() * w, cy = rand() * h, r = 18 + rand() * 35;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, 'rgba(6,6,10,0.82)');
      grd.addColorStop(1, 'rgba(6,6,10,0)');
      ctx.fillStyle = grd; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  });
}

// Large slate-style stone slabs for plazas and forecourts.
function makePlazaStoneTexture(THREE) {
  return makeCanvasTexture(THREE, 'plazaStone', { w: 512, h: 512 }, (ctx, w, h) => {
    const TILE_W = 128, TILE_H = 64, JOINT = 2;
    let rng = 0xd7a34c;
    const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
    for (let ty = 0; ty * TILE_H < h; ty++) {
      // Offset odd rows for a running-bond pattern
      const offsetX = (ty % 2) ? TILE_W / 2 : 0;
      for (let tx = -1; tx * TILE_W < w + TILE_W; tx++) {
        const px = tx * TILE_W + offsetX + JOINT;
        const py = ty * TILE_H + JOINT;
        const tw = TILE_W - JOINT * 2;
        const th = TILE_H - JOINT * 2;
        const v = (rand() * 22 - 11) | 0;
        const r = Math.max(0, Math.min(255, 0x30 + v));
        const g2 = Math.max(0, Math.min(255, 0x30 + v - 1));
        const b = Math.max(0, Math.min(255, 0x33 + v + 2));
        ctx.fillStyle = `rgb(${r},${g2},${b})`;
        ctx.fillRect(px, py, tw, th);
        // Subtle vein lines on some slabs
        if (rand() < 0.3) {
          ctx.strokeStyle = `rgba(${r - 8},${g2 - 8},${b + 6},0.35)`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(px + rand() * tw, py);
          ctx.quadraticCurveTo(px + rand() * tw, py + th / 2, px + rand() * tw, py + th);
          ctx.stroke();
        }
        // Edge wear darkening
        const grd = ctx.createRadialGradient(px + tw / 2, py + th / 2, tw * 0.3, px + tw / 2, py + th / 2, tw * 0.8);
        grd.addColorStop(0, 'rgba(0,0,0,0)');
        grd.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.fillStyle = grd; ctx.fillRect(px, py, tw, th);
      }
    }
    // Grout lines
    ctx.strokeStyle = '#191818'; ctx.lineWidth = JOINT;
    for (let ty = 0; ty * TILE_H <= h; ty++) {
      const offsetX = (ty % 2) ? TILE_W / 2 : 0;
      ctx.beginPath(); ctx.moveTo(0, ty * TILE_H); ctx.lineTo(w, ty * TILE_H); ctx.stroke();
      for (let tx = -1; tx * TILE_W < w + TILE_W; tx++) {
        const x = tx * TILE_W + offsetX;
        ctx.beginPath(); ctx.moveTo(x, ty * TILE_H); ctx.lineTo(x, (ty + 1) * TILE_H); ctx.stroke();
      }
    }
  });
}

// Warm brick-red running-bond pavers — Japanese shopping-district feel.
function makeWarmPaverTexture(THREE) {
  return makeCanvasTexture(THREE, 'warmPaver', { w: 512, h: 512 }, (ctx, w, h) => {
    const TW = 128, TH = 64, JOINT = 2;
    let rng = 0x6f3a21;
    const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
    for (let ty = 0; ty * TH < h; ty++) {
      const offX = (ty % 2) ? TW / 2 : 0;
      for (let tx = -1; tx * TW < w + TW; tx++) {
        const px = tx * TW + offX + JOINT, py = ty * TH + JOINT;
        const tw = TW - JOINT * 2, th = TH - JOINT * 2;
        const v = (rand() * 32 - 16) | 0;
        const r = Math.max(0, Math.min(255, 0x52 + v));
        const g2 = Math.max(0, Math.min(255, 0x2c + (v * 0.55) | 0));
        const b = Math.max(0, Math.min(255, 0x20 + (v * 0.4) | 0));
        ctx.fillStyle = `rgb(${r},${g2},${b})`;
        ctx.fillRect(px, py, tw, th);
        // UV-bleached highlight on some bricks
        if (rand() < 0.18) {
          ctx.fillStyle = 'rgba(255,190,130,0.09)';
          ctx.fillRect(px + tw * 0.15, py + th * 0.15, tw * 0.7, th * 0.7);
        }
        // Edge-wear gradient
        const grd = ctx.createLinearGradient(px, py, px, py + th);
        grd.addColorStop(0, 'rgba(0,0,0,0.12)');
        grd.addColorStop(0.5, 'rgba(0,0,0,0)');
        grd.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = grd; ctx.fillRect(px, py, tw, th);
        // Dark stain
        if (rand() < 0.10) {
          const sr = 5 + rand() * 10;
          const sx = px + tw * (0.2 + rand() * 0.6), sy = py + th * (0.2 + rand() * 0.6);
          const sgrd = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
          sgrd.addColorStop(0, 'rgba(8,5,3,0.6)'); sgrd.addColorStop(1, 'rgba(8,5,3,0)');
          ctx.fillStyle = sgrd; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
        }
      }
    }
    ctx.strokeStyle = '#181008'; ctx.lineWidth = JOINT;
    for (let ty = 0; ty * TH <= h; ty++) {
      const offX = (ty % 2) ? TW / 2 : 0;
      ctx.beginPath(); ctx.moveTo(0, ty * TH); ctx.lineTo(w, ty * TH); ctx.stroke();
      for (let tx = -1; tx * TW < w + TW; tx++) {
        const x = tx * TW + offX;
        ctx.beginPath(); ctx.moveTo(x, ty * TH); ctx.lineTo(x, (ty + 1) * TH); ctx.stroke();
      }
    }
  });
}

// Warm beige/cream square pavers — brighter, sandstone-like.
function makeBeigePaverTexture(THREE) {
  return makeCanvasTexture(THREE, 'beigePaver', { w: 512, h: 512 }, (ctx, w, h) => {
    const TILE = 80, JOINT = 2;
    let rng = 0x4ab2c8;
    const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
    for (let ty = 0; ty * TILE < h; ty++) {
      for (let tx = 0; tx * TILE < w; tx++) {
        const px = tx * TILE + JOINT, py = ty * TILE + JOINT;
        const tw = TILE - JOINT * 2, th = TILE - JOINT * 2;
        const v = (rand() * 26 - 13) | 0;
        const r = Math.max(0, Math.min(255, 0x58 + v));
        const g2 = Math.max(0, Math.min(255, 0x52 + v - 2));
        const b = Math.max(0, Math.min(255, 0x44 + v - 6));
        ctx.fillStyle = `rgb(${r},${g2},${b})`;
        ctx.fillRect(px, py, tw, th);
        if (rand() < 0.11) {
          const sr = 5 + rand() * 13;
          const sx = px + tw * (0.2 + rand() * 0.6), sy = py + th * (0.2 + rand() * 0.6);
          const sgrd = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
          sgrd.addColorStop(0, 'rgba(12,9,6,0.48)'); sgrd.addColorStop(1, 'rgba(12,9,6,0)');
          ctx.fillStyle = sgrd; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
        }
      }
    }
    ctx.strokeStyle = '#1e1a15'; ctx.lineWidth = JOINT;
    for (let x = 0; x <= w; x += TILE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  });
}

// Skybox face renderer — simulates a Tokyo night with city silhouette + stars +
// glowing horizon haze + moon.  Used on a large inverted cube around the level.
function makeSkyTexture(THREE, face /* px, nx, py, ny, pz, nz */) {
  return makeCanvasTexture(THREE, `sky_${face}`, { w: 1024, h: 1024 }, (ctx, w, h) => {
    // Horizon target: silhouette base sits at canvas y = h * HORIZON, which on the
    // cube face maps to world y = (cube center) so it appears at eye-level.
    const HORIZON = 0.50;
    // Vertical gradient — top = deep navy, around horizon = neon haze, below = darker
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    if (face === 'py') {
      // Top — deep navy almost black
      grd.addColorStop(0, '#03040a');
      grd.addColorStop(1, '#0a0e1c');
    } else if (face === 'ny') {
      // Bottom — dark with hint of city glow at the very top edge
      grd.addColorStop(0, '#0a0508');
      grd.addColorStop(0.4, '#06080f');
      grd.addColorStop(1, '#000000');
    } else {
      grd.addColorStop(0.00, '#03040a');
      grd.addColorStop(0.30, '#0a1428');
      grd.addColorStop(0.45, '#1a2545');
      grd.addColorStop(HORIZON, '#321a3a');
      grd.addColorStop(0.55, '#1a0820');
      grd.addColorStop(1.00, '#000000');
    }
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    if (face !== 'py' && face !== 'ny') {
      // Distant city silhouette along horizon — bases at h * HORIZON, growing upward
      const silY = h * HORIZON;
      ctx.fillStyle = '#000007';
      let x = 0;
      while (x < w) {
        const bw = 8 + Math.random() * 38;
        const bh = 30 + Math.random() * 110;
        ctx.fillRect(x, silY - bh, bw, bh + 12);
        // a few lit windows
        const winCount = Math.floor(bh / 12);
        for (let i = 0; i < winCount; i++) {
          if (Math.random() < 0.25) {
            ctx.fillStyle = Math.random() < 0.5 ? '#ffd680' : '#80c8ff';
            const wx = x + 2 + Math.random() * (bw - 4);
            const wy = silY - bh + 3 + i * 12;
            ctx.fillRect(wx, wy, 2, 2);
            ctx.fillStyle = '#000007';
          }
        }
        x += bw + 1;
      }
      // A second, taller / dimmer silhouette layer behind
      ctx.fillStyle = '#040516';
      x = 0;
      while (x < w) {
        const bw = 14 + Math.random() * 60;
        const bh = 60 + Math.random() * 200;
        ctx.fillRect(x, silY - bh - 4, bw, bh);
        x += bw + 18 + Math.random() * 30;
      }
      // Re-draw front silhouette over the back one to ensure clean foreground
      // (just a thin sliver at the base)
      ctx.fillStyle = '#000007';
      ctx.fillRect(0, silY - 4, w, 16);
      // Neon city glow centered on horizon
      const hgrd = ctx.createLinearGradient(0, h * (HORIZON - 0.08), 0, h * (HORIZON + 0.10));
      hgrd.addColorStop(0, 'rgba(80, 40, 120, 0)');
      hgrd.addColorStop(0.45, 'rgba(180, 60, 140, 0.32)');
      hgrd.addColorStop(0.6, 'rgba(255, 80, 160, 0.18)');
      hgrd.addColorStop(1, 'rgba(255, 80, 160, 0)');
      ctx.fillStyle = hgrd;
      ctx.fillRect(0, h * (HORIZON - 0.08), w, h * 0.18);
    }
    // Stars (only above horizon + py)
    if (face !== 'ny') {
      const starCount = face === 'py' ? 600 : 320;
      for (let i = 0; i < starCount; i++) {
        const sx = Math.random() * w;
        const sy = (face === 'py') ? Math.random() * h : Math.random() * h * (HORIZON - 0.04);
        const a = 0.4 + Math.random() * 0.6;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(sx, sy, 1, 1);
      }
    }
    // Moon on +Z face — well above horizon
    if (face === 'pz') {
      const cx = w * 0.7, cy = h * 0.18, r = 38;
      const mg = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.5);
      mg.addColorStop(0, 'rgba(255, 240, 220, 1)');
      mg.addColorStop(0.5, 'rgba(255, 220, 200, 0.18)');
      mg.addColorStop(1, 'rgba(255, 220, 200, 0)');
      ctx.fillStyle = mg; ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff5e6'; ctx.fill();
    }
  });
}

// Procedural facade texture — windows + mortar + panels for tall walls.
function makeFacadeTexture(THREE, key, baseColor, neonHint) {
  return makeCanvasTexture(THREE, `facade|${key}|${baseColor}|${neonHint}`, { w: 512, h: 512 }, (ctx, w, h) => {
    const baseR = (baseColor >> 16) & 0xff;
    const baseG = (baseColor >> 8) & 0xff;
    const baseB = baseColor & 0xff;
    const baseStr = `rgb(${baseR},${baseG},${baseB})`;
    ctx.fillStyle = baseStr; ctx.fillRect(0, 0, w, h);
    // Subtle vertical panel lines
    ctx.strokeStyle = `rgba(0,0,0,0.45)`;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    // Window strips: 8 floors, 8 windows each
    const FLOORS = 8;
    const WINS_PER_ROW = 8;
    const winW = w / WINS_PER_ROW;
    const winH = h / FLOORS;
    for (let f = 0; f < FLOORS; f++) {
      for (let i = 0; i < WINS_PER_ROW; i++) {
        const x = i * winW;
        const y = f * winH;
        // Window frame
        const wx = x + winW * 0.18, wy = y + winH * 0.22;
        const ww = winW * 0.64, wh = winH * 0.55;
        // Random lit / dark
        const rand = (Math.sin((f + 1) * 13.37 + (i + 1) * 7.31 + neonHint) + 1) * 0.5;
        const lit = rand > 0.55;
        if (lit) {
          // warm interior
          const warm = rand > 0.85 ? '#ffd078' : '#a8b0d0';
          ctx.fillStyle = warm;
          ctx.fillRect(wx, wy, ww, wh);
          // gentle glow
          const grd = ctx.createRadialGradient(wx + ww / 2, wy + wh / 2, 1, wx + ww / 2, wy + wh / 2, ww);
          grd.addColorStop(0, 'rgba(255,220,150,0.25)');
          grd.addColorStop(1, 'rgba(255,220,150,0)');
          ctx.fillStyle = grd;
          ctx.fillRect(wx - ww * 0.5, wy - wh * 0.5, ww * 2, wh * 2);
        } else {
          ctx.fillStyle = '#0a0d18';
          ctx.fillRect(wx, wy, ww, wh);
        }
        // Sash divider
        ctx.fillStyle = 'rgba(20,20,28,0.7)';
        ctx.fillRect(wx + ww / 2 - 0.5, wy, 1, wh);
        // Window frame lines
        ctx.strokeStyle = 'rgba(15,15,20,0.85)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(wx, wy, ww, wh);
      }
      // Floor mortar band
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, (f + 1) * winH); ctx.lineTo(w, (f + 1) * winH); ctx.stroke();
    }
    // Faint dirt streaks
    for (let i = 0; i < 18; i++) {
      const sx = Math.random() * w;
      const grd = ctx.createLinearGradient(sx, 0, sx, h);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = grd;
      ctx.fillRect(sx, 0, 6, h);
    }
  });
}

// Decorate a building's rooftop with HVAC, water tanks, antennas, etc.
function decorateRooftop(THREE, b, group, colliders, opts = {}) {
  // Deterministic RNG seeded from building id
  let seed = 0;
  const id = b.id || 'unknown';
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) / 4294967296); };
  const roofY = b.h + 0.32;
  // Local coords: building group is centered at (b.x, 0, b.z); rooftop props
  // are placed in local space (so x,z relative to center), within (±w/2 - 1, ±d/2 - 1).
  const halfW = b.w / 2 - 1.2;
  const halfD = b.d / 2 - 1.2;
  if (halfW < 0.5 || halfD < 0.5) return; // too small to decorate
  const footArea = b.w * b.d;
  const propCount = Math.min(10, Math.max(3, Math.floor(footArea / 32) + 2));
  // Track placed boxes (in local coords) to avoid overlap
  const placed = [];
  const fits = (x, z, w, d) => {
    if (Math.abs(x) > halfW - w / 2) return false;
    if (Math.abs(z) > halfD - d / 2) return false;
    for (const p of placed) {
      if (Math.abs(x - p.x) < (w + p.w) / 2 + 0.2 &&
          Math.abs(z - p.z) < (d + p.d) / 2 + 0.2) return false;
    }
    return true;
  };
  const tryPlace = (w, d, build) => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const x = (rng() * 2 - 1) * halfW;
      const z = (rng() * 2 - 1) * halfD;
      if (fits(x, z, w, d)) {
        placed.push({ x, z, w, d });
        build(x, z);
        return true;
      }
    }
    return false;
  };

  // Always: low parapet rim already handled in some builders; add a slim rim
  // marker if not midrise (midrise has its own parapet).
  // 1. AC condensers
  const acCount = 1 + Math.floor(rng() * 3);
  const acMat = mat(THREE, 0x7a7a82, { roughness: 0.6, metalness: 0.3 });
  const fanMat = mat(THREE, 0x202024, { roughness: 0.5, metalness: 0.5 });
  for (let i = 0; i < acCount; i++) {
    tryPlace(1.4, 1.0, (x, z) => {
      const body = box(THREE, 1.4, 0.7, 1.0, acMat);
      body.position.set(x, roofY + 0.35, z);
      group.add(body);
      const grille = box(THREE, 1.42, 0.5, 0.05, fanMat);
      grille.position.set(x, roofY + 0.35, z + 0.5);
      group.add(grille);
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 1.42, 1.05, {
        tier: 'hard', category: 'solid', tag: `${b.id}_roof_ac`,
        minY: roofY, maxY: roofY + 0.7, jumpable: true,
      });
    });
  }
  // 2. Water tanks
  const tankCount = footArea > 200 ? 1 + Math.floor(rng() * 2) : (rng() < 0.6 ? 1 : 0);
  const tankMat = mat(THREE, 0x4a4a52, { roughness: 0.7, metalness: 0.4 });
  const standMat = mat(THREE, 0x222226, { roughness: 0.8 });
  for (let i = 0; i < tankCount; i++) {
    tryPlace(2.4, 2.4, (x, z) => {
      // legs (4)
      for (const lx of [-0.8, 0.8]) for (const lz of [-0.8, 0.8]) {
        const leg = box(THREE, 0.1, 1.0, 0.1, standMat);
        leg.position.set(x + lx, roofY + 0.5, z + lz);
        group.add(leg);
      }
      const tank = cyl(THREE, 1.05, 1.05, 1.6, tankMat, 14);
      tank.position.set(x, roofY + 1.8, z);
      group.add(tank);
      const cap = cyl(THREE, 1.07, 1.07, 0.15, tankMat, 14);
      cap.position.set(x, roofY + 2.65, z);
      group.add(cap);
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 2.2, 2.2, {
        tier: 'hard', category: 'solid', tag: `${b.id}_roof_tank`,
        minY: roofY, maxY: roofY + 2.75, jumpable: false,
      });
    });
  }
  // 3. Vent stacks (cylindrical pipes) + exhaust fans
  const ventCount = 1 + Math.floor(rng() * 3);
  const ventMat = mat(THREE, 0x8a8a92, { roughness: 0.55, metalness: 0.55 });
  for (let i = 0; i < ventCount; i++) {
    tryPlace(0.7, 0.7, (x, z) => {
      const ventH = 0.6 + rng() * 1.1;
      const v = cyl(THREE, 0.22, 0.25, ventH, ventMat, 10);
      v.position.set(x, roofY + ventH / 2, z);
      group.add(v);
      const cap = cyl(THREE, 0.30, 0.30, 0.10, ventMat, 10);
      cap.position.set(x, roofY + ventH + 0.05, z);
      group.add(cap);
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 0.6, 0.6, {
        tier: 'hard', category: 'solid', tag: `${b.id}_roof_vent`,
        minY: roofY, maxY: roofY + ventH + 0.1, jumpable: ventH < 1.0,
      });
    });
  }
  // Exhaust fan with cage
  if (footArea > 100 && rng() < 0.7) {
    tryPlace(1.2, 1.2, (x, z) => {
      const housing = box(THREE, 1.0, 0.6, 1.0, acMat);
      housing.position.set(x, roofY + 0.3, z);
      group.add(housing);
      const fan = cyl(THREE, 0.4, 0.4, 0.08, fanMat, 12);
      fan.position.set(x, roofY + 0.65, z);
      group.add(fan);
      const cage = cyl(THREE, 0.45, 0.45, 0.15, mat(THREE, 0x303034, { roughness: 0.5, metalness: 0.5 }), 12);
      cage.position.set(x, roofY + 0.7, z);
      group.add(cage);
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 1.05, 1.05, {
        tier: 'hard', category: 'solid', tag: `${b.id}_roof_fan`,
        minY: roofY, maxY: roofY + 0.8, jumpable: true,
      });
    });
  }
  // 4. Antennas / satellite dishes
  const antCount = (b.h >= 20) ? 1 + Math.floor(rng() * 2) : (rng() < 0.55 ? 1 : 0);
  const antMat = mat(THREE, 0x202024, { roughness: 0.6, metalness: 0.5 });
  for (let i = 0; i < antCount; i++) {
    tryPlace(0.4, 0.4, (x, z) => {
      const tall = b.h >= 20;
      const antH = tall ? 2.4 + rng() * 2.0 : 1.2 + rng() * 0.8;
      const ant = cyl(THREE, 0.04, 0.06, antH, antMat, 6);
      ant.position.set(x, roofY + antH / 2, z);
      group.add(ant);
      // Cross-bars
      for (let cb = 0; cb < 3; cb++) {
        const cbY = roofY + antH * (0.4 + cb * 0.18);
        const bar = box(THREE, 0.5 - cb * 0.1, 0.04, 0.04, antMat);
        bar.position.set(x, cbY, z);
        group.add(bar);
      }
      // Tip blink for tall buildings
      if (tall) {
        const tip = box(THREE, 0.14, 0.14, 0.14, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 4 }));
        tip.position.set(x, roofY + antH + 0.07, z);
        tip.userData.blinkPhase = rng() * Math.PI * 2;
        if (opts.animatedOut) {
          opts.animatedOut.push({ kind: 'antennaBlink', target: tip, seed: tip.userData.blinkPhase });
        }
        group.add(tip);
      }
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 0.5, 0.5, {
        tier: 'prone', category: 'cover', tag: `${b.id}_roof_ant`,
        minY: roofY, maxY: roofY + antH, jumpable: false,
      });
    });
  }
  // 5. Satellite dish
  if (rng() < 0.6) {
    tryPlace(1.4, 1.4, (x, z) => {
      const post = cyl(THREE, 0.05, 0.07, 0.6, antMat, 8);
      post.position.set(x, roofY + 0.3, z);
      group.add(post);
      const dishMat = mat(THREE, 0xd0d0d0, { roughness: 0.5, metalness: 0.4 });
      const dish = cyl(THREE, 0.55, 0.7, 0.08, dishMat, 16);
      dish.rotation.x = -0.4;
      dish.position.set(x, roofY + 0.6, z);
      group.add(dish);
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 1.4, 1.4, {
        tier: 'hard', category: 'solid', tag: `${b.id}_roof_dish`,
        minY: roofY, maxY: roofY + 0.9, jumpable: true,
      });
    });
  }
  // 6. Access hatch
  if (rng() < 0.7) {
    tryPlace(1.0, 1.0, (x, z) => {
      const hatchBody = box(THREE, 0.95, 0.18, 0.95, mat(THREE, 0x3a3a3e, { roughness: 0.7, metalness: 0.3 }));
      hatchBody.position.set(x, roofY + 0.09, z);
      group.add(hatchBody);
      const lid = box(THREE, 0.85, 0.06, 0.85, mat(THREE, 0x504030, { roughness: 0.6 }));
      lid.position.set(x, roofY + 0.20, z);
      group.add(lid);
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 0.95, 0.95, {
        tier: 'prone', category: 'cover', tag: `${b.id}_roof_hatch`,
        minY: roofY, maxY: roofY + 0.25, jumpable: true,
      });
    });
  }
  // 7. Cable runs (small box on ground sweeping a short distance)
  if (rng() < 0.7 && placed.length >= 2) {
    const a = placed[Math.floor(rng() * placed.length)];
    const b2 = placed[Math.floor(rng() * placed.length)];
    if (a !== b2) {
      const dx = b2.x - a.x, dz = b2.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.5 && len < 8) {
        const cable = box(THREE, len, 0.06, 0.06, mat(THREE, 0x18181c, { roughness: 0.8 }));
        cable.position.set((a.x + b2.x) / 2, roofY + 0.05, (a.z + b2.z) / 2);
        cable.rotation.y = -Math.atan2(dz, dx);
        group.add(cable);
      }
    }
  }
  // 8. Mini billboard sign for tall buildings
  if (b.h >= 28 && rng() < 0.8) {
    tryPlace(2.4, 0.4, (x, z) => {
      const post1 = box(THREE, 0.12, 1.4, 0.12, antMat);
      post1.position.set(x - 0.9, roofY + 0.7, z);
      group.add(post1);
      const post2 = box(THREE, 0.12, 1.4, 0.12, antMat);
      post2.position.set(x + 0.9, roofY + 0.7, z);
      group.add(post2);
      const panel = box(THREE, 2.0, 0.9, 0.08, mat(THREE, b.neon ?? NEON.cyan, { emissive: b.neon ?? NEON.cyan, emissiveIntensity: 1.6 }));
      panel.position.set(x, roofY + 1.2, z);
      group.add(panel);
      if (colliders) pushAABB(colliders, b.x + x, b.z + z, 2.4, 0.4, {
        tier: 'hard', category: 'solid', tag: `${b.id}_roof_billboard`,
        minY: roofY, maxY: roofY + 1.7, jumpable: false,
      });
    });
  }
}

// Build a horizontal connector beam between two rooftop points (with guard rails).
function buildRooftopBeam(THREE, from, to, parent, colliders) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const cx = (from.x + to.x) / 2;
  const cz = (from.z + to.z) / 2;
  const cy = (from.y + to.y) / 2;
  const ang = Math.atan2(dz, dx);
  const g = new THREE.Group();
  g.name = 'rooftopBeam';
  g.position.set(cx, cy, cz);
  g.rotation.y = -ang;
  parent.add(g);
  const W = 1.6;
  const beamMat = mat(THREE, 0x4a4a4e, { metalness: 0.5, roughness: 0.6 });
  const plankMat = mat(THREE, BLDG.wood, { roughness: 0.95 });
  // Beam structure: pair of I-beams + plank surface
  const ib1 = box(THREE, len, 0.18, 0.14, beamMat);
  ib1.position.set(0, -0.05, -W / 2 + 0.07);
  g.add(ib1);
  const ib2 = box(THREE, len, 0.18, 0.14, beamMat);
  ib2.position.set(0, -0.05, W / 2 - 0.07);
  g.add(ib2);
  const surface = box(THREE, len, 0.06, W, plankMat);
  surface.position.set(0, 0.06, 0);
  g.add(surface);
  // Guard rails on both sides
  const railMat = mat(THREE, 0x2a2a2e, { metalness: 0.6, roughness: 0.4 });
  for (const side of [-1, 1]) {
    // Top rail
    const top = box(THREE, len, 0.04, 0.04, railMat);
    top.position.set(0, 1.0, side * (W / 2 - 0.05));
    g.add(top);
    // Mid rail
    const mid = box(THREE, len, 0.03, 0.03, railMat);
    mid.position.set(0, 0.6, side * (W / 2 - 0.05));
    g.add(mid);
    // Posts
    const postCount = Math.max(2, Math.ceil(len / 2));
    for (let i = 0; i <= postCount; i++) {
      const t = (i / postCount) - 0.5;
      const post = box(THREE, 0.06, 1.0, 0.06, railMat);
      post.position.set(t * len, 0.5, side * (W / 2 - 0.05));
      g.add(post);
    }
  }
  // Split into short segments along the beam path so each axis-aligned AABB
  // hugs the beam tightly instead of enclosing the whole diagonal span.
  const SEG_LEN = 1.5;
  const segCount = Math.max(1, Math.ceil(len / SEG_LEN));
  const segLen = len / segCount;
  for (let i = 0; i < segCount; i++) {
    const t = (i + 0.5) / segCount - 0.5; // -0.5..0.5
    pushRotatedAABB(colliders, cx, cz, segLen, W, ang, {
      ox: t * len, oz: 0,
      tier: 'prone', tag: 'rooftopBeam',
      minY: cy - 0.1, maxY: cy + 1.1,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Collider system — see memory/project_collision_spec.md
//
// Every static collider declares:
//   { type, category, bounds:{min,max}, jumpable, requires_crouch, tags }
// Categories: solid | cover | destructible | trigger | passthrough | climbable
//
// Legacy 2D-style fields ({ kind:'aabb', x, y(z), w, h(d), tier, minY, maxY, tag })
// are emitted alongside the new fields so existing 2D collision code (game.js +
// src/engine/collision.js) still works while gameplay/AI/bullet logic that wants
// the spec format can read .category/.bounds/.jumpable/.requires_crouch directly.
// ─────────────────────────────────────────────────────────────────────────────

const TIER_TO_CATEGORY = { hard: 'solid', prone: 'cover' };
const COLLIDER_WARNINGS = [];

// Tag-based category overrides for cases that can't be derived from tier alone.
// Anything not listed here falls back to TIER_TO_CATEGORY[tier].
const TAG_CATEGORY = {
  pachinkoMachine:  'destructible',
  shojiPanel:       'destructible',
  cardboard:        'destructible',
  crates:           'destructible',
  // ladder_<bldgId> tags are matched by prefix below
  manhole:          'trigger',
  shrineThreshold:  'trigger',
  phoneBoothEnter:  'trigger',
};

function categoryFor(tier, tag, override) {
  if (override) return override;
  if (tag) {
    if (tag.startsWith('ladder_')) return 'climbable';
    if (TAG_CATEGORY[tag]) return TAG_CATEGORY[tag];
  }
  return TIER_TO_CATEGORY[tier] ?? 'solid';
}

// Default jumpability heuristic: ground-level colliders ≤1.3u tall are jumpable
// (player jump apex ≈1.2u). Floating/rooftop/wall colliders are not jumpable
// unless explicitly flagged.
function defaultJumpable(category, minY, maxY) {
  if (category === 'passthrough' || category === 'trigger' || category === 'climbable') return false;
  if (minY > 0.05) return false;       // floating obstacle — don't auto-jump it
  return (maxY - minY) <= 1.3;
}

// Push an AABB collider onto the array.
//
// Legacy signature: pushAABB(colliders, cx, cz, w, d, { tier, minY, maxY, tag })
// New optional opts:  { category, jumpable, requires_crouch, tags, walkUnder }
//   walkUnder=true marks an elevated collider that the player is *meant* to walk
//   under — triggers a console warning if min.y < 2.0 (likely a bug per spec).
function pushAABB(colliders, x, z, w, d, opts = {}) {
  const tier  = opts.tier ?? 'hard';
  const minY  = opts.minY ?? 0;
  const maxY  = opts.maxY ?? 100;
  const tag   = opts.tag;
  const category = categoryFor(tier, tag, opts.category);
  const jumpable = (opts.jumpable !== undefined) ? opts.jumpable : defaultJumpable(category, minY, maxY);
  const requires_crouch = (opts.requires_crouch !== undefined)
    ? opts.requires_crouch
    : (minY >= 1.4 && minY <= 2.0);

  // Validation: walk-under elevated objects must have min.y ≥ 2.0
  if (opts.walkUnder && minY < 2.0) {
    COLLIDER_WARNINGS.push(
      `[collider] walk-under '${tag ?? '(untagged)'}' has min.y=${minY.toFixed(2)} < 2.0 — player will hit head`
    );
  }

  const tags = opts.tags ?? (tag ? [tag] : []);

  const c = {
    // ── Legacy fields (consumed by existing 2D collision code) ──
    kind: 'aabb',
    x, y: z, w, h: d,
    tier,
    minY, maxY,
    tag,
    // ── Spec fields ──
    type: 'aabb',
    category,
    bounds: {
      min: { x: x - w / 2, y: minY, z: z - d / 2 },
      max: { x: x + w / 2, y: maxY, z: z + d / 2 },
    },
    jumpable,
    requires_crouch,
    tags,
    // ── Editor identity ──
    // Sequential, build-order index — assigned just below. Stable across
    // reloads as long as the build is deterministic, so override JSON
    // entries that target a specific collider keep targeting the right
    // one without us having to embed string ids in the source.
    editorId: colliders.length,
  };
  colliders.push(c);
  return c;
}

// Push an axis-aligned AABB for a prop that's been rotated by `rot` (radians)
// around its local origin. (cx,cz) is world-space center; (w,d) is the local
// box footprint (X-extent, Z-extent). Optional (ox,oz) shifts the local center
// by an offset that's also rotated — useful for sub-parts inside a group.
//
// Returns the proper *enclosing* world AABB so axis-aligned collision still
// fully covers the rotated visual, with no over-broad worst-case fallback.
function pushRotatedAABB(colliders, cx, cz, w, d, rot, opts = {}) {
  const ox = opts.ox ?? 0;
  const oz = opts.oz ?? 0;
  const cs = Math.cos(rot ?? 0);
  const sn = Math.sin(rot ?? 0);
  // Rotate local offset into world frame
  const wx = cx + ox * cs - oz * sn;
  const wz = cz + ox * sn + oz * cs;
  // Enclosing AABB extents for a rotated rectangle
  const ac = Math.abs(cs), asn = Math.abs(sn);
  const ww = w * ac + d * asn;
  const dw = w * asn + d * ac;
  return pushAABB(colliders, wx, wz, ww, dw, opts);
}

// Push a thin underside collider for an elevated horizontal surface.
// Mirror image of the surface footprint, preventing players from jumping up
// through awnings, balconies, fire-escape platforms, plank decks, etc.
function pushUnderside(colliders, cx, cz, w, d, surfaceY, opts = {}) {
  const thickness = opts.thickness ?? 0.08;
  return pushAABB(colliders, cx, cz, w, d, {
    tier: 'hard',
    category: 'solid',
    minY: surfaceY - thickness,
    maxY: surfaceY,
    jumpable: false,
    tag: (opts.tag ?? 'underside'),
    tags: [opts.tag ?? 'underside', 'underside'],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Building builders
// ─────────────────────────────────────────────────────────────────────────────

function buildBuilding(THREE, b, parent, colliders, sharedMats) {
  const g = new THREE.Group();
  g.name = `bldg_${b.id}`;
  g.position.set(b.x, 0, b.z);
  g.rotation.y = b.rot || 0;
  parent.add(g);

  switch (b.type) {
    case 'pachinko':       buildPachinko(THREE, b, g, sharedMats, colliders); break;
    case 'izakaya':        buildIzakaya(THREE, b, g, sharedMats, colliders);  break;
    case 'capsule':        buildCapsule(THREE, b, g, sharedMats, colliders);  break;
    case 'konbini':        buildKonbini(THREE, b, g, sharedMats, colliders);  break;
    case 'love':           buildLoveHotel(THREE, b, g, sharedMats, colliders); break;
    case 'shrine':         buildShrine(THREE, b, g, sharedMats, colliders);         break;
    case 'midrise':        buildMidrise(THREE, b, g, sharedMats, colliders);        break;
    case 'billboardTower': buildBillboardTower(THREE, b, g, sharedMats, colliders); break;
    case 'sento':          buildSento(THREE, b, g, sharedMats, colliders);    break;
    case 'gasStation':     buildGasStation(THREE, b, g, sharedMats);     break;
    case 'parkingGarage':  buildParkingGarage(THREE, b, g, sharedMats);  break;
    case 'koban':          buildKoban(THREE, b, g, sharedMats);          break;
    case 'noodleStand':    buildNoodleStand(THREE, b, g, sharedMats, colliders);    break;
    case 'grandShrine':    buildGrandShrine(THREE, b, g, sharedMats, colliders);    break;
    default:               buildMidrise(THREE, b, g, sharedMats, colliders);
  }

  // Rooftop details for builders that don't go through buildBoxBuilding.
  const nonBoxRoofs = new Set(['konbini', 'koban', 'gasStation', 'parkingGarage']);
  if (nonBoxRoofs.has(b.type)) {
    decorateRooftop(THREE, b, g, colliders, { animatedOut: sharedMats?._animated });
  }

  // Footprint AABB (full-height blocking) — except shrine, noodleStand, grandShrine which are open.
  // Enterable buildings push their own wall colliders inside their builder.
  const openTypes = new Set(['shrine', 'noodleStand', 'grandShrine']);
  if (!openTypes.has(b.type) && !b.enterable) {
    pushAABB(colliders, b.x, b.z, b.w, b.d, { tier: 'hard', tag: b.id, maxY: b.h });
  }
}

function buildBoxBuilding(THREE, b, g, sharedMats, colliders, opts = {}) {
  const facadeColor = opts.facade ?? BLDG.facadeA;
  // Solid flat-color body (no facade texture).
  const facade = mat(THREE, facadeColor, { roughness: 0.95 });
  const m = box(THREE, b.w, b.h, b.d, facade);
  m.position.y = b.h / 2;
  g.add(m);

  // Roof slab (slightly larger than walls — ledge)
  const roof = box(THREE, b.w + 0.4, 0.3, b.d + 0.4, mat(THREE, BLDG.concrete, { roughness: 1 }));
  roof.position.y = b.h + 0.15;
  g.add(roof);

  // Trim band at top (slightly thicker, sits below parapet)
  const trim = box(THREE, b.w + 0.1, 0.4, b.d + 0.1, mat(THREE, BLDG.trim, { roughness: 0.7 }));
  trim.position.y = b.h - 0.2;
  g.add(trim);

  // Geometry-based windows on all four walls.
  if (opts.skipWindows !== true) {
    addWindowGrid(THREE, b, g);
  }

  // Rooftop decoration — HVAC, water tanks, antennas, etc.
  if (opts.skipRooftop !== true) {
    decorateRooftop(THREE, b, g, colliders, { animatedOut: sharedMats?._animated });
  }
}

// Quick deterministic float in [0,1) from a string + index (no external deps).
function _bldgRand(seed, i) {
  let h = 2166136261 >>> 0;
  const s = `${seed}|${i}`;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 100000) / 100000;
}

// Build inset emissive window quads on all 4 walls of an axis-aligned box building.
// opts: { skipDoorWall: 'posZ'|'negZ'|'posX'|'negX', skipBelowY: number,
//         doorWidth: number } — used to skip windows directly above an entrance.
function addWindowGrid(THREE, b, g, opts = {}) {
  const FLOOR_H = 3.0;       // vertical spacing between window rows
  const FLOOR_BASE = 1.6;    // first floor center height
  const WIN_W = 0.7;
  const WIN_H = 1.1;
  const WIN_T = 0.05;        // inset thickness
  const COL_PITCH = 2.0;     // horizontal spacing
  const TOP_MARGIN = 1.4;    // empty space below parapet/roof
  const litWarm = mat(THREE, 0xffd080, { emissive: 0xffd080, emissiveIntensity: 1.4, roughness: 0.6 });
  const litCool = mat(THREE, 0x9fd6ff, { emissive: 0x9fd6ff, emissiveIntensity: 1.2, roughness: 0.6 });
  const dark    = mat(THREE, 0x101418,  { roughness: 0.8 });

  const floors = Math.max(1, Math.floor((b.h - FLOOR_BASE - TOP_MARGIN) / FLOOR_H) + 1);
  const seed = b.id ?? `${b.x}_${b.z}`;
  const skipDoorWall = opts.skipDoorWall;
  const skipBelowY = opts.skipBelowY ?? -1;
  const doorWidth = opts.doorWidth ?? 4.5;

  const faces = [
    { key: 'posZ', axis: 'z', sign:  1, span: b.w, depth: b.d / 2 + WIN_T / 2 - 0.01 },
    { key: 'negZ', axis: 'z', sign: -1, span: b.w, depth: b.d / 2 + WIN_T / 2 - 0.01 },
    { key: 'posX', axis: 'x', sign:  1, span: b.d, depth: b.w / 2 + WIN_T / 2 - 0.01 },
    { key: 'negX', axis: 'x', sign: -1, span: b.d, depth: b.w / 2 + WIN_T / 2 - 0.01 },
  ];

  let idx = 0;
  for (const f of faces) {
    const cols = Math.max(1, Math.floor((f.span - 1.4) / COL_PITCH));
    const usable = cols * COL_PITCH;
    const start = -usable / 2 + COL_PITCH / 2;
    for (let row = 0; row < floors; row++) {
      const y = FLOOR_BASE + row * FLOOR_H;
      if (y + WIN_H / 2 > b.h - TOP_MARGIN + 0.4) break;
      for (let col = 0; col < cols; col++) {
        const r = _bldgRand(seed, idx++);
        const along = start + col * COL_PITCH;
        // Skip windows directly over the doorway on the door wall.
        if (skipDoorWall === f.key && y < skipBelowY && Math.abs(along) < doorWidth / 2 + 0.3) continue;
        // 60% lit (warm-skewed), 40% dark
        let m;
        if (r < 0.4)      m = litWarm;
        else if (r < 0.6) m = litCool;
        else              m = dark;
        const winMesh = (f.axis === 'z')
          ? box(THREE, WIN_W, WIN_H, WIN_T, m)
          : box(THREE, WIN_T, WIN_H, WIN_W, m);
        if (f.axis === 'z') winMesh.position.set(along, y, f.sign * f.depth);
        else                winMesh.position.set(f.sign * f.depth, y, along);
        g.add(winMesh);
      }
    }
  }
}

// Build a hollow box shell (4 walls + floor + ceiling + roof) with a doorway gap
// on one wall. Pushes wall AABB colliders into `colliders`. Returns interior info
// (ceilH) for downstream prop placement. door.wall ∈ 'posZ'|'negZ'|'posX'|'negX'.
// Local coordinates: building origin at (0,0,0); +y up; building rot=0 assumed.
function buildHollowShell(THREE, b, g, colliders, opts = {}) {
  const wallT = 0.3;
  const facadeColor = opts.facade ?? BLDG.facadeA;
  const wallMat = mat(THREE, facadeColor, { roughness: 0.95 });
  const interiorMat = opts.interiorMat ?? mat(THREE, opts.interiorColor ?? 0x1f1d24, { roughness: 0.9 });
  const floorMat = opts.floorMat ?? mat(THREE, opts.floorColor ?? 0x2a2830, { roughness: 0.95 });
  const door = opts.door ?? { wall: 'posZ', width: 3.0, height: 3.0 };
  const dW = door.width;
  const dH = door.height;
  const halfW = b.w / 2, halfD = b.d / 2;
  const ceilH = opts.ceilHeight ?? Math.min(b.h - 0.6, 4.5);

  // Floor slab
  const floor = box(THREE, b.w - 0.05, 0.1, b.d - 0.05, floorMat);
  floor.position.y = 0.05;
  g.add(floor);

  // Ceiling slab (inside, just below the building height)
  const ceil = box(THREE, b.w - wallT * 2 - 0.02, 0.1, b.d - wallT * 2 - 0.02, interiorMat);
  ceil.position.y = ceilH;
  g.add(ceil);

  // Helper to add an outer wall slab with given center + size.
  const addWall = (cx, cz, sx, sz) => {
    const m = box(THREE, sx, b.h, sz, wallMat);
    m.position.set(cx, b.h / 2, cz);
    g.add(m);
    return m;
  };
  // Helper to push a wall AABB collider in world coords from local center+size.
  const pushWallCol = (cx, cz, sx, sz) => {
    pushAABB(colliders, b.x + cx, b.z + cz, sx, sz, { tier: 'hard', tag: b.id, maxY: b.h });
  };
  // Helper to add a wall with door gap: produces two side segments + a lintel above the door.
  const addDoorWall = (axis, sign) => {
    // axis 'x' means wall runs along x (i.e. wall is on +/-Z face); 'z' along z (+/-X face).
    const lintelH = b.h - dH;
    if (axis === 'x') {
      const z = sign * (halfD - wallT / 2);
      const segLen = (b.w - dW) / 2;
      if (segLen > 0.02) {
        addWall(-halfW + segLen / 2, z, segLen, wallT);
        addWall( halfW - segLen / 2, z, segLen, wallT);
        pushWallCol(-halfW + segLen / 2, z, segLen, wallT);
        pushWallCol( halfW - segLen / 2, z, segLen, wallT);
      }
      if (lintelH > 0.05) {
        const lin = box(THREE, dW, lintelH, wallT, wallMat);
        lin.position.set(0, dH + lintelH / 2, z);
        g.add(lin);
      }
    } else {
      const x = sign * (halfW - wallT / 2);
      const segLen = (b.d - dW) / 2;
      if (segLen > 0.02) {
        addWall(x, -halfD + segLen / 2, wallT, segLen);
        addWall(x,  halfD - segLen / 2, wallT, segLen);
        pushWallCol(x, -halfD + segLen / 2, wallT, segLen);
        pushWallCol(x,  halfD - segLen / 2, wallT, segLen);
      }
      if (lintelH > 0.05) {
        const lin = box(THREE, wallT, lintelH, dW, wallMat);
        lin.position.set(x, dH + lintelH / 2, 0);
        g.add(lin);
      }
    }
  };
  // Plain wall (no door): full-span slab + collider.
  const addPlainWall = (axis, sign) => {
    if (axis === 'x') {
      const z = sign * (halfD - wallT / 2);
      addWall(0, z, b.w, wallT);
      pushWallCol(0, z, b.w, wallT);
    } else {
      const x = sign * (halfW - wallT / 2);
      addWall(x, 0, wallT, b.d);
      pushWallCol(x, 0, wallT, b.d);
    }
  };

  // 4 walls — pick door wall.
  // posZ → +z face (axis='x', sign=+1); negZ → -z face (axis='x', sign=-1)
  // posX → +x face (axis='z', sign=+1); negX → -x face (axis='z', sign=-1)
  const W = ['posZ', 'negZ', 'posX', 'negX'];
  for (const w of W) {
    const ax = (w === 'posZ' || w === 'negZ') ? 'x' : 'z';
    const sg = (w === 'posZ' || w === 'posX') ? 1 : -1;
    if (w === door.wall) addDoorWall(ax, sg);
    else                 addPlainWall(ax, sg);
  }

  // Roof slab + trim (matches buildBoxBuilding)
  if (opts.skipRoof !== true) {
    const roof = box(THREE, b.w + 0.4, 0.3, b.d + 0.4, mat(THREE, BLDG.concrete, { roughness: 1 }));
    roof.position.y = b.h + 0.15;
    g.add(roof);
    const trim = box(THREE, b.w + 0.1, 0.4, b.d + 0.1, mat(THREE, BLDG.trim, { roughness: 0.7 }));
    trim.position.y = b.h - 0.2;
    g.add(trim);
    // Roof slab collider — top is walkable, bottom blocks jumping up through
    // from the interior (player on rooftop stands at b.h+0.3; player inside hits
    // the underside before reaching the slab).
    pushAABB(colliders, b.x, b.z, b.w + 0.4, b.d + 0.4, {
      tier: 'hard', category: 'solid', jumpable: false,
      tag: `${b.id}_roof`,
      minY: b.h, maxY: b.h + 0.3,
    });
  }

  // Exterior windows (skip the door wall's lower band).
  if (opts.skipWindows !== true) {
    addWindowGrid(THREE, b, g, { skipDoorWall: door.wall, skipBelowY: dH + 0.2 });
  }

  // Rooftop decorations (HVAC etc.)
  if (opts.skipRooftop !== true) {
    decorateRooftop(THREE, b, g, colliders, { animatedOut: opts.animated });
  }

  // Doorway accent — emissive frame on the inside top edge of the door
  if (opts.doorAccent !== false) {
    const accentColor = opts.doorAccentColor ?? (b.neon ?? NEON.cyan);
    const accentMat = mat(THREE, accentColor, { emissive: accentColor, emissiveIntensity: 1.6 });
    const wKey = door.wall;
    if (wKey === 'posZ' || wKey === 'negZ') {
      const z = (wKey === 'posZ' ? 1 : -1) * (halfD - wallT - 0.02);
      const acc = box(THREE, dW * 0.95, 0.06, 0.04, accentMat);
      acc.position.set(0, dH - 0.05, z);
      g.add(acc);
    } else {
      const x = (wKey === 'posX' ? 1 : -1) * (halfW - wallT - 0.02);
      const acc = box(THREE, 0.04, 0.06, dW * 0.95, accentMat);
      acc.position.set(x, dH - 0.05, 0);
      g.add(acc);
    }
  }

  return { ceilH, wallT, door };
}

function buildPachinko(THREE, b, g, mats, colliders) {
  // Hollow shell with wide front doorway on +Z face
  buildHollowShell(THREE, b, g, colliders, {
    facade: BLDG.facadeB,
    interiorColor: 0x2a1c2a,   // smoky purple ceiling
    floorColor: 0x161018,
    door: { wall: 'posZ', width: 4.5, height: 3.4 },
    doorAccentColor: NEON.yellow,
    animated: mats?._animated,
  });

  // Massive neon storefront sign on south face
  const signGroup = new THREE.Group();
  signGroup.position.set(0, b.h * 0.65, b.d / 2 + 0.3);
  const signBg = box(THREE, b.w * 0.85, b.h * 0.45, 0.25,
    mat(THREE, 0x18181c, { roughness: 0.6 }));
  signGroup.add(signBg);
  const pachinkoTex = makeBillboardTexture(THREE, b.signText ?? 'パチンコ', b.neon);
  const signFace = box(THREE, b.w * 0.78, b.h * 0.38, 0.18,
    new THREE.MeshStandardMaterial({
      color: 0xffffff, map: pachinkoTex,
      emissive: b.neon, emissiveMap: pachinkoTex, emissiveIntensity: 2.0,
      roughness: 0.5, metalness: 0.1,
    }));
  signFace.position.z = 0.16;
  signGroup.add(signFace);
  const accent = box(THREE, b.w * 0.78, 0.4, 0.22,
    mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 3.0 }));
  accent.position.set(0, -b.h * 0.18, 0.18);
  signGroup.add(accent);
  g.add(signGroup);

  // ── Interior ─────────────────────────────────────────────────────────────
  const interior = new THREE.Group();
  interior.name = 'interior';
  g.add(interior);

  // Carpet runner down the centre aisle
  const carpetMat = mat(THREE, 0x4a1228, { roughness: 1 });
  const carpet = box(THREE, 3.0, 0.04, b.d - 1.2, carpetMat);
  carpet.position.set(0, 0.13, 0);
  interior.add(carpet);

  // Pachinko machine cabinets — 4 rows back-to-back, machines facing the centre aisle
  const cabFrame = mat(THREE, 0x2a2228, { roughness: 0.9 });
  const cabPanel = mat(THREE, 0x4a3050, { roughness: 0.7, metalness: 0.2 });
  const screenLit = mat(THREE, NEON.pink, { emissive: NEON.pink, emissiveIntensity: 2.4 });
  const screenBlue = mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 2.0 });
  const trayMat = mat(THREE, 0x808088, { metalness: 0.6, roughness: 0.4 });

  // Helper: one machine, front facing +x (it'll be rotated/positioned by caller)
  const buildMachine = (rng) => {
    const m = new THREE.Group();
    const body = box(THREE, 0.4, 1.7, 0.7, cabFrame);
    body.position.y = 0.85;
    m.add(body);
    const face = box(THREE, 0.06, 1.2, 0.6, cabPanel);
    face.position.set(0.21, 1.0, 0);
    m.add(face);
    const scr = box(THREE, 0.04, 0.55, 0.5, rng > 0.5 ? screenLit : screenBlue);
    scr.position.set(0.24, 1.15, 0);
    m.add(scr);
    // Ball tray at the bottom
    const tray = box(THREE, 0.12, 0.18, 0.55, trayMat);
    tray.position.set(0.28, 0.35, 0);
    m.add(tray);
    return m;
  };

  // 4 banks: 2 on west side facing east aisle, 2 on east side facing west aisle.
  // Each bank has ~6 machines along z.
  const machineSpacing = 0.85;
  const banks = [
    { x: -3.2, faceSign: +1 }, // west bank → faces +x
    { x: -6.0, faceSign: -1 }, // far west bank → faces -x (back-to-back with above)
    { x:  3.2, faceSign: -1 }, // east bank → faces -x
    { x:  6.0, faceSign: +1 }, // far east bank → faces +x
  ];
  for (const bank of banks) {
    const count = Math.min(8, Math.floor((b.d - 3.0) / machineSpacing));
    for (let i = 0; i < count; i++) {
      const mz = -((count - 1) * machineSpacing) / 2 + i * machineSpacing;
      const m = buildMachine(_bldgRand(b.id ?? 'pachinko', i * 7 + bank.x));
      m.position.set(bank.x, 0, mz);
      m.rotation.y = bank.faceSign === +1 ? 0 : Math.PI;
      interior.add(m);
    }
    // Bank collider — destructible, full bank at once (machines back-to-back).
    if (count > 0) {
      const bankLen = (count - 1) * machineSpacing + 0.7;
      pushAABB(colliders, b.x + bank.x, b.z, 0.4, bankLen, {
        tier: 'hard', category: 'destructible',
        tag: 'pachinkoMachine', maxY: 1.7, jumpable: false,
      });
    }
  }

  // Counter / reception desk at the back wall (-z)
  const counterMat = mat(THREE, 0x6a2030, { roughness: 0.6 });
  const counter = box(THREE, 6.0, 1.05, 0.7, counterMat);
  counter.position.set(0, 0.525, -b.d / 2 + 1.4);
  interior.add(counter);
  // Counter collider — chest-high cover; jumpable since it's only 1.1u tall
  pushAABB(colliders, b.x, b.z + (-b.d / 2 + 1.4), 6.2, 0.85, {
    tier: 'prone', category: 'cover',
    tag: 'pachinkoCounter', maxY: 1.11,
  });
  const counterTop = box(THREE, 6.2, 0.06, 0.85, mat(THREE, 0x1a1014, { metalness: 0.4, roughness: 0.4 }));
  counterTop.position.set(0, 1.08, -b.d / 2 + 1.4);
  interior.add(counterTop);
  // Prize wall behind counter — colorful boxes
  const prizeColors = [0xff80b0, 0xffe060, 0x60d0ff, 0xff8a40, 0xc080ff, 0x80ffa0];
  for (let i = 0; i < 12; i++) {
    const c = prizeColors[i % prizeColors.length];
    const px = -2.5 + (i % 6) * 1.0;
    const py = 1.7 + Math.floor(i / 6) * 0.7;
    const p = box(THREE, 0.7, 0.55, 0.35, mat(THREE, c, { emissive: c, emissiveIntensity: 0.4, roughness: 0.5 }));
    p.position.set(px, py, -b.d / 2 + 0.85);
    interior.add(p);
  }

  // Hanging ceiling lights
  const lightMat = mat(THREE, 0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 1.4 });
  for (let i = -2; i <= 2; i++) {
    const lz = i * 3.0;
    const l = box(THREE, 8.0, 0.1, 0.4, lightMat);
    l.position.set(0, 4.3, lz);
    interior.add(l);
  }
}

function buildIzakaya(THREE, b, g, mats, colliders) {
  // Hollow shell — door on east face (+X), opens onto inner alley
  buildHollowShell(THREE, b, g, colliders, {
    facade: BLDG.facadeD,
    interiorColor: 0x2a1a14,
    floorColor: 0x3a261c,
    door: { wall: 'posX', width: 3.0, height: 2.7 },
    doorAccentColor: 0xffb050,
    animated: mats?._animated,
  });

  // Wood-trim awning on east wall (above door)
  const awning = box(THREE, 0.4, 0.3, b.d * 0.9, mat(THREE, BLDG.wood, { roughness: 1 }));
  awning.position.set(b.w / 2 + 0.6, 3.0, 0);
  g.add(awning);
  const awningTop = box(THREE, 1.2, 0.1, b.d * 0.9, mat(THREE, BLDG.wood, { roughness: 1 }));
  awningTop.position.set(b.w / 2 + 0.9, 3.2, 0);
  g.add(awningTop);

  // ── Interior ─────────────────────────────────────────────────────────────
  const interior = new THREE.Group();
  interior.name = 'interior';
  g.add(interior);

  const wood = mat(THREE, BLDG.wood, { roughness: 1 });
  const woodDark = mat(THREE, 0x2a1a10, { roughness: 1 });
  const tatami = mat(THREE, 0x9a8a4a, { roughness: 1 });

  // Bar counter along the back (-x) wall: long L-shape with stools facing it.
  const bar = box(THREE, 1.1, 1.1, b.d - 2.4, woodDark);
  bar.position.set(-b.w / 2 + 1.2, 0.55, 0);
  interior.add(bar);
  const barTop = box(THREE, 1.3, 0.06, b.d - 2.2, mat(THREE, 0x6a3a1a, { roughness: 0.5 }));
  barTop.position.set(-b.w / 2 + 1.2, 1.13, 0);
  interior.add(barTop);
  // Bottle shelf behind the bar
  const shelfBack = box(THREE, 0.15, 1.6, b.d - 2.4, woodDark);
  shelfBack.position.set(-b.w / 2 + 0.42, 1.6, 0);
  interior.add(shelfBack);
  // Bottles (small emissive cylinders) on the shelf
  const bottleColors = [0x6ad080, 0xb04030, 0xe0d090, 0x4080a0, 0xa05030, 0x208030];
  for (let i = 0; i < 14; i++) {
    const bz = -(b.d / 2 - 1.6) + i * ((b.d - 3.2) / 13);
    const c = bottleColors[i % bottleColors.length];
    const bt = cyl(THREE, 0.07, 0.09, 0.5, mat(THREE, c, { emissive: c, emissiveIntensity: 0.35, roughness: 0.4 }), 8);
    bt.position.set(-b.w / 2 + 0.55, 1.8, bz);
    interior.add(bt);
  }
  // A second row of bottles
  for (let i = 0; i < 12; i++) {
    const bz = -(b.d / 2 - 2.0) + i * ((b.d - 4.0) / 11);
    const c = bottleColors[(i + 3) % bottleColors.length];
    const bt = cyl(THREE, 0.06, 0.08, 0.4, mat(THREE, c, { emissive: c, emissiveIntensity: 0.3, roughness: 0.4 }), 8);
    bt.position.set(-b.w / 2 + 0.55, 2.5, bz);
    interior.add(bt);
  }

  // Bar stools facing the bar (along x = -b.w/2 + 2.5, spaced along z)
  for (let i = -2; i <= 2; i++) {
    const sz = i * 1.2;
    const stoolPost = cyl(THREE, 0.06, 0.06, 0.8, mat(THREE, 0x202024, { metalness: 0.6 }), 8);
    stoolPost.position.set(-b.w / 2 + 2.6, 0.4, sz);
    interior.add(stoolPost);
    const stoolSeat = cyl(THREE, 0.28, 0.28, 0.08, mat(THREE, 0x603020, { roughness: 0.7 }), 12);
    stoolSeat.position.set(-b.w / 2 + 2.6, 0.84, sz);
    interior.add(stoolSeat);
  }

  // Booth tables along the +x wall (interior side, near door)
  for (let i = -1; i <= 1; i++) {
    const tz = i * 2.6;
    const t = box(THREE, 1.2, 0.7, 1.2, wood);
    t.position.set(b.w / 2 - 2.5, 0.35, tz);
    interior.add(t);
    const s1 = box(THREE, 1.4, 0.45, 0.32, wood);
    s1.position.set(b.w / 2 - 2.5, 0.22, tz - 1.0);
    interior.add(s1);
    const s2 = box(THREE, 1.4, 0.45, 0.32, wood);
    s2.position.set(b.w / 2 - 2.5, 0.22, tz + 1.0);
    interior.add(s2);
    // Sake bottle + cup on table
    const tb = cyl(THREE, 0.07, 0.07, 0.22, mat(THREE, 0xe8d8a0, { roughness: 0.5 }), 8);
    tb.position.set(b.w / 2 - 2.5, 0.81, tz - 0.2);
    interior.add(tb);
    const tc = cyl(THREE, 0.06, 0.06, 0.07, mat(THREE, 0xe0e0e0, { roughness: 0.4 }), 8);
    tc.position.set(b.w / 2 - 2.5, 0.74, tz + 0.25);
    interior.add(tc);
  }

  // Tatami mat strip down the center
  const tat = box(THREE, 2.6, 0.04, b.d - 2.0, tatami);
  tat.position.set(0, 0.13, 0);
  interior.add(tat);

  // Hanging red paper lanterns — emissive cyls
  const lanternMat = mat(THREE, 0xff4030, { emissive: 0xff4030, emissiveIntensity: 1.6, roughness: 0.6 });
  for (let i = -2; i <= 2; i++) {
    const lz = i * 1.8;
    const lant = cyl(THREE, 0.28, 0.28, 0.45, lanternMat, 12);
    lant.position.set(-1.0, 3.4, lz);
    interior.add(lant);
    const cord = cyl(THREE, 0.02, 0.02, 0.6, mat(THREE, 0x101010), 6);
    cord.position.set(-1.0, 3.95, lz);
    interior.add(cord);
  }

  // Warm window glow on the +x wall above door
  const warm = mat(THREE, 0xffb050, { emissive: 0xffb050, emissiveIntensity: 1.4 });
  for (const i of [-1, 1]) {
    const w1 = box(THREE, 0.04, 0.6, 1.0, warm);
    w1.position.set(b.w / 2 + 0.04, 3.6, i * 2.5);
    g.add(w1);
  }
}

function buildCapsule(THREE, b, g, mats, colliders) {
  // Hollow shell — entrance on the south face (-Z, toward the z=20 secondary road)
  buildHollowShell(THREE, b, g, colliders, {
    facade: BLDG.facadeA,
    interiorColor: 0x1a2028,
    floorColor: 0x252a32,
    door: { wall: 'negZ', width: 3.0, height: 2.6 },
    doorAccentColor: NEON.cyan,
    animated: mats?._animated,
  });

  // Exterior capsule pod rows on the east wall (decorative — pods bulge from facade)
  const podMat = mat(THREE, 0x303a44, { roughness: 0.5 });
  const lit = mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 1.2 });
  for (let f = 0; f < 4; f++) {
    for (let i = -2; i <= 2; i++) {
      const c = cyl(THREE, 0.5, 0.5, 0.4, podMat, 12);
      c.rotation.z = Math.PI / 2;
      c.position.set(b.w / 2 + 0.05, 1.5 + f * 3.4, i * 1.4);
      g.add(c);
      const r = cyl(THREE, 0.32, 0.32, 0.05, lit, 12);
      r.rotation.z = Math.PI / 2;
      r.position.set(b.w / 2 + 0.26, 1.5 + f * 3.4, i * 1.4);
      g.add(r);
    }
  }

  // ── Interior ─────────────────────────────────────────────────────────────
  const interior = new THREE.Group();
  interior.name = 'interior';
  g.add(interior);

  // Reception desk faces the entrance (door is at -Z, desk on +Z back wall)
  const deskMat = mat(THREE, 0x202a36, { roughness: 0.6, metalness: 0.2 });
  const desk = box(THREE, 4.0, 1.05, 0.7, deskMat);
  desk.position.set(0, 0.525, b.d / 2 - 1.6);
  interior.add(desk);
  const deskTop = box(THREE, 4.2, 0.06, 0.85, mat(THREE, 0x303840, { metalness: 0.4 }));
  deskTop.position.set(0, 1.08, b.d / 2 - 1.6);
  interior.add(deskTop);
  // Glowing key panel mounted on the back wall behind the desk
  const keyPanel = box(THREE, 3.5, 1.2, 0.06, mat(THREE, 0x101418, { roughness: 0.4 }));
  keyPanel.position.set(0, 2.0, b.d / 2 - 0.4);
  interior.add(keyPanel);
  for (let i = 0; i < 24; i++) {
    const kx = -1.5 + (i % 8) * 0.42;
    const ky = 1.5 + Math.floor(i / 8) * 0.4;
    const lit = (_bldgRand(b.id ?? 'cap', i) > 0.4);
    const k = box(THREE, 0.18, 0.22, 0.04, lit
      ? mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 1.2 })
      : mat(THREE, 0x202830, { roughness: 0.7 }));
    k.position.set(kx, ky, b.d / 2 - 0.46);
    interior.add(k);
  }

  // Two stacked pod walls (interior) — west wall and east wall, 3 rows × 3 pods
  const podShell = mat(THREE, 0x303a44, { roughness: 0.5 });
  const podRing = mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 1.4 });
  const podDoor = mat(THREE, 0x101418, { roughness: 0.5 });
  // West interior wall pods (face +x, into corridor)
  for (let f = 0; f < 3; f++) {
    for (let i = -1; i <= 1; i++) {
      const px = -b.w / 2 + 1.7;
      const pz = i * 2.2;
      const py = f * 1.4;
      const shellG = new THREE.Group();
      shellG.position.set(px, py, pz);
      interior.add(shellG);
      const body = box(THREE, 1.9, 1.2, 1.6, podShell);
      body.position.y = 0.6;
      shellG.add(body);
      const ring = cyl(THREE, 0.55, 0.55, 0.04, podRing, 16);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(0.96, 0.7, 0);
      shellG.add(ring);
      const dr = cyl(THREE, 0.5, 0.5, 0.05, podDoor, 16);
      dr.rotation.z = Math.PI / 2;
      dr.position.set(0.99, 0.7, 0);
      shellG.add(dr);
    }
  }
  // East interior wall pods (face -x, into corridor)
  for (let f = 0; f < 3; f++) {
    for (let i = -1; i <= 1; i++) {
      const px = b.w / 2 - 1.7;
      const pz = i * 2.2;
      const py = f * 1.4;
      const shellG = new THREE.Group();
      shellG.position.set(px, py, pz);
      shellG.rotation.y = Math.PI;
      interior.add(shellG);
      const body = box(THREE, 1.9, 1.2, 1.6, podShell);
      body.position.y = 0.6;
      shellG.add(body);
      const ring = cyl(THREE, 0.55, 0.55, 0.04, podRing, 16);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(0.96, 0.7, 0);
      shellG.add(ring);
      const dr = cyl(THREE, 0.5, 0.5, 0.05, podDoor, 16);
      dr.rotation.z = Math.PI / 2;
      dr.position.set(0.99, 0.7, 0);
      shellG.add(dr);
    }
  }

  // Ceiling-mounted strip lights along the corridor
  const stripL = box(THREE, 0.3, 0.06, b.d - 2, mat(THREE, 0xc0e8ff, { emissive: 0xc0e8ff, emissiveIntensity: 1.6 }));
  stripL.position.set(0, 4.4, 0);
  interior.add(stripL);

  // A vending machine in the corner near reception (back wall)
  const vmBody = box(THREE, 0.9, 1.9, 0.6, mat(THREE, 0xc02828, { roughness: 0.5 }));
  vmBody.position.set(b.w / 2 - 1.2, 0.95, b.d / 2 - 1.5);
  interior.add(vmBody);
  const vmFace = box(THREE, 0.7, 1.2, 0.06, mat(THREE, 0xfff080, { emissive: 0xfff080, emissiveIntensity: 1.4 }));
  vmFace.position.set(b.w / 2 - 1.55, 1.2, b.d / 2 - 1.5);
  interior.add(vmFace);
}

function buildKonbini(THREE, b, g, mats, colliders) {
  // Konbini: opaque back/side walls, glass storefront with a doorway gap.
  // We don't use buildHollowShell since the front is mostly glass — build by hand.
  const wallT = 0.3;
  const halfW = b.w / 2, halfD = b.d / 2;
  const facade = mat(THREE, BLDG.facadeA, { roughness: 0.9 });
  const interiorMat = mat(THREE, 0xe8e8ec, { roughness: 0.9 });
  const floorMat = mat(THREE, 0xc0c0c8, { roughness: 0.95 });

  // Floor
  const floor = box(THREE, b.w - 0.05, 0.1, b.d - 0.05, floorMat);
  floor.position.y = 0.05;
  g.add(floor);

  // Back wall (-z)
  const back = box(THREE, b.w, b.h, wallT, facade);
  back.position.set(0, b.h / 2, -halfD + wallT / 2);
  g.add(back);
  pushAABB(colliders, b.x, b.z + (-halfD + wallT / 2), b.w, wallT, { tier: 'hard', tag: b.id, maxY: b.h });
  // Side walls
  const left = box(THREE, wallT, b.h, b.d, facade);
  left.position.set(-halfW + wallT / 2, b.h / 2, 0);
  g.add(left);
  pushAABB(colliders, b.x + (-halfW + wallT / 2), b.z, wallT, b.d, { tier: 'hard', tag: b.id, maxY: b.h });
  const right = box(THREE, wallT, b.h, b.d, facade);
  right.position.set(halfW - wallT / 2, b.h / 2, 0);
  g.add(right);
  pushAABB(colliders, b.x + (halfW - wallT / 2), b.z, wallT, b.d, { tier: 'hard', tag: b.id, maxY: b.h });

  // Ceiling (drop ceiling style)
  const ceil = box(THREE, b.w - wallT * 2 - 0.02, 0.1, b.d - wallT * 2 - 0.02, interiorMat);
  ceil.position.y = b.h - 0.6;
  g.add(ceil);

  // Roof
  const roof = box(THREE, b.w + 0.4, 0.3, b.d + 0.4, mat(THREE, BLDG.concrete));
  roof.position.y = b.h + 0.15;
  g.add(roof);

  // Glass storefront (+z) with door gap
  const glass = mat(THREE, 0x88ccff, {
    emissive: 0xffeec0, emissiveIntensity: 0.4,
    transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const dW = 2.6;
  const sideW = (b.w - dW) / 2 - 0.15;
  if (sideW > 0.1) {
    const fL = box(THREE, sideW, b.h - 0.6, 0.06, glass);
    fL.position.set(-halfW + 0.15 + sideW / 2, b.h / 2, halfD - 0.08);
    g.add(fL);
    pushAABB(colliders, b.x + (-halfW + 0.15 + sideW / 2), b.z + (halfD - 0.08), sideW, 0.06, { tier: 'hard', tag: b.id, maxY: b.h });
    const fR = box(THREE, sideW, b.h - 0.6, 0.06, glass);
    fR.position.set(halfW - 0.15 - sideW / 2, b.h / 2, halfD - 0.08);
    g.add(fR);
    pushAABB(colliders, b.x + (halfW - 0.15 - sideW / 2), b.z + (halfD - 0.08), sideW, 0.06, { tier: 'hard', tag: b.id, maxY: b.h });
  }
  // Transom over door
  const transom = box(THREE, dW, b.h - 2.4, 0.06, glass);
  transom.position.set(0, 2.4 + (b.h - 2.4) / 2, halfD - 0.08);
  g.add(transom);

  // Banded green/white awning above storefront
  const awn = box(THREE, b.w + 0.6, 0.4, 1.2, mat(THREE, NEON.green, { emissive: NEON.green, emissiveIntensity: 1.2 }));
  awn.position.set(0, b.h + 0.4, b.d / 2 + 0.5);
  g.add(awn);
  const stripe = box(THREE, b.w + 0.6, 0.42, 0.4, mat(THREE, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.8 }));
  stripe.position.set(0, b.h + 0.4, b.d / 2 + 0.5);
  g.add(stripe);

  // ── Interior ─────────────────────────────────────────────────────────────
  const interior = new THREE.Group();
  interior.name = 'interior';
  g.add(interior);

  // Bright fluorescent ceiling lights
  for (let i = -1; i <= 1; i++) {
    const flu = box(THREE, b.w - 1.6, 0.06, 0.3, mat(THREE, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.8 }));
    flu.position.set(0, b.h - 0.7, i * 2.2);
    interior.add(flu);
  }

  // Aisle shelves: 3 rows running along z, with food on top
  const shelfMat = mat(THREE, 0x665548, { roughness: 1 });
  const productColors = [0xff6040, 0xffd060, 0x60c0a0, 0x6090e0, 0xff90b0, 0xc0a060];
  for (let i = -1; i <= 1; i++) {
    const sx = i * 2.6;
    const s = box(THREE, 0.6, 1.5, b.d * 0.6, shelfMat);
    s.position.set(sx, 0.75, -1.4);
    interior.add(s);
    // Tiny product boxes on shelves (3 layers)
    for (let layer = 0; layer < 3; layer++) {
      for (let j = 0; j < 6; j++) {
        const c = productColors[((i + 1) * 7 + layer * 3 + j) % productColors.length];
        const p = box(THREE, 0.5, 0.32, 0.28, mat(THREE, c, { roughness: 0.6 }));
        p.position.set(sx, 0.25 + layer * 0.45, -1.4 - b.d * 0.27 + j * (b.d * 0.55 / 5));
        interior.add(p);
      }
    }
  }

  // Drink cooler (glass-front) along the back wall
  const coolerFrame = mat(THREE, 0x202830, { roughness: 0.5, metalness: 0.4 });
  const coolerGlass = mat(THREE, 0x80c0ff, { transparent: true, opacity: 0.3, roughness: 0.1, side: THREE.DoubleSide });
  const cool = box(THREE, b.w * 0.5, b.h - 1.0, 0.7, coolerFrame);
  cool.position.set(-b.w * 0.15, (b.h - 1.0) / 2, -halfD + wallT + 0.4);
  interior.add(cool);
  const coolFace = box(THREE, b.w * 0.5 - 0.2, b.h - 1.4, 0.08, coolerGlass);
  coolFace.position.set(-b.w * 0.15, (b.h - 1.0) / 2, -halfD + wallT + 0.78);
  interior.add(coolFace);
  // Cans inside cooler (stacked rows)
  const canColors = [0x3060c0, 0xc02020, 0x40a020, 0xe0a020];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 8; i++) {
      const cc = canColors[(row + i) % canColors.length];
      const can = cyl(THREE, 0.06, 0.06, 0.18, mat(THREE, cc, { emissive: cc, emissiveIntensity: 0.3 }), 8);
      can.position.set(-b.w * 0.15 - b.w * 0.22 + i * (b.w * 0.42 / 7), 0.4 + row * 0.55, -halfD + wallT + 0.55);
      interior.add(can);
    }
  }

  // Counter / register at +x side near front
  const counter = box(THREE, b.w * 0.5, 1.0, 0.7, shelfMat);
  counter.position.set(b.w * 0.2, 0.5, halfD - 1.4);
  interior.add(counter);
  const counterTop = box(THREE, b.w * 0.5 + 0.1, 0.06, 0.85, mat(THREE, 0x303030, { roughness: 0.4 }));
  counterTop.position.set(b.w * 0.2, 1.03, halfD - 1.4);
  interior.add(counterTop);
  // Register
  const reg = box(THREE, 0.4, 0.3, 0.4, mat(THREE, 0x202024, { roughness: 0.5 }));
  reg.position.set(b.w * 0.3, 1.21, halfD - 1.4);
  interior.add(reg);
  const regScreen = box(THREE, 0.32, 0.18, 0.04, mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 1.4 }));
  regScreen.position.set(b.w * 0.3, 1.32, halfD - 1.21);
  interior.add(regScreen);

  // Magazine rack (low) on -x side near front
  const rack = box(THREE, 0.5, 0.9, 2.4, shelfMat);
  rack.position.set(-b.w * 0.4, 0.45, halfD - 1.7);
  interior.add(rack);
  for (let i = 0; i < 6; i++) {
    const c = productColors[i % productColors.length];
    const mag = box(THREE, 0.4, 0.05, 0.32, mat(THREE, c, { roughness: 0.6 }));
    mag.position.set(-b.w * 0.4, 0.92 - (i % 3) * 0.27, halfD - 1.7 + (i < 3 ? -0.5 : 0.5));
    interior.add(mag);
  }

  // Floor mat near entrance
  const matRug = box(THREE, 1.6, 0.04, 0.6, mat(THREE, 0x40282a, { roughness: 1 }));
  matRug.position.set(0, 0.13, halfD - 0.6);
  interior.add(matRug);
}

function buildLoveHotel(THREE, b, g, mats, colliders) {
  // Hollow shell — door on +Z face (south) under the archway
  buildHollowShell(THREE, b, g, colliders, {
    facade: BLDG.facadeB,
    interiorColor: 0x301624,
    floorColor: 0x401a30,
    door: { wall: 'posZ', width: 4.0, height: 3.4 },
    doorAccentColor: NEON.pink,
    animated: mats?._animated,
  });

  // Gaudy archway entrance on south face (exterior)
  const arch = new THREE.Group();
  arch.position.set(0, 0, b.d / 2 + 0.5);
  const frameMat = mat(THREE, b.neon, { emissive: b.neon, emissiveIntensity: 2.5 });
  const aL = box(THREE, 0.6, 5.5, 0.6, frameMat);
  aL.position.set(-3, 2.75, 0);
  arch.add(aL);
  const aR = box(THREE, 0.6, 5.5, 0.6, frameMat);
  aR.position.set( 3, 2.75, 0);
  arch.add(aR);
  const aT = box(THREE, 7.0, 1.2, 0.7, frameMat);
  aT.position.set(0, 6.0, 0);
  arch.add(aT);
  const glow = box(THREE, 6.5, 0.8, 0.3, mat(THREE, NEON.pink, { emissive: NEON.pink, emissiveIntensity: 3.5 }));
  glow.position.set(0, 6.0, 0.32);
  arch.add(glow);
  const heart = box(THREE, 1.0, 1.0, 0.3, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 3.5 }));
  heart.rotation.z = Math.PI / 4;
  heart.position.set(0, 7.2, 0.3);
  arch.add(heart);
  g.add(arch);

  // ── Interior ─────────────────────────────────────────────────────────────
  const interior = new THREE.Group();
  interior.name = 'interior';
  g.add(interior);

  // Pink-shag carpet
  const carpet = box(THREE, b.w - 1.0, 0.05, b.d - 1.0, mat(THREE, 0x80203a, { roughness: 1 }));
  carpet.position.y = 0.13;
  interior.add(carpet);

  // Reception desk — heart-themed, dead-center back wall
  const deskMat = mat(THREE, 0x6a1844, { roughness: 0.5, metalness: 0.2 });
  const desk = box(THREE, 5.0, 1.05, 1.0, deskMat);
  desk.position.set(0, 0.525, -b.d / 2 + 1.6);
  interior.add(desk);
  const deskTop = box(THREE, 5.2, 0.06, 1.2, mat(THREE, 0x18000c, { roughness: 0.4, metalness: 0.4 }));
  deskTop.position.set(0, 1.08, -b.d / 2 + 1.6);
  interior.add(deskTop);
  // Heart sign on desk front
  const heartSign = box(THREE, 0.9, 0.9, 0.06, mat(THREE, NEON.pink, { emissive: NEON.pink, emissiveIntensity: 2.4 }));
  heartSign.rotation.z = Math.PI / 4;
  heartSign.position.set(0, 0.55, -b.d / 2 + 2.15);
  interior.add(heartSign);

  // Room-key panel behind desk — backlit cubbies with key tags
  const keyBoard = box(THREE, 5.5, 2.0, 0.06, mat(THREE, 0x180814, { roughness: 0.4 }));
  keyBoard.position.set(0, 2.6, -b.d / 2 + 0.4);
  interior.add(keyBoard);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      const lit = _bldgRand(b.id ?? 'love', row * 8 + col) > 0.55;
      const slot = box(THREE, 0.5, 0.4, 0.04, lit
        ? mat(THREE, 0xff80c0, { emissive: 0xff80c0, emissiveIntensity: 1.6 })
        : mat(THREE, 0x281020, { roughness: 0.7 }));
      slot.position.set(-2.3 + col * 0.65, 1.95 + row * 0.6, -b.d / 2 + 0.46);
      interior.add(slot);
    }
  }

  // Plush velour couches flanking the entrance
  const couchMat = mat(THREE, 0x6a0a3a, { roughness: 0.95 });
  const couch1Base = box(THREE, 3.6, 0.45, 1.0, couchMat);
  couch1Base.position.set(-b.w / 2 + 2.5, 0.4, b.d / 2 - 2.0);
  interior.add(couch1Base);
  const couch1Back = box(THREE, 3.6, 0.85, 0.3, couchMat);
  couch1Back.position.set(-b.w / 2 + 2.5, 0.85, b.d / 2 - 1.5);
  interior.add(couch1Back);

  const couch2Base = box(THREE, 3.6, 0.45, 1.0, couchMat);
  couch2Base.position.set(b.w / 2 - 2.5, 0.4, b.d / 2 - 2.0);
  interior.add(couch2Base);
  const couch2Back = box(THREE, 3.6, 0.85, 0.3, couchMat);
  couch2Back.position.set(b.w / 2 - 2.5, 0.85, b.d / 2 - 1.5);
  interior.add(couch2Back);

  // Coffee table between couches with rose vase
  const ctab = cyl(THREE, 0.6, 0.6, 0.5, mat(THREE, 0x2a0010, { roughness: 0.4, metalness: 0.3 }), 16);
  ctab.position.set(0, 0.25, b.d / 2 - 3.5);
  interior.add(ctab);
  const vase = cyl(THREE, 0.12, 0.18, 0.4, mat(THREE, 0xe0a0c0, { roughness: 0.4 }), 12);
  vase.position.set(0, 0.7, b.d / 2 - 3.5);
  interior.add(vase);
  // Single rose
  const roseStem = cyl(THREE, 0.02, 0.02, 0.5, mat(THREE, 0x205040), 6);
  roseStem.position.set(0, 1.15, b.d / 2 - 3.5);
  interior.add(roseStem);
  const rose = box(THREE, 0.18, 0.18, 0.18, mat(THREE, 0xe02040, { emissive: 0xe02040, emissiveIntensity: 0.3 }));
  rose.position.set(0, 1.45, b.d / 2 - 3.5);
  interior.add(rose);

  // Vending machine on -x wall
  const vm = box(THREE, 0.9, 1.9, 0.6, mat(THREE, 0x2a1020, { roughness: 0.5 }));
  vm.position.set(-b.w / 2 + 1.0, 0.95, 0);
  interior.add(vm);
  const vmFace = box(THREE, 0.06, 1.3, 0.55, mat(THREE, NEON.pink, { emissive: NEON.pink, emissiveIntensity: 1.6 }));
  vmFace.position.set(-b.w / 2 + 1.45, 1.15, 0);
  interior.add(vmFace);

  // "Elevator" doors on +x wall (decorative)
  const elev = box(THREE, 0.06, 2.4, 1.6, mat(THREE, 0x301020, { metalness: 0.6, roughness: 0.3 }));
  elev.position.set(b.w / 2 - 0.4, 1.2, 0);
  interior.add(elev);
  const elevSeam = box(THREE, 0.04, 2.4, 0.05, mat(THREE, 0x80203a, { emissive: 0x80203a, emissiveIntensity: 0.6 }));
  elevSeam.position.set(b.w / 2 - 0.34, 1.2, 0);
  interior.add(elevSeam);
  const elevPanel = box(THREE, 0.06, 0.5, 0.3, mat(THREE, NEON.pink, { emissive: NEON.pink, emissiveIntensity: 1.4 }));
  elevPanel.position.set(b.w / 2 - 0.32, 1.5, 1.0);
  interior.add(elevPanel);

  // Ceiling chandelier (cluster of pink emissive blobs)
  const chBody = cyl(THREE, 0.1, 0.1, 0.6, mat(THREE, 0x2a0010), 8);
  chBody.position.set(0, 4.1, 0);
  interior.add(chBody);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b2 = box(THREE, 0.18, 0.18, 0.18, mat(THREE, 0xff80c0, { emissive: 0xff80c0, emissiveIntensity: 2.0 }));
    b2.position.set(Math.cos(a) * 0.55, 3.9, Math.sin(a) * 0.55);
    interior.add(b2);
  }

  // Wall sconces along the -x and +x walls
  for (const sx of [-b.w / 2 + 0.4, b.w / 2 - 0.4]) {
    for (let i = -1; i <= 1; i += 2) {
      const sc = box(THREE, 0.1, 0.4, 0.2, mat(THREE, NEON.pink, { emissive: NEON.pink, emissiveIntensity: 1.4 }));
      sc.position.set(sx, 2.5, i * 3.0);
      interior.add(sc);
    }
  }
}

function buildShrine(THREE, b, g, mats, colliders) {
  // Stone platform with 3-4 steps
  const stepMat = mat(THREE, 0x4a4538, { roughness: 1 });
  const stepCount = 4;
  for (let i = 0; i < stepCount; i++) {
    const sw = b.w + (stepCount - i) * 0.8;
    const sd = b.d + (stepCount - i) * 0.8;
    const s = box(THREE, sw, 0.2, sd, stepMat);
    s.position.set(0, 0.1 + i * 0.18, 0);
    g.add(s);
  }
  const baseY = stepCount * 0.18 + 0.05;

  // Torii gate
  const toriiMat = mat(THREE, 0xc81e1e, { emissive: 0x551010, emissiveIntensity: 0.4, roughness: 0.7 });
  const tL = box(THREE, 0.5, 5.0, 0.5, toriiMat);
  tL.position.set(-3, baseY + 2.5, b.d * 0.45);
  g.add(tL);
  const tR = box(THREE, 0.5, 5.0, 0.5, toriiMat);
  tR.position.set( 3, baseY + 2.5, b.d * 0.45);
  g.add(tR);
  const tTop1 = box(THREE, 8.0, 0.5, 0.6, toriiMat);
  tTop1.position.set(0, baseY + 5.2, b.d * 0.45);
  g.add(tTop1);
  const tTop2 = box(THREE, 7.5, 0.35, 0.5, toriiMat);
  tTop2.position.set(0, baseY + 4.7, b.d * 0.45);
  g.add(tTop2);
  // Vertical center plaque
  const plaque = box(THREE, 0.6, 0.7, 0.1, mat(THREE, 0x1a1a1a, { roughness: 0.6 }));
  plaque.position.set(0, baseY + 4.95, b.d * 0.45 + 0.32);
  g.add(plaque);

  // Small shrine building (honden)
  const hondenWall = mat(THREE, 0x4d3a25, { roughness: 0.95 });
  const honden = box(THREE, b.w * 0.55, 2.2, b.d * 0.45, hondenWall);
  honden.position.set(0, baseY + 1.1, -b.d * 0.15);
  g.add(honden);
  // Sloped-roof approx (shallow tilted box)
  const roofMat = mat(THREE, 0x161616, { roughness: 0.7 });
  const roof = box(THREE, b.w * 0.7, 0.3, b.d * 0.55, roofMat);
  roof.position.set(0, baseY + 2.4, -b.d * 0.15);
  g.add(roof);
  // Soft warm lantern at honden front
  const lant = box(THREE, 0.4, 0.6, 0.4, mat(THREE, 0xffd070, { emissive: 0xffd070, emissiveIntensity: 1.6 }));
  lant.position.set(0, baseY + 2.4, -b.d * 0.15 + b.d * 0.25);
  g.add(lant);

  if (colliders) {
    // Honden body — solid
    pushAABB(colliders, b.x, b.z + (-b.d * 0.15), b.w * 0.55, b.d * 0.45, {
      tier: 'hard', category: 'solid', tag: `${b.id}_honden`, maxY: baseY + 2.4,
    });
    // Torii posts — 2 solid pillars (top rail is overhead, no collision)
    pushAABB(colliders, b.x - 3, b.z + b.d * 0.45, 0.5, 0.5, {
      tier: 'hard', category: 'solid', tag: `${b.id}_toriiL`, maxY: baseY + 5.0,
    });
    pushAABB(colliders, b.x + 3, b.z + b.d * 0.45, 0.5, 0.5, {
      tier: 'hard', category: 'solid', tag: `${b.id}_toriiR`, maxY: baseY + 5.0,
    });
  }
}

function buildGrandShrine(THREE, b, g, mats, colliders) {
  // Detailed Japanese shrine — stone base, multi-tier roof honden, torii path,
  // komainu guardians, lanterns, pagoda, basin.
  // ── Stone base platform with steps on all four sides ──
  const stoneMat = mat(THREE, 0x6e6a60, { roughness: 1 });
  const darkStone = mat(THREE, 0x4a4538, { roughness: 1 });
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const inset = i * 0.5;
    const sw = b.w - inset * 2;
    const sd = b.d - inset * 2;
    const sy = i * 0.25;
    const s = box(THREE, sw, 0.3, sd, i === 0 ? darkStone : stoneMat);
    s.position.set(0, 0.15 + sy, 0);
    g.add(s);
  }
  const baseY = (steps - 1) * 0.25 + 0.3;

  // ── Main hall (honden) — wood structure with multi-tier curved roof ──
  const wood = mat(THREE, 0x8a3a1c, { emissive: 0x4a1808, emissiveIntensity: 0.45, roughness: 0.85 });
  const woodDark = mat(THREE, 0x4a2010, { roughness: 0.85 });
  const goldTrim = mat(THREE, 0xd0a040, { emissive: 0xa07020, emissiveIntensity: 0.7, roughness: 0.5, metalness: 0.6 });
  const roofTile = mat(THREE, 0x222024, { roughness: 0.6 });
  // Honden body
  const hondenW = b.w * 0.45, hondenD = b.d * 0.45, hondenH = 6.5;
  const honden = box(THREE, hondenW, hondenH, hondenD, wood);
  honden.position.set(0, baseY + hondenH / 2, -b.d * 0.1);
  g.add(honden);
  // Vertical wood beams (visual columns)
  for (const cx of [-hondenW / 2 + 0.3, hondenW / 2 - 0.3]) {
    for (const cz of [-hondenD / 2 + 0.3, hondenD / 2 - 0.3]) {
      const col = box(THREE, 0.55, hondenH, 0.55, woodDark);
      col.position.set(cx, baseY + hondenH / 2, -b.d * 0.1 + cz);
      g.add(col);
    }
  }
  // Multi-tier roof: 2 layers, each layer wider at base, sloping up toward ridge
  const roofY1 = baseY + hondenH;
  const tier1 = box(THREE, hondenW + 3.0, 0.6, hondenD + 3.0, roofTile);
  tier1.position.set(0, roofY1 + 0.3, -b.d * 0.1);
  g.add(tier1);
  // Sloped tier 1 — two slabs angled inward (approximation of curved eaves)
  const slope1L = box(THREE, hondenW + 3.0, 0.4, 0.6, roofTile);
  slope1L.position.set(0, roofY1 + 1.0, -b.d * 0.1 - hondenD / 2 - 1.5);
  slope1L.rotation.x = -0.5;
  g.add(slope1L);
  const slope1R = box(THREE, hondenW + 3.0, 0.4, 0.6, roofTile);
  slope1R.position.set(0, roofY1 + 1.0, -b.d * 0.1 + hondenD / 2 + 1.5);
  slope1R.rotation.x = 0.5;
  g.add(slope1R);
  // Tier 2 (smaller, higher)
  const roofY2 = roofY1 + 1.6;
  const tier2 = box(THREE, hondenW + 1.6, 0.4, hondenD + 1.6, roofTile);
  tier2.position.set(0, roofY2, -b.d * 0.1);
  g.add(tier2);
  // Ridge beam (top spine)
  const ridge = box(THREE, hondenW + 1.0, 0.35, 0.5, goldTrim);
  ridge.position.set(0, roofY2 + 0.4, -b.d * 0.1);
  g.add(ridge);
  // Chigi (crossed finials at each end of the ridge)
  for (const sx of [-hondenW / 2, hondenW / 2]) {
    const chigi1 = box(THREE, 0.15, 1.4, 0.15, goldTrim);
    chigi1.rotation.z = 0.4;
    chigi1.position.set(sx, roofY2 + 1.1, -b.d * 0.1);
    g.add(chigi1);
    const chigi2 = box(THREE, 0.15, 1.4, 0.15, goldTrim);
    chigi2.rotation.z = -0.4;
    chigi2.position.set(sx, roofY2 + 1.1, -b.d * 0.1);
    g.add(chigi2);
  }
  // Katsuogi (horizontal logs along the ridge)
  for (let i = -2; i <= 2; i++) {
    const kg = cyl(THREE, 0.18, 0.18, 0.7, goldTrim, 8);
    kg.rotation.z = Math.PI / 2;
    kg.position.set(i * (hondenW * 0.18), roofY2 + 0.65, -b.d * 0.1);
    g.add(kg);
  }
  // Front entrance step + suspended bell
  const entStep = box(THREE, hondenW * 0.5, 0.3, 0.6, woodDark);
  entStep.position.set(0, baseY + 0.15, -b.d * 0.1 + hondenD / 2 + 0.3);
  g.add(entStep);
  // Bell suspended from a small frame — frame supported by floor-to-frame posts
  const bellZ = -b.d * 0.1 + hondenD / 2 + 1.0;
  const frameTopY = baseY + 4.3;
  const bellFrame = box(THREE, 1.4, 0.15, 0.3, woodDark);
  bellFrame.position.set(0, frameTopY, bellZ);
  g.add(bellFrame);
  for (const sx of [-0.55, 0.55]) {
    const bp = box(THREE, 0.15, frameTopY - baseY, 0.15, woodDark);
    bp.position.set(sx, baseY + (frameTopY - baseY) / 2, bellZ);
    g.add(bp);
  }
  const bell = cyl(THREE, 0.35, 0.45, 0.7, goldTrim, 12);
  bell.position.set(0, frameTopY - 0.6, bellZ);
  g.add(bell);
  const bellRope = box(THREE, 0.06, frameTopY - baseY - 0.95, 0.06, mat(THREE, 0xddc680, { roughness: 0.95 }));
  bellRope.position.set(0, baseY + (frameTopY - baseY - 0.95) / 2, bellZ);
  g.add(bellRope);

  // ── Torii gate path (8 gates, leading from front of footprint to honden) ──
  const toriiMat = mat(THREE, 0xd02818, { emissive: 0x6a1408, emissiveIntensity: 0.7, roughness: 0.7 });
  const toriiCount = 8;
  const pathStartZ = b.d * 0.45;       // near front
  const pathEndZ   = -b.d * 0.05;      // just before honden
  for (let i = 0; i < toriiCount; i++) {
    const t = i / (toriiCount - 1);
    const z = pathStartZ + t * (pathEndZ - pathStartZ);
    const scale = 0.85 + 0.2 * (1 - t);
    const tH = 4.5 * scale;
    const tW = 3.4 * scale;
    // Posts
    const postL = box(THREE, 0.32, tH, 0.32, toriiMat);
    postL.position.set(-tW / 2, baseY + tH / 2, z);
    g.add(postL);
    const postR = box(THREE, 0.32, tH, 0.32, toriiMat);
    postR.position.set( tW / 2, baseY + tH / 2, z);
    g.add(postR);
    // Top rail (kasagi)
    const top1 = box(THREE, tW + 1.2, 0.32, 0.4, toriiMat);
    top1.position.set(0, baseY + tH - 0.15, z);
    g.add(top1);
    // Lower rail (nuki)
    const top2 = box(THREE, tW + 0.2, 0.22, 0.3, toriiMat);
    top2.position.set(0, baseY + tH - 0.85, z);
    g.add(top2);
  }

  // ── Komainu (lion guardian) statues flanking front entrance ──
  const stone = mat(THREE, 0x707068, { roughness: 0.95 });
  for (const sx of [-2.4, 2.4]) {
    const pedestal = box(THREE, 1.0, 0.6, 1.0, darkStone);
    pedestal.position.set(sx, baseY + 0.3, b.d * 0.45 - 0.5);
    g.add(pedestal);
    // Body — crouched stone figure (stylized)
    const body = box(THREE, 0.7, 0.8, 0.9, stone);
    body.position.set(sx, baseY + 1.0, b.d * 0.45 - 0.5);
    g.add(body);
    // Head
    const head = box(THREE, 0.55, 0.55, 0.55, stone);
    head.position.set(sx, baseY + 1.6, b.d * 0.45 - 0.2);
    g.add(head);
    // Mane curls (small bumps)
    for (let m = 0; m < 4; m++) {
      const ang = (m / 4) * Math.PI * 2;
      const mb = cyl(THREE, 0.12, 0.12, 0.18, stone, 6);
      mb.position.set(sx + Math.cos(ang) * 0.32, baseY + 1.6 + Math.sin(ang) * 0.32, b.d * 0.45 - 0.2);
      g.add(mb);
    }
    // Tail
    const tail = box(THREE, 0.18, 0.5, 0.18, stone);
    tail.rotation.x = -0.4;
    tail.position.set(sx, baseY + 1.4, b.d * 0.45 - 0.95);
    g.add(tail);
  }

  // ── Stone lanterns flanking the path (4 pairs along the torii path) ──
  for (let i = 0; i < 4; i++) {
    const z = pathStartZ - 1.5 - i * 2.4;
    for (const sx of [-4.5, 4.5]) {
      const lbase = cyl(THREE, 0.4, 0.45, 0.3, stone, 8);
      lbase.position.set(sx, baseY + 0.15, z);
      g.add(lbase);
      const lpost = cyl(THREE, 0.14, 0.18, 1.0, stone, 8);
      lpost.position.set(sx, baseY + 0.8, z);
      g.add(lpost);
      const lhead = box(THREE, 0.6, 0.6, 0.6, stone);
      lhead.position.set(sx, baseY + 1.7, z);
      g.add(lhead);
      const lwin = box(THREE, 0.32, 0.32, 0.62, mat(THREE, 0xffd070, { emissive: 0xffd070, emissiveIntensity: 1.6 }));
      lwin.position.set(sx, baseY + 1.7, z);
      g.add(lwin);
      const lcap = cyl(THREE, 0.06, 0.45, 0.2, stone, 6);
      lcap.position.set(sx, baseY + 2.1, z);
      g.add(lcap);
    }
  }

  // ── Tall central red pagoda tower (3 tiers) — placed behind honden ──
  const pagX = 0, pagZ = -b.d * 0.4;
  const tierW = [4.4, 3.6, 2.8];
  const tierH = [3.0, 2.6, 2.2];
  let py = baseY;
  for (let i = 0; i < 3; i++) {
    const body = box(THREE, tierW[i], tierH[i], tierW[i], wood);
    body.position.set(pagX, py + tierH[i] / 2, pagZ);
    g.add(body);
    // Eave roof — sits on top of body, slightly overhanging
    const eave = box(THREE, tierW[i] + 1.2, 0.4, tierW[i] + 1.2, roofTile);
    eave.position.set(pagX, py + tierH[i] + 0.2, pagZ);
    g.add(eave);
    // Gold trim band just below the eave (wraps top of body)
    const trim = box(THREE, tierW[i] + 0.3, 0.18, tierW[i] + 0.3, goldTrim);
    trim.position.set(pagX, py + tierH[i] - 0.05, pagZ);
    g.add(trim);
    // Stack the next tier directly on top of this eave (no air gap)
    py += tierH[i] + 0.4;
  }
  // Pagoda spire / sōrin — base sits on top of last eave
  const spireH = 2.0;
  const spire = cyl(THREE, 0.05, 0.18, spireH, goldTrim, 8);
  spire.position.set(pagX, py + spireH / 2, pagZ);
  g.add(spire);
  // Spire rings — distributed along the spire shaft
  for (let i = 0; i < 4; i++) {
    const ring = cyl(THREE, 0.32 - i * 0.05, 0.32 - i * 0.05, 0.06, goldTrim, 12);
    ring.position.set(pagX, py + 0.3 + i * 0.4, pagZ);
    g.add(ring);
  }

  // ── Hand-washing basin (chōzuya) ──
  const choz = new THREE.Group();
  choz.position.set(b.w * 0.32, baseY, b.d * 0.18);
  g.add(choz);
  for (const cx of [-1.2, 1.2]) for (const cz of [-0.7, 0.7]) {
    const post = box(THREE, 0.18, 2.4, 0.18, woodDark);
    post.position.set(cx, 1.2, cz);
    choz.add(post);
  }
  const cRoof = box(THREE, 3.0, 0.25, 1.8, roofTile);
  cRoof.position.set(0, 2.5, 0);
  choz.add(cRoof);
  const basin = box(THREE, 1.8, 0.5, 1.0, stone);
  basin.position.set(0, 0.5, 0);
  choz.add(basin);
  const water = box(THREE, 1.6, 0.05, 0.85, mat(THREE, 0x4080a0, { emissive: 0x204050, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, roughness: 0.2 }));
  water.position.set(0, 0.78, 0);
  choz.add(water);
  // Bamboo dipper rest
  const dipperBar = cyl(THREE, 0.04, 0.04, 1.6, mat(THREE, 0x4a3a18), 6);
  dipperBar.rotation.z = Math.PI / 2;
  dipperBar.position.set(0, 0.85, 0);
  choz.add(dipperBar);

  // ── Sakura trees nearby (4) ──
  const trunk = mat(THREE, 0x5a3a20, { roughness: 0.95 });
  const cherryPink = mat(THREE, 0xffb0c8, { emissive: 0xff70a0, emissiveIntensity: 0.6, roughness: 0.7 });
  const cherryPositions = [
    { x: -b.w * 0.42, z:  b.d * 0.30 },
    { x:  b.w * 0.42, z:  b.d * 0.30 },
    { x: -b.w * 0.42, z: -b.d * 0.32 },
    { x:  b.w * 0.42, z: -b.d * 0.32 },
  ];
  for (const cp of cherryPositions) {
    const tr = cyl(THREE, 0.18, 0.25, 2.4, trunk, 8);
    tr.position.set(cp.x, baseY + 1.2, cp.z);
    g.add(tr);
    // Canopy: cluster of pink boxes
    for (let i = 0; i < 5; i++) {
      const cw = 1.4 + Math.random() * 0.6;
      const can = box(THREE, cw, cw * 0.7, cw, cherryPink);
      const ang = (i / 5) * Math.PI * 2;
      can.position.set(cp.x + Math.cos(ang) * 0.6, baseY + 2.8 + (i % 2) * 0.4, cp.z + Math.sin(ang) * 0.6);
      g.add(can);
    }
    // Crown
    const crown = box(THREE, 2.0, 1.0, 2.0, cherryPink);
    crown.position.set(cp.x, baseY + 3.5, cp.z);
    g.add(crown);
  }

  // ── Paper lantern strings (between two front torii posts, hanging) ──
  const strMat = mat(THREE, 0x222226, { roughness: 0.9 });
  for (let lane of [-1, 1]) {
    const hangY = baseY + 4.2;
    const xL = lane * (3.4 * 0.85) / 2;
    // String running across path
    const str = box(THREE, 0.04, 0.04, 8.0, strMat);
    str.position.set(xL, hangY, b.d * 0.2);
    g.add(str);
    // Hanging chōchin (red paper lanterns)
    for (let i = 0; i < 6; i++) {
      const lan = cyl(THREE, 0.18, 0.18, 0.36, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 1.6 }), 10);
      lan.position.set(xL, hangY - 0.4, b.d * 0.45 - i * 1.4);
      g.add(lan);
    }
  }

  // ── Offering box at honden front ──
  const offerBox = box(THREE, 1.6, 0.7, 0.7, woodDark);
  offerBox.position.set(0, baseY + 0.35, -b.d * 0.1 + hondenD / 2 + 1.4);
  g.add(offerBox);

  // ── Soft warm interior glow inside honden (faces) ──
  for (const ix of [-1, 0, 1]) {
    const glow = box(THREE, hondenW * 0.25, 1.0, 0.06, mat(THREE, 0xffaa55, { emissive: 0xffaa55, emissiveIntensity: 1.2 }));
    glow.position.set(ix * hondenW * 0.30, baseY + 2.4, -b.d * 0.1 + hondenD / 2 + 0.04);
    g.add(glow);
  }

  if (colliders) {
    // Honden body — solid (full 6.5u tall)
    pushAABB(colliders, b.x, b.z + (-b.d * 0.1), hondenW, hondenD, {
      tier: 'hard', category: 'solid', tag: `${b.id}_honden`, maxY: baseY + hondenH,
    });
    // Pagoda — solid (largest tier dominates blocking)
    pushAABB(colliders, b.x + pagX, b.z + pagZ, tierW[0], tierW[0], {
      tier: 'hard', category: 'solid', tag: `${b.id}_pagoda`, maxY: baseY + 8.5,
    });
    // Torii posts (8 gates × 2 posts each)
    for (let i = 0; i < toriiCount; i++) {
      const t = i / (toriiCount - 1);
      const z = pathStartZ + t * (pathEndZ - pathStartZ);
      const scale = 0.85 + 0.2 * (1 - t);
      const tH = 4.5 * scale;
      const tW = 3.4 * scale;
      pushAABB(colliders, b.x - tW / 2, b.z + z, 0.4, 0.4, {
        tier: 'hard', category: 'solid', tag: `${b.id}_toriiL${i}`, maxY: baseY + tH * 0.85,
      });
      pushAABB(colliders, b.x + tW / 2, b.z + z, 0.4, 0.4, {
        tier: 'hard', category: 'solid', tag: `${b.id}_toriiR${i}`, maxY: baseY + tH * 0.85,
      });
    }
    // Komainu pedestals + bodies — cover (chest-high)
    for (const sx of [-2.4, 2.4]) {
      pushAABB(colliders, b.x + sx, b.z + b.d * 0.45 - 0.5, 1.0, 1.0, {
        tier: 'prone', category: 'cover', tag: `${b.id}_komainu`, maxY: baseY + 1.9,
      });
    }
    // Stone lanterns flanking path (4 pairs)
    for (let i = 0; i < 4; i++) {
      const z = pathStartZ - 1.5 - i * 2.4;
      for (const sx of [-4.5, 4.5]) {
        pushAABB(colliders, b.x + sx, b.z + z, 0.7, 0.7, {
          tier: 'hard', category: 'solid', tag: `${b.id}_stoneLant`, maxY: baseY + 2.2,
        });
      }
    }
    // Offering box — cover
    pushAABB(colliders, b.x, b.z + (-b.d * 0.1 + hondenD / 2 + 1.4), 1.6, 0.7, {
      tier: 'prone', category: 'cover', tag: `${b.id}_offering`, maxY: baseY + 0.7,
    });
    // Bell frame posts
    for (const sx of [-0.55, 0.55]) {
      pushAABB(colliders, b.x + sx, b.z + bellZ, 0.2, 0.2, {
        tier: 'hard', category: 'solid', tag: `${b.id}_bellPost`, maxY: frameTopY,
      });
    }
    // Chōzuya (basin pavilion) posts + basin
    const chozX = b.w * 0.32, chozZ = b.d * 0.18;
    for (const cx of [-1.2, 1.2]) for (const cz of [-0.7, 0.7]) {
      pushAABB(colliders, b.x + chozX + cx, b.z + chozZ + cz, 0.22, 0.22, {
        tier: 'hard', category: 'solid', tag: `${b.id}_chozPost`, maxY: baseY + 2.4,
      });
    }
    pushAABB(colliders, b.x + chozX, b.z + chozZ, 1.8, 1.0, {
      tier: 'prone', category: 'cover', tag: `${b.id}_basin`, maxY: baseY + 0.8,
    });
    // Sakura trunks
    for (const cp of cherryPositions) {
      pushAABB(colliders, b.x + cp.x, b.z + cp.z, 0.5, 0.5, {
        tier: 'hard', category: 'solid', tag: `${b.id}_sakura`, maxY: baseY + 2.4,
      });
    }
  }
}

function buildMidrise(THREE, b, g, mats, colliders) {
  buildBoxBuilding(THREE, b, g, mats, colliders, { facade: BLDG.facadeC });

  // Add a vertical neon sign on the side facing the street (east default).
  // Suppressed when b.noSign is true (a richer verticalSign prop covers it).
  if (!b.noSign) {
    const signColor = b.neon ?? NEON.cyan;
    const signH = b.h * 0.6;
    const signTex = makeKanjiTexture(THREE, b.sign ?? 'ビル', signColor, signH);
    const signMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: signTex, emissive: signColor, emissiveMap: signTex,
      emissiveIntensity: 2.4, roughness: 0.45,
    });
    const sign = box(THREE, 0.4, signH, 1.6, signMat);
    sign.position.set(b.w / 2 + 0.25, b.h * 0.55, 0);
    g.add(sign);
  }

  // Rooftop parapet (low wall)
  const para = mat(THREE, BLDG.concrete, { roughness: 1 });
  const t = 0.25;
  const ph = 0.8;
  const py = b.h + 0.3 + ph / 2;
  const p1 = box(THREE, b.w + 0.5, ph, t, para); p1.position.set(0, py,  b.d / 2 + 0.1); g.add(p1);
  const p2 = box(THREE, b.w + 0.5, ph, t, para); p2.position.set(0, py, -b.d / 2 - 0.1); g.add(p2);
  const p3 = box(THREE, t, ph, b.d + 0.5, para); p3.position.set( b.w / 2 + 0.1, py, 0); g.add(p3);
  const p4 = box(THREE, t, ph, b.d + 0.5, para); p4.position.set(-b.w / 2 - 0.1, py, 0); g.add(p4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire ladders & rooftop walkway plank
// ─────────────────────────────────────────────────────────────────────────────

function buildFireLadder(THREE, b, wall, parent, colliders, wallOffset = 0) {
  const g = new THREE.Group();
  g.name = `ladder_${b.id}_${wall}`;
  const railMat = mat(THREE, 0x2a2a2e, { metalness: 0.6, roughness: 0.4 });
  const rungMat = mat(THREE, 0x9a6a2a, { metalness: 0.3, roughness: 0.7 });

  const h = b.h + 0.6; // top of parapet
  // ladder dims
  const ladderW = 0.7;
  const ladderT = 0.08;

  // Rails
  const r1 = box(THREE, ladderT, h, ladderT, railMat); r1.position.set(-ladderW / 2, h / 2, 0); g.add(r1);
  const r2 = box(THREE, ladderT, h, ladderT, railMat); r2.position.set( ladderW / 2, h / 2, 0); g.add(r2);
  // Rungs
  for (let y = 0.3; y < h - 0.2; y += 0.4) {
    const rung = box(THREE, ladderW, 0.05, 0.05, rungMat);
    rung.position.set(0, y, 0);
    g.add(rung);
  }

  // Position relative to building. wallOffset shifts along the wall (z for E/W, x for N/S).
  const off = 0.3;
  if (wall === 'east')  { g.position.set(b.x + b.w / 2 + off, 0, b.z + wallOffset); g.rotation.y = -Math.PI / 2; }
  if (wall === 'west')  { g.position.set(b.x - b.w / 2 - off, 0, b.z + wallOffset); g.rotation.y =  Math.PI / 2; }
  if (wall === 'north') { g.position.set(b.x + wallOffset, 0, b.z - b.d / 2 - off); g.rotation.y = 0; }
  if (wall === 'south') { g.position.set(b.x + wallOffset, 0, b.z + b.d / 2 + off); g.rotation.y = Math.PI; }
  parent.add(g);

  // collider — narrow vertical column, prone tier so bullets pass
  pushAABB(colliders, g.position.x, g.position.z, 0.9, 0.3, { tier: 'prone', tag: `ladder_${b.id}`, maxY: h });
}

function buildPlank(THREE, feature, parent, colliders) {
  const dx = feature.to.x - feature.from.x;
  const dz = feature.to.z - feature.from.z;
  const len = Math.hypot(dx, dz);
  const cx = (feature.from.x + feature.to.x) / 2;
  const cz = (feature.from.z + feature.to.z) / 2;
  const cy = (feature.from.y + feature.to.y) / 2;
  const ang = Math.atan2(dz, dx);

  const g = new THREE.Group();
  g.name = 'plank_rooftop';
  g.position.set(cx, cy, cz);
  g.rotation.y = -ang;
  parent.add(g);

  const plank = box(THREE, len, 0.12, feature.w, mat(THREE, BLDG.wood, { roughness: 1 }));
  g.add(plank);
  // Rope guard rails on both sides.
  const railMat = mat(THREE, 0x2a2a2e, { metalness: 0.6, roughness: 0.4 });
  const ropeMat = mat(THREE, 0xc8a878, { roughness: 0.95 });
  for (const side of [-1, 1]) {
    const top = box(THREE, len, 0.05, 0.05, ropeMat);
    top.position.set(0, 0.95, side * (feature.w / 2 - 0.04));
    g.add(top);
    const mid = box(THREE, len, 0.04, 0.04, ropeMat);
    mid.position.set(0, 0.55, side * (feature.w / 2 - 0.04));
    g.add(mid);
    const postCount = Math.max(2, Math.ceil(len / 1.6));
    for (let i = 0; i <= postCount; i++) {
      const t = (i / postCount) - 0.5;
      const post = box(THREE, 0.06, 1.0, 0.06, railMat);
      post.position.set(t * len, 0.5, side * (feature.w / 2 - 0.04));
      g.add(post);
    }
  }

  // Split into short rotated segments so the AABB hugs the diagonal plank.
  const SEG_LEN = 1.5;
  const segCount = Math.max(1, Math.ceil(len / SEG_LEN));
  for (let i = 0; i < segCount; i++) {
    const t = (i + 0.5) / segCount - 0.5;
    pushRotatedAABB(colliders, cx, cz, len / segCount, feature.w, ang, {
      ox: t * len, oz: 0,
      tier: 'prone', tag: 'plank',
      minY: cy - 0.2, maxY: cy + 0.6,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prop builders
// ─────────────────────────────────────────────────────────────────────────────

function buildVendingCluster(THREE, p, parent, colliders) {
  const count = p.count ?? 2;
  const g = new THREE.Group();
  g.name = 'vendingCluster';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);

  const bodyMat = mat(THREE, 0x202028, { roughness: 0.6 });
  const glow = mat(THREE, p.color ?? NEON.cyan, { emissive: p.color ?? NEON.cyan, emissiveIntensity: 1.6 });
  const winMat = mat(THREE, 0xffeec0, { emissive: 0xffeec0, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });

  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 1.15;
    const body = box(THREE, 1.05, 1.85, 0.7, bodyMat);
    body.position.set(off, 0.925, 0);
    g.add(body);
    // Top neon strip
    const strip = box(THREE, 1.05, 0.18, 0.72, glow);
    strip.position.set(off, 1.78, 0);
    g.add(strip);
    // Display window
    const win = box(THREE, 0.8, 0.9, 0.04, winMat);
    win.position.set(off, 1.25, 0.36);
    g.add(win);
    // Side accent
    const acc = box(THREE, 1.07, 0.05, 0.04, glow);
    acc.position.set(off, 0.6, 0.36);
    g.add(acc);
  }

  // Per-machine colliders, each rotation-aware. Spec: "Grouped props (vending
  // cluster) → one collider per machine."
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 1.15;
    pushRotatedAABB(colliders, p.x, p.z, 1.05, 0.7, p.rot ?? 0, {
      ox: off, oz: 0,
      tier: 'hard', tag: 'vending', maxY: 1.9, jumpable: false,
    });
  }
}

function buildVerticalSign(THREE, p, parent, animatedOut) {
  const g = new THREE.Group();
  g.name = `vsign_${p.text}`;
  g.position.set(p.x, p.height / 2 + 2.5, p.z);
  parent.add(g);

  // Width scales with height so the kanji texture (canvas aspect ~1:4) is not
  // stretched vertically into a thin column. Minimum keeps short signs readable.
  const faceW = Math.max(0.78, (p.height - 0.4) / 4);
  const bgW = faceW + 0.07;
  const capW = bgW + 0.1;
  const plateW = Math.max(0.45, faceW * 0.55);

  const bg = box(THREE, bgW, p.height, 0.2, mat(THREE, 0x101014, { roughness: 0.5 }));
  if (p.facing === 'east')  { g.rotation.y =  Math.PI / 2; }
  if (p.facing === 'west')  { g.rotation.y = -Math.PI / 2; }
  if (p.facing === 'north') { g.rotation.y =  Math.PI; }
  if (p.facing === 'south') { g.rotation.y =  0; }
  g.add(bg);
  // Kanji face — canvas-textured so each character actually shows.
  const tex = makeKanjiTexture(THREE, p.text, p.color, p.height);
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex,
    emissive: p.color,
    emissiveMap: tex,
    emissiveIntensity: 2.4,
    roughness: 0.45,
    metalness: 0.0,
  });
  const face = box(THREE, faceW, p.height - 0.4, 0.06, faceMat);
  face.position.z = 0.13;
  g.add(face);
  // Mounting brackets — visible diagonal arms running from sign back to host wall.
  // Sign sits 0.3u outside the wall, so brackets extend ~1.2u toward -z to bite
  // solidly into the building face (whatever is behind us in local space).
  const armMat = mat(THREE, 0x1a1a20, { metalness: 0.6, roughness: 0.5 });
  const armLen = 1.4;
  for (const ay of [p.height * 0.30, -p.height * 0.30]) {
    const bracket = box(THREE, 0.10, 0.10, armLen, armMat);
    bracket.position.set(0, ay, -armLen / 2);
    g.add(bracket);
    // Diagonal stay (triangle brace look)
    const stay = box(THREE, 0.07, 0.07, armLen * 0.9, armMat);
    stay.position.set(0, ay - 0.45, -armLen * 0.45);
    stay.rotation.x = Math.PI / 5;
    g.add(stay);
    // Bracket plate against sign back
    const plate = box(THREE, plateW, 0.30, 0.06, armMat);
    plate.position.set(0, ay, 0.0);
    g.add(plate);
  }
  // Top cap "shroud" hiding lamps
  const cap = box(THREE, capW, 0.18, 0.4, armMat);
  cap.position.set(0, p.height / 2 - 0.05, 0.05);
  g.add(cap);
  const capBot = box(THREE, capW, 0.18, 0.4, armMat);
  capBot.position.set(0, -p.height / 2 + 0.05, 0.05);
  g.add(capBot);
  // Tag for flicker animation (some signs broken)
  if (p.flicker && animatedOut) {
    animatedOut.push({ kind: 'signFlicker', mat: faceMat, base: 2.4, seed: Math.random() * 100 });
  }
}

function buildPowerPole(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'powerPole';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const wood = mat(THREE, 0x4a3a25, { roughness: 1 });
  const pole = cyl(THREE, 0.18, 0.22, 8.5, wood, 8);
  pole.position.y = 4.25;
  g.add(pole);
  // Cross-arms with insulators
  for (let f = 0; f < 2; f++) {
    const y = 6.5 + f * 0.9;
    const arm = box(THREE, 1.8, 0.12, 0.12, wood);
    arm.position.y = y;
    g.add(arm);
    const ins = mat(THREE, 0xeeeee5, { roughness: 0.3 });
    for (let i = -2; i <= 2; i += 2) {
      const c = cyl(THREE, 0.06, 0.06, 0.18, ins, 8);
      c.position.set(i * 0.4, y + 0.15, 0);
      g.add(c);
    }
  }
  pushAABB(colliders, p.x, p.z, 0.5, 0.5, { tier: 'hard', tag: 'pole', maxY: 8 });
}

// Cable spans between pole pairs — drawn as 4 thin parallel boxes per segment,
// matching the 4 wires per cross-arm so cables visibly connect pole-to-pole.
function buildPowerCables(THREE, sequences, parent) {
  const cableMat = mat(THREE, 0x101010, { roughness: 1 });
  for (const seq of sequences) {
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const ang = Math.atan2(dz, dx);
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      // Perpendicular unit (in XZ plane) to spread the 4 wires across cross-arm.
      const nx = -dz / len, nz = dx / len;
      for (let w = 0; w < 4; w++) {
        const offX = (w - 1.5) * 0.3;
        const yBase = 6.5 + (w & 1) * 0.9;
        const c = box(THREE, len, 0.04, 0.04, cableMat);
        c.rotation.y = -ang;
        c.position.set(cx + offX * nx, yBase, cz + offX * nz);
        parent.add(c);
      }
    }
  }
}

function buildBicycle(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'bicycle';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const fr = mat(THREE, 0x2a2a30, { metalness: 0.5, roughness: 0.5 });
  const tire = mat(THREE, 0x101010, { roughness: 1 });
  const w1 = cyl(THREE, 0.32, 0.32, 0.06, tire, 16); w1.rotation.x = Math.PI / 2; w1.position.set( 0.55, 0.32, 0); g.add(w1);
  const w2 = cyl(THREE, 0.32, 0.32, 0.06, tire, 16); w2.rotation.x = Math.PI / 2; w2.position.set(-0.55, 0.32, 0); g.add(w2);
  const frame = box(THREE, 1.1, 0.06, 0.06, fr); frame.position.y = 0.55; g.add(frame);
  const seat = box(THREE, 0.25, 0.05, 0.1, fr); seat.position.set(-0.45, 0.85, 0); g.add(seat);
  const bars = box(THREE, 0.06, 0.4, 0.5, fr); bars.position.set(0.55, 0.85, 0); g.add(bars);
  pushRotatedAABB(colliders, p.x, p.z, 1.2, 0.5, p.rot ?? 0, { tier: 'prone', tag: 'bike', maxY: 1.0 });
}

function buildKeiTruck(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'keiTruck';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const body = mat(THREE, 0xd0c8b8, { roughness: 0.6 });
  const tire = mat(THREE, 0x101010, { roughness: 1 });
  const glass = mat(THREE, 0x10242a, { metalness: 0.5, roughness: 0.2 });

  const cab = box(THREE, 1.6, 1.4, 1.5, body); cab.position.set(-1.0, 0.95, 0); g.add(cab);
  const win = box(THREE, 1.62, 0.7, 1.42, glass); win.position.set(-1.0, 1.55, 0); g.add(win);
  const bed = box(THREE, 2.2, 0.9, 1.6, body); bed.position.set(0.6, 0.65, 0); g.add(bed);
  // wheels
  for (const wx of [-1.4, 1.0]) for (const wz of [-0.8, 0.8]) {
    const w = cyl(THREE, 0.3, 0.3, 0.2, tire, 16); w.rotation.x = Math.PI / 2; w.position.set(wx, 0.3, wz); g.add(w);
  }
  pushRotatedAABB(colliders, p.x, p.z, 4.0, 1.7, p.rot ?? 0, { tier: 'hard', tag: 'truck', maxY: 2 });
}

function buildScooter(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'scooter';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const body = mat(THREE, 0xc83030, { roughness: 0.4, metalness: 0.4 });
  const tire = mat(THREE, 0x101010);
  const w1 = cyl(THREE, 0.22, 0.22, 0.08, tire, 16); w1.rotation.x = Math.PI / 2; w1.position.set( 0.55, 0.22, 0); g.add(w1);
  const w2 = cyl(THREE, 0.22, 0.22, 0.08, tire, 16); w2.rotation.x = Math.PI / 2; w2.position.set(-0.55, 0.22, 0); g.add(w2);
  const deck = box(THREE, 1.1, 0.2, 0.4, body); deck.position.y = 0.5; g.add(deck);
  const seat = box(THREE, 0.45, 0.2, 0.3, body); seat.position.set(-0.3, 0.8, 0); g.add(seat);
  const fork = box(THREE, 0.08, 0.7, 0.08, body); fork.position.set(0.55, 0.6, 0); g.add(fork);
  pushRotatedAABB(colliders, p.x, p.z, 1.4, 0.6, p.rot ?? 0, { tier: 'prone', tag: 'scooter', maxY: 1.0 });
}

function buildTrashPile(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'trashPile';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const bagMat = mat(THREE, 0x1a1a1c, { roughness: 1 });
  const count = p.count ?? 5;
  // pseudo-random but deterministic
  let seed = (Math.abs(p.x * 17 + p.z * 13) | 0) || 1;
  const rng = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) / 4294967296); };
  for (let i = 0; i < count; i++) {
    const sx = 0.7 + rng() * 0.4;
    const sy = 0.6 + rng() * 0.3;
    const sz = 0.7 + rng() * 0.4;
    const b = box(THREE, sx, sy, sz, bagMat);
    b.position.set((rng() - 0.5) * 1.6, sy / 2, (rng() - 0.5) * 1.6);
    b.rotation.y = rng() * Math.PI;
    g.add(b);
  }
  pushAABB(colliders, p.x, p.z, 2.4, 2.4, { tier: 'prone', tag: 'trash', maxY: 0.9 });
}

function buildCrateStack(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'crateStack';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const colors = [0xc04030, 0x3060c0, 0x40a040, 0xc0a040];
  const count = p.count ?? 4;
  for (let i = 0; i < count; i++) {
    const cm = mat(THREE, colors[i % colors.length], { roughness: 0.6 });
    const c = box(THREE, 0.55, 0.42, 0.4, cm);
    const row = i % 2;
    const lvl = Math.floor(i / 2);
    c.position.set(row * 0.6 - 0.3, 0.21 + lvl * 0.45, 0);
    c.rotation.y = (i * 0.07) % 0.3;
    g.add(c);
  }
  pushAABB(colliders, p.x, p.z, 1.0, 0.6, { tier: 'hard', tag: 'crates', maxY: 1.5 });
}

function buildLanternRow(THREE, p, parent, animatedOut) {
  const g = new THREE.Group();
  g.name = 'lanternRow';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const count = p.count ?? 5;
  const sp = p.spacing ?? 1.6;
  const color = p.color ?? NEON.red;
  const lit = mat(THREE, color, { emissive: color, emissiveIntensity: 1.6, roughness: 0.5 });
  const cap = mat(THREE, 0x1a0606, { roughness: 1 });
  const str = box(THREE, p.axis === 'z' ? 0.04 : sp * count, 0.03, p.axis === 'z' ? sp * count : 0.04,
    mat(THREE, 0x111111));
  str.position.set(0, 3.6, 0);
  g.add(str);
  // End posts (bamboo) so the row doesn't appear to float
  const postMat = mat(THREE, 0x4a2e1a, { roughness: 0.95 });
  const halfLen = (sp * count) / 2;
  for (const sign of [-1, 1]) {
    const post = box(THREE, 0.08, 3.6, 0.08, postMat);
    if (p.axis === 'z') post.position.set(0, 1.8, sign * halfLen);
    else                post.position.set(sign * halfLen, 1.8, 0);
    g.add(post);
  }
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * sp;
    const lx = p.axis === 'z' ? 0 : off;
    const lz = p.axis === 'z' ? off : 0;
    // Per-lantern pivot (anchored at top) so we can sway each independently.
    const pivot = new THREE.Group();
    pivot.position.set(lx, 3.6, lz);
    g.add(pivot);
    const ln = cyl(THREE, 0.22, 0.22, 0.4, lit, 12); ln.position.y = -0.6; pivot.add(ln);
    const c1 = cyl(THREE, 0.18, 0.22, 0.06, cap, 12); c1.position.y = -0.38; pivot.add(c1);
    const c2 = cyl(THREE, 0.22, 0.18, 0.06, cap, 12); c2.position.y = -0.82; pivot.add(c2);
    if (animatedOut) {
      animatedOut.push({
        kind: 'lanternSway', target: pivot,
        amp: 0.04 + Math.random() * 0.03,
        speed: 0.6 + Math.random() * 0.5,
        seed: Math.random() * 6.28,
        axis: p.axis === 'z' ? 'x' : 'z',
      });
    }
  }
}

function buildAFrame(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'aFrame';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const wood = mat(THREE, BLDG.wood, { roughness: 1 });
  const board = mat(THREE, p.color ?? NEON.yellow, { emissive: p.color ?? NEON.yellow, emissiveIntensity: 0.9 });
  const a1 = box(THREE, 0.06, 1.2, 0.7, wood); a1.position.set(0.18, 0.6, 0); a1.rotation.z =  0.18; g.add(a1);
  const a2 = box(THREE, 0.06, 1.2, 0.7, wood); a2.position.set(-0.18, 0.6, 0); a2.rotation.z = -0.18; g.add(a2);
  const f1 = box(THREE, 0.5, 0.85, 0.05, board); f1.position.set(0.0, 0.7, 0.2); f1.rotation.y = 0.3; g.add(f1);
  pushRotatedAABB(colliders, p.x, p.z, 0.9, 0.7, p.rot ?? 0, { tier: 'prone', tag: 'aframe', maxY: 1.2 });
}

function buildAcUnit(THREE, p, parent) {
  const g = new THREE.Group();
  g.name = 'acUnit';
  g.position.set(p.x, p.y ?? 4, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const m = mat(THREE, 0xb0b0b0, { roughness: 0.5, metalness: 0.4 });
  const body = box(THREE, 1.1, 0.7, 0.5, m);
  g.add(body);
  // Vent grill
  const vent = mat(THREE, 0x303030, { roughness: 0.9 });
  const v = box(THREE, 0.95, 0.55, 0.05, vent);
  v.position.z = 0.27;
  g.add(v);
  // Bracket below
  const br = box(THREE, 1.2, 0.08, 0.4, mat(THREE, 0x222222));
  br.position.set(0, -0.4, 0);
  g.add(br);
}

function buildSteamVent(THREE, p, parent, animatedOut) {
  const g = new THREE.Group();
  g.name = 'steamVent';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const m = mat(THREE, 0x222226, { roughness: 0.9 });
  const grate = box(THREE, 1.4, 0.06, 1.4, m);
  grate.position.y = 0.03;
  g.add(grate);
  // Slats
  const slat = mat(THREE, 0x111111, { roughness: 1 });
  for (let i = -3; i <= 3; i++) {
    const s = box(THREE, 1.3, 0.04, 0.08, slat);
    s.position.set(0, 0.06, i * 0.18);
    g.add(s);
  }
  // Visible steam plume — stack of translucent billows that pulse.
  const steamMat = new THREE.MeshBasicMaterial({
    color: 0xc8d8e8, transparent: true, opacity: 0.18, depthWrite: false, fog: true,
  });
  const billows = [];
  for (let i = 0; i < 5; i++) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.6 + i * 0.18, 8, 6), steamMat.clone());
    sphere.position.set((Math.random() - 0.5) * 0.2, 0.6 + i * 0.7, (Math.random() - 0.5) * 0.2);
    g.add(sphere);
    billows.push(sphere);
  }
  if (animatedOut) {
    animatedOut.push({ kind: 'steamPulse', billows, seed: Math.random() * 6.28 });
  }
  const emitter = new THREE.Object3D();
  emitter.name = 'steam_emitter';
  emitter.userData = { kind: 'steam', rate: 3, height: 4 };
  emitter.position.y = 0.1;
  g.add(emitter);
}

function buildPuddle(THREE, p, parent) {
  const g = new THREE.Group();
  g.name = 'puddle';
  g.position.set(p.x, 0.005, p.z);
  parent.add(g);
  // Subtle reflective dark patch with slight neon emissive shimmer
  const m = mat(THREE, 0x080a14, {
    emissive: 0x223a55, emissiveIntensity: 0.25,
    roughness: 0.05, metalness: 0.6,
    transparent: true, opacity: 0.92,
  });
  const w = p.w ?? 2.5, d = p.d ?? 1.5;
  const plane = box(THREE, w, 0.02, d, m);
  g.add(plane);
}

function buildFoodCart(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'foodCart';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);

  const wood = mat(THREE, BLDG.wood, { roughness: 1 });
  const tire = mat(THREE, 0x101010);
  const cloth = mat(THREE, p.color ?? NEON.orange, { emissive: p.color ?? NEON.orange, emissiveIntensity: 0.7 });

  const cart = box(THREE, 2.4, 1.0, 1.2, wood);
  cart.position.y = 0.6;
  g.add(cart);
  // Wheels
  for (const wx of [-0.9, 0.9]) {
    const w = cyl(THREE, 0.25, 0.25, 0.1, tire, 16); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.25, 0.6); g.add(w);
  }
  // Awning
  const aw = box(THREE, 2.6, 0.05, 1.5, cloth);
  aw.position.set(0, 2.4, 0);
  g.add(aw);
  // Posts
  for (const wx of [-1.1, 1.1]) for (const wz of [-0.6, 0.6]) {
    const post = box(THREE, 0.06, 1.3, 0.06, wood);
    post.position.set(wx, 1.7, wz);
    g.add(post);
  }
  // Glowing label panel
  const panel = box(THREE, 1.6, 0.5, 0.05, mat(THREE, 0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 1.2 }));
  panel.position.set(0, 2.0, 0.78);
  g.add(panel);

  pushRotatedAABB(colliders, p.x, p.z, 2.6, 1.4, p.rot ?? 0, { tier: 'hard', tag: 'foodcart', maxY: 2.5 });
}

function buildSakeBarrels(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'sakeBarrels';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  // Komodaru (straw-wrapped sake offering barrels) — cream straw, dark bands,
  // recessed wood lid, red kanji label panel on the front face.
  const straw = mat(THREE, 0xe4d6a8, { roughness: 1.0 });
  const band = mat(THREE, 0x1a0e04, { roughness: 1.0 });
  const lid = mat(THREE, 0x8a5a2c, { roughness: 0.85 });
  const label = mat(THREE, 0xc01c20, { emissive: 0x401010, emissiveIntensity: 0.6, roughness: 0.7 });
  const count = p.count ?? 6;
  // Arrange in two rows of 3 (matches old footprint).
  for (let i = 0; i < count; i++) {
    const row = i % 3;
    const lvl = Math.floor(i / 3);
    const x = (row - 1) * 1.05;
    const y = 0.6 + lvl * 1.22;
    // Body — slight bulge in middle (cyl with rTop < rMid).
    const body = cyl(THREE, 0.5, 0.5, 1.1, straw, 18);
    body.position.set(x, y, 0);
    g.add(body);
    // Top + bottom rope bands (wide, very visible).
    const bandTop = cyl(THREE, 0.54, 0.54, 0.14, band, 18);
    bandTop.position.set(x, y + 0.42, 0);
    g.add(bandTop);
    const bandBot = cyl(THREE, 0.54, 0.54, 0.14, band, 18);
    bandBot.position.set(x, y - 0.42, 0);
    g.add(bandBot);
    // Mid rope band (thinner).
    const bandMid = cyl(THREE, 0.52, 0.52, 0.08, band, 18);
    bandMid.position.set(x, y, 0);
    g.add(bandMid);
    // Recessed wooden lid.
    const cap = cyl(THREE, 0.42, 0.42, 0.08, lid, 16);
    cap.position.set(x, y + 0.59, 0);
    g.add(cap);
    // Red kanji-label panel on the front face (curved approx via thin box).
    const labelPanel = box(THREE, 0.52, 0.6, 0.04, label);
    labelPanel.position.set(x, y, 0.51);
    g.add(labelPanel);
  }
  pushRotatedAABB(colliders, p.x, p.z, 3.4, 1.2, p.rot ?? 0, { tier: 'hard', tag: 'sakebarrels', maxY: 2.6 });
}

function buildWaterTank(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'waterTank';
  g.position.set(p.x, p.y ?? TIER_ROOF, p.z);
  parent.add(g);
  const m = mat(THREE, 0x4a4a52, { roughness: 0.7, metalness: 0.4 });
  const stand = mat(THREE, 0x222226, { roughness: 0.8 });
  // Steel-frame stand: 4 legs holding the tank above the rooftop.
  const legH = 1.6;
  const legR = 1.05;
  for (const sx of [-legR, legR]) for (const sz of [-legR, legR]) {
    const leg = box(THREE, 0.12, legH, 0.12, stand);
    leg.position.set(sx, legH / 2, sz);
    g.add(leg);
  }
  // Cross-bracing between legs (X-shape on each side for visual stiffness).
  const braceMat = stand;
  const braceLen = legR * 2;
  for (const side of [-1, 1]) {
    for (const axis of ['x', 'z']) {
      const brace = box(THREE, axis === 'x' ? braceLen * 1.05 : 0.06, 0.06, axis === 'z' ? braceLen * 1.05 : 0.06, braceMat);
      const y = legH * 0.55;
      if (axis === 'x') brace.position.set(0, y, side * legR);
      else              brace.position.set(side * legR, y, 0);
      g.add(brace);
    }
  }
  // Top platform plate (legs visually connect to it; tank sits on it).
  const plate = box(THREE, legR * 2 + 0.2, 0.08, legR * 2 + 0.2, stand);
  plate.position.y = legH + 0.04;
  g.add(plate);
  // Tank body — sits on top of the plate.
  const tankH = 2.4;
  const body = cyl(THREE, 1.4, 1.4, tankH, m, 16);
  body.position.y = legH + 0.08 + tankH / 2;
  g.add(body);
  const top = cyl(THREE, 1.45, 1.45, 0.2, m, 16);
  top.position.y = legH + 0.08 + tankH + 0.1;
  g.add(top);
  pushAABB(colliders, p.x, p.z, 3.0, 3.0, { tier: 'hard', tag: 'watertank', minY: (p.y ?? TIER_ROOF), maxY: (p.y ?? TIER_ROOF) + legH + tankH + 0.5 });
}

function buildDuct(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'duct';
  g.position.set(p.x, p.y ?? TIER_ROOF, p.z);
  parent.add(g);
  const m = mat(THREE, 0x9a9a9e, { roughness: 0.5, metalness: 0.5 });
  const len = p.length ?? 6;
  const cross = 0.6;
  if (p.axis === 'z') {
    const d = box(THREE, cross, cross, len, m);
    d.position.y = cross / 2;
    g.add(d);
    pushAABB(colliders, p.x, p.z, cross, len, { tier: 'hard', tag: 'duct', minY: p.y, maxY: p.y + cross });
  } else {
    const d = box(THREE, len, cross, cross, m);
    d.position.y = cross / 2;
    g.add(d);
    pushAABB(colliders, p.x, p.z, len, cross, { tier: 'hard', tag: 'duct', minY: p.y, maxY: p.y + cross });
  }
}

function buildStoneLantern(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'stoneLantern';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const stone = mat(THREE, 0x6e6a60, { roughness: 1 });
  const lit = mat(THREE, 0xffd070, { emissive: 0xffd070, emissiveIntensity: 1.2 });
  const base = cyl(THREE, 0.35, 0.4, 0.3, stone, 8); base.position.y = 0.15; g.add(base);
  const post = cyl(THREE, 0.12, 0.15, 0.8, stone, 8); post.position.y = 0.7; g.add(post);
  const head = box(THREE, 0.55, 0.55, 0.55, stone); head.position.y = 1.4; g.add(head);
  // glowing window
  const win = box(THREE, 0.3, 0.3, 0.58, lit); win.position.y = 1.4; g.add(win);
  const cap = cyl(THREE, 0.05, 0.4, 0.18, stone, 4); cap.position.y = 1.78; g.add(cap);
  pushAABB(colliders, p.x, p.z, 0.6, 0.6, { tier: 'hard', tag: 'stonelantern', maxY: 1.9 });
}

function buildOfferingBox(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'offeringBox';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const wood = mat(THREE, BLDG.wood, { roughness: 1 });
  const lath = mat(THREE, 0x140a04, { roughness: 1 });
  const body = box(THREE, 1.6, 0.9, 0.8, wood);
  body.position.y = 0.45;
  g.add(body);
  // Slat top
  const top = box(THREE, 1.55, 0.05, 0.78, lath);
  top.position.y = 0.92;
  g.add(top);
  for (let i = -3; i <= 3; i++) {
    const s = box(THREE, 1.55, 0.04, 0.04, lath);
    s.position.set(0, 0.94, i * 0.1);
    g.add(s);
  }
  pushAABB(colliders, p.x, p.z, 1.7, 0.9, { tier: 'hard', tag: 'offeringbox', maxY: 1 });
}

function buildBollardLine(THREE, p, parent, colliders) {
  const count = p.count ?? 4;
  const sp = p.spacing ?? 1.4;
  const m = mat(THREE, 0x303034, { roughness: 0.6, metalness: 0.3 });
  const stripe = mat(THREE, 0xfff8d0, { emissive: 0xfff8d0, emissiveIntensity: 0.7 });
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * sp;
    const px = p.axis === 'x' ? p.x + off : p.x;
    const pz = p.axis === 'x' ? p.z : p.z + off;
    const c = cyl(THREE, 0.16, 0.18, 0.9, m, 12);
    c.position.set(px, 0.45, pz);
    parent.add(c);
    const s = cyl(THREE, 0.18, 0.18, 0.06, stripe, 12);
    s.position.set(px, 0.78, pz);
    parent.add(s);
    pushAABB(colliders, px, pz, 0.4, 0.4, { tier: 'hard', tag: 'bollard', maxY: 0.9 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// New building builders (billboardTower, sento, gasStation, parkingGarage,
// koban, noodleStand)
// ─────────────────────────────────────────────────────────────────────────────

function buildBillboardTower(THREE, b, g, mats, colliders) {
  buildBoxBuilding(THREE, b, g, mats, colliders, { facade: BLDG.facadeC });
  // Massive horizontal billboard wrapped around mid-tower
  const bbY = b.h * 0.5;
  const bbH = b.h * 0.22;
  const ad = b.adText ?? '歌舞伎町';
  const adC = b.neon ?? NEON.pink;
  const tex = makeBillboardTexture(THREE, ad, adC);
  const bbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, emissive: adC, emissiveMap: tex,
    emissiveIntensity: 2.0, roughness: 0.4,
  });
  for (const side of [-1, 1]) {
    const bb = box(THREE, b.w + 0.6, bbH, 0.2, bbMat);
    bb.position.set(0, bbY, side * (b.d / 2 + 0.16));
    g.add(bb);
  }
  for (const side of [-1, 1]) {
    const bb = box(THREE, 0.2, bbH, b.d + 0.6, bbMat);
    bb.position.set(side * (b.w / 2 + 0.16), bbY, 0);
    g.add(bb);
  }
  // Antenna mast on roof
  const mastMat = mat(THREE, 0x222226, { metalness: 0.4, roughness: 0.5 });
  const mast = cyl(THREE, 0.05, 0.12, b.h * 0.3, mastMat, 6);
  mast.position.set(0, b.h + b.h * 0.15 + 0.5, 0);
  g.add(mast);
  const beacon = box(THREE, 0.3, 0.3, 0.3, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 4 }));
  beacon.position.set(0, b.h + b.h * 0.3 + 0.5, 0);
  g.add(beacon);
}

function buildSento(THREE, b, g, mats, colliders) {
  // Hollow shell — wood facade, door on +Z, no roof slab (tile roof added separately)
  buildHollowShell(THREE, b, g, colliders, {
    facade: 0x584a3a,
    interiorColor: 0xc0bcb0,
    floorColor: 0xa89888,
    door: { wall: 'posZ', width: 3.4, height: 2.6 },
    doorAccentColor: NEON.cyan,
    skipRoof: true,
    skipRooftop: true,
    animated: mats?._animated,
  });
  // Tiled dark roof slab on top
  const tile = mat(THREE, 0x1c1a20, { roughness: 0.6 });
  const tileRoof = box(THREE, b.w + 1.0, 0.4, b.d + 1.0, tile);
  tileRoof.position.y = b.h + 0.4;
  g.add(tileRoof);
  // Brick chimney
  const chMat = mat(THREE, 0x6a4030, { roughness: 1 });
  const ch = box(THREE, 1.6, 8.0, 1.6, chMat);
  ch.position.set(b.w * 0.3, b.h + 4.0, -b.d * 0.25);
  g.add(ch);
  const chTop = cyl(THREE, 0.7, 0.7, 0.4, mat(THREE, 0x222222), 8);
  chTop.position.set(b.w * 0.3, b.h + 8.2, -b.d * 0.25);
  g.add(chTop);
  // Noren (cloth) over the entrance
  const noren = box(THREE, 3.4, 0.9, 0.05, mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 1.4 }));
  noren.position.set(0, 2.2, b.d / 2 + 0.05);
  g.add(noren);

  // ── Interior ─────────────────────────────────────────────────────────────
  const interior = new THREE.Group();
  interior.name = 'interior';
  g.add(interior);

  // Tile pattern stripe on the floor (entrance mat)
  const tileMat = mat(THREE, 0xd0d0d8, { roughness: 0.5 });
  const tileGrout = mat(THREE, 0x202028, { roughness: 0.8 });
  const floorTile = box(THREE, b.w - 1.2, 0.04, b.d - 1.2, tileMat);
  floorTile.position.y = 0.13;
  interior.add(floorTile);
  // Grout lines (4×4 grid)
  for (let i = 1; i < 4; i++) {
    const gx = -b.w / 2 + 0.6 + i * (b.w - 1.2) / 4;
    const gl = box(THREE, 0.05, 0.045, b.d - 1.2, tileGrout);
    gl.position.set(gx, 0.135, 0);
    interior.add(gl);
  }
  for (let i = 1; i < 4; i++) {
    const gz = -b.d / 2 + 0.6 + i * (b.d - 1.2) / 4;
    const gl = box(THREE, b.w - 1.2, 0.045, 0.05, tileGrout);
    gl.position.set(0, 0.135, gz);
    interior.add(gl);
  }

  // Lockers along the -x wall (rows of small wooden cubbies)
  const lockerMat = mat(THREE, BLDG.wood, { roughness: 1 });
  const lockerDoor = mat(THREE, 0x4a3018, { roughness: 0.8 });
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 8; i++) {
      const lx = -b.w / 2 + 0.45;
      const lz = -(b.d / 2 - 1.2) + i * ((b.d - 2.4) / 7);
      const ly = 0.5 + row * 0.95;
      const cubby = box(THREE, 0.4, 0.85, (b.d - 2.4) / 7 - 0.05, lockerMat);
      cubby.position.set(lx, ly, lz);
      interior.add(cubby);
      const door = box(THREE, 0.04, 0.75, (b.d - 2.4) / 7 - 0.15, lockerDoor);
      door.position.set(lx + 0.22, ly, lz);
      interior.add(door);
      // Tiny number plate
      const plate = box(THREE, 0.02, 0.1, 0.12, mat(THREE, 0xe0d8b0, { emissive: 0xe0d8b0, emissiveIntensity: 0.4 }));
      plate.position.set(lx + 0.245, ly + 0.25, lz);
      interior.add(plate);
    }
  }

  // Tiled bathing pool — sunken rectangle in the center-back
  const poolMat = mat(THREE, 0xa8c8d8, { roughness: 0.4, metalness: 0.1 });
  const poolWall = mat(THREE, 0x6090a0, { roughness: 0.6 });
  const poolWidth = b.w - 7;
  const poolDepth = b.d - 7;
  const poolCx = 1.5, poolCz = -1.0;
  // Pool walls (4 sides)
  const pwT = 0.4;
  const pwL = box(THREE, pwT, 0.5, poolDepth, poolWall);
  pwL.position.set(poolCx - poolWidth / 2 + pwT / 2, 0.3, poolCz);
  interior.add(pwL);
  const pwR = box(THREE, pwT, 0.5, poolDepth, poolWall);
  pwR.position.set(poolCx + poolWidth / 2 - pwT / 2, 0.3, poolCz);
  interior.add(pwR);
  const pwF = box(THREE, poolWidth, 0.5, pwT, poolWall);
  pwF.position.set(poolCx, 0.3, poolCz + poolDepth / 2 - pwT / 2);
  interior.add(pwF);
  const pwB = box(THREE, poolWidth, 0.5, pwT, poolWall);
  pwB.position.set(poolCx, 0.3, poolCz - poolDepth / 2 + pwT / 2);
  interior.add(pwB);
  // Pool water (translucent surface inside walls)
  const water = box(THREE, poolWidth - pwT * 2, 0.05, poolDepth - pwT * 2, mat(THREE, 0xa0d8e8, {
    transparent: true, opacity: 0.6,
    emissive: 0x408090, emissiveIntensity: 0.3, roughness: 0.2,
  }));
  water.position.set(poolCx, 0.4, poolCz);
  interior.add(water);
  // Pool collider as a low wall (prone-tier so you can crouch over)
  pushAABB(colliders, b.x + poolCx - poolWidth / 2 + pwT / 2, b.z + poolCz, pwT, poolDepth, { tier: 'prone', tag: b.id, maxY: 0.55 });
  pushAABB(colliders, b.x + poolCx + poolWidth / 2 - pwT / 2, b.z + poolCz, pwT, poolDepth, { tier: 'prone', tag: b.id, maxY: 0.55 });
  pushAABB(colliders, b.x + poolCx, b.z + poolCz + poolDepth / 2 - pwT / 2, poolWidth, pwT, { tier: 'prone', tag: b.id, maxY: 0.55 });
  pushAABB(colliders, b.x + poolCx, b.z + poolCz - poolDepth / 2 + pwT / 2, poolWidth, pwT, { tier: 'prone', tag: b.id, maxY: 0.55 });

  // Washing stations: low stools and bucket pairs along the +x wall
  const stoolMat = mat(THREE, 0xc8b888, { roughness: 0.7 });
  const bucketMat = mat(THREE, 0xa06030, { roughness: 0.7 });
  for (let i = -2; i <= 2; i++) {
    const wz = i * 1.4;
    const stool = cyl(THREE, 0.2, 0.2, 0.18, stoolMat, 12);
    stool.position.set(b.w / 2 - 1.0, 0.22, wz);
    interior.add(stool);
    const bucket = cyl(THREE, 0.2, 0.18, 0.25, bucketMat, 12);
    bucket.position.set(b.w / 2 - 1.6, 0.25, wz);
    interior.add(bucket);
    // Tap on wall above
    const tap = box(THREE, 0.04, 0.12, 0.06, mat(THREE, 0xc0c0c8, { metalness: 0.7, roughness: 0.3 }));
    tap.position.set(b.w / 2 - 0.4, 1.4, wz);
    interior.add(tap);
    const tapHandle = cyl(THREE, 0.05, 0.05, 0.05, mat(THREE, 0xc02020), 8);
    tapHandle.position.set(b.w / 2 - 0.4, 1.55, wz);
    interior.add(tapHandle);
  }

  // Mt-Fuji style mural on the back wall (-z)
  const muralBg = box(THREE, b.w - 1.4, 2.4, 0.04, mat(THREE, 0xc0e8ff, { emissive: 0xc0e8ff, emissiveIntensity: 0.3 }));
  muralBg.position.set(0, 3.4, -b.d / 2 + 0.34);
  interior.add(muralBg);
  // Mountain triangle (rotated box)
  const peak = box(THREE, 4.0, 1.4, 0.06, mat(THREE, 0x4060a0, { roughness: 0.7 }));
  peak.rotation.z = Math.PI / 4;
  peak.position.set(-1.5, 3.0, -b.d / 2 + 0.36);
  interior.add(peak);
  const peakSnow = box(THREE, 1.2, 0.45, 0.06, mat(THREE, 0xf0f0ff, { emissive: 0xf0f0ff, emissiveIntensity: 0.4 }));
  peakSnow.position.set(-1.5, 4.0, -b.d / 2 + 0.36);
  interior.add(peakSnow);

  // Ceiling-mounted warm bulbs
  for (let i = -1; i <= 1; i++) {
    const bulb = cyl(THREE, 0.18, 0.18, 0.06, mat(THREE, 0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 1.6 }), 12);
    bulb.position.set(i * 4, 4.3, 0);
    interior.add(bulb);
  }
}

function buildGasStation(THREE, b, g, mats) {
  // Small store building (smaller than the lot)
  const storeW = b.w * 0.5, storeD = b.d * 0.55;
  const facade = mat(THREE, 0xb8b0a0, { roughness: 0.85 });
  const store = box(THREE, storeW, b.h, storeD, facade);
  store.position.set(b.w / 2 - storeW / 2, b.h / 2, -b.d / 2 + storeD / 2);
  g.add(store);
  const storeRoof = box(THREE, storeW + 0.3, 0.2, storeD + 0.3, mat(THREE, BLDG.concrete));
  storeRoof.position.set(b.w / 2 - storeW / 2, b.h + 0.1, -b.d / 2 + storeD / 2);
  g.add(storeRoof);
  // Glass storefront
  const glass = mat(THREE, 0xa8d8ff, { emissive: 0xffeec0, emissiveIntensity: 0.5, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const front = box(THREE, storeW - 0.6, b.h - 0.8, 0.05, glass);
  front.position.set(b.w / 2 - storeW / 2, b.h / 2, -b.d / 2 + storeD - 0.04);
  g.add(front);
  // Forecourt canopy
  const canopyMat = mat(THREE, 0xcc2020, { roughness: 0.7 });
  const canopy = box(THREE, b.w * 0.85, 0.6, b.d * 0.55, canopyMat);
  canopy.position.set(-b.w * 0.05, 4.6, b.d * 0.18);
  g.add(canopy);
  // Canopy strip lights
  const strip = mat(THREE, NEON.white, { emissive: NEON.white, emissiveIntensity: 2.5 });
  const stripBox = box(THREE, b.w * 0.85, 0.15, 0.1, strip);
  stripBox.position.set(-b.w * 0.05, 4.3, b.d * 0.18 + b.d * 0.27);
  g.add(stripBox);
  // 4 pillars
  const pillarMat = mat(THREE, 0x444448, { metalness: 0.4, roughness: 0.5 });
  for (const px of [-b.w * 0.4, b.w * 0.3]) for (const pz of [-b.d * 0.1, b.d * 0.4]) {
    const p = box(THREE, 0.5, 4.6, 0.5, pillarMat);
    p.position.set(px, 2.3, pz);
    g.add(p);
  }
  // 2 pumps
  for (const px of [-b.w * 0.2, b.w * 0.1]) {
    const pumpBody = box(THREE, 0.7, 1.5, 1.0, mat(THREE, 0xe8e8e8, { roughness: 0.6 }));
    pumpBody.position.set(px, 0.75, b.d * 0.18);
    g.add(pumpBody);
    const pumpScreen = box(THREE, 0.55, 0.4, 0.04, mat(THREE, NEON.green, { emissive: NEON.green, emissiveIntensity: 1.4 }));
    pumpScreen.position.set(px, 1.2, b.d * 0.18 + 0.51);
    g.add(pumpScreen);
  }
  // ENEOS-style sign on a tall pole
  const polePost = mat(THREE, 0x2a2a30, { metalness: 0.6, roughness: 0.4 });
  const pp = cyl(THREE, 0.15, 0.18, 7.0, polePost, 8);
  pp.position.set(-b.w * 0.45, 3.5, -b.d * 0.4);
  g.add(pp);
  const ppSign = box(THREE, 2.2, 1.2, 0.2, mat(THREE, NEON.orange, { emissive: NEON.orange, emissiveIntensity: 2.2 }));
  ppSign.position.set(-b.w * 0.45, 6.8, -b.d * 0.4);
  g.add(ppSign);
}

// Build one parked car body matching the traffic-vehicle visual style.
// kind: 'sedan'|'taxi'|'van'|'sportsCar'|'kei'|'policeCar'.  Returns a Group.
// Car local-forward is +X; call with rotation.y to face it toward the aisle.
function buildParkedCar(THREE, color, kind) {
  const g   = new THREE.Group();
  const bm  = mat(THREE, color, { roughness: 0.6, metalness: 0.3 });
  const gls = mat(THREE, 0x10141c, { roughness: 0.3, metalness: 0.5 });
  const tire = mat(THREE, 0x101010, { roughness: 1 });
  const head = mat(THREE, NEON.white, { emissive: NEON.white, emissiveIntensity: 2.5 });
  const tail = mat(THREE, NEON.red,   { emissive: NEON.red,   emissiveIntensity: 2.0 });

  let headX, tailX, wheelXs;

  if (kind === 'van') {
    const main = box(THREE, 4.6, 1.8, 1.9, bm); main.position.y = 1.0; g.add(main);
    const win  = box(THREE, 1.4, 0.7, 1.84, gls); win.position.set(1.4, 1.4, 0); g.add(win);
    headX = 2.0; tailX = -2.0; wheelXs = [-1.5, 1.5];
  } else if (kind === 'sportsCar') {
    const lower = box(THREE, 4.4, 0.5, 1.85, bm); lower.position.y = 0.32; g.add(lower);
    const cabin = box(THREE, 1.9, 0.45, 1.65, bm); cabin.position.set(-0.5, 0.79, 0); g.add(cabin);
    const wedge = box(THREE, 1.3, 0.32, 1.65, bm); wedge.position.set(1.3, 0.71, 0); g.add(wedge);
    const win   = box(THREE, 1.85, 0.35, 1.6, gls); win.position.set(-0.5, 0.83, 0); g.add(win);
    const glow  = box(THREE, 4.2, 0.04, 1.7, mat(THREE, color, { emissive: color, emissiveIntensity: 1.0 }));
    glow.position.y = 0.05; g.add(glow);
    headX = 2.0; tailX = -2.0; wheelXs = [-1.7, 1.7];
  } else if (kind === 'kei') {
    const cab = box(THREE, 1.7, 1.5, 1.6, bm); cab.position.set(-0.65, 0.95, 0); g.add(cab);
    const win = box(THREE, 1.65, 0.55, 1.66, gls); win.position.set(-0.65, 1.42, 0); g.add(win);
    const bed = box(THREE, 1.4, 0.9, 1.55, bm); bed.position.set(0.95, 0.65, 0); g.add(bed);
    headX = 1.35; tailX = -1.45; wheelXs = [-1.5, 1.5];
  } else if (kind === 'taxi') {
    const lower = box(THREE, 4.0, 0.7, 1.7, bm); lower.position.y = 0.4; g.add(lower);
    const cabin = box(THREE, 2.5, 0.7, 1.6, bm); cabin.position.set(-0.2, 1.05, 0); g.add(cabin);
    const win   = box(THREE, 2.4, 0.55, 1.66, gls); win.position.set(-0.2, 1.05, 0); g.add(win);
    const sign  = box(THREE, 0.6, 0.25, 0.4, mat(THREE, NEON.yellow, { emissive: NEON.yellow, emissiveIntensity: 2.0 }));
    sign.position.set(-0.2, 1.55, 0); g.add(sign);
    headX = 2.0; tailX = -2.0; wheelXs = [-1.5, 1.5];
  } else if (kind === 'policeCar') {
    const lower = box(THREE, 4.4, 0.7, 1.7, bm); lower.position.y = 0.4; g.add(lower);
    const cabin = box(THREE, 2.4, 0.7, 1.6, mat(THREE, 0xf0f0f0, { roughness: 0.6 }));
    cabin.position.set(-0.2, 1.05, 0); g.add(cabin);
    const win   = box(THREE, 2.3, 0.55, 1.66, gls); win.position.set(-0.2, 1.05, 0); g.add(win);
    const barB  = box(THREE, 1.4, 0.12, 0.4, mat(THREE, 0x101014)); barB.position.set(-0.2, 1.48, 0); g.add(barB);
    const lR    = box(THREE, 0.6, 0.18, 0.34, mat(THREE, NEON.red,  { emissive: NEON.red,  emissiveIntensity: 2.5 }));
    lR.position.set(-0.55, 1.66, 0); g.add(lR);
    const lB    = box(THREE, 0.6, 0.18, 0.34, mat(THREE, 0x2050ff,  { emissive: 0x2050ff, emissiveIntensity: 2.5 }));
    lB.position.set( 0.15, 1.66, 0); g.add(lB);
    headX = 2.0; tailX = -2.0; wheelXs = [-1.5, 1.5];
  } else { // sedan (default)
    const lower = box(THREE, 4.2, 0.7, 1.7, bm); lower.position.y = 0.4; g.add(lower);
    const cabin = box(THREE, 2.2, 0.6, 1.6, bm); cabin.position.set(-0.2, 1.05, 0); g.add(cabin);
    const win   = box(THREE, 2.1, 0.45, 1.66, gls); win.position.set(-0.2, 1.1, 0); g.add(win);
    headX = 2.0; tailX = -2.0; wheelXs = [-1.5, 1.5];
  }

  // Headlights + taillights
  const hf = box(THREE, 0.25, 0.18, 0.06, head); hf.position.set(headX, 0.55, -0.5); g.add(hf);
  const hf2 = hf.clone(); hf2.position.z = 0.5; g.add(hf2);
  const tf  = box(THREE, 0.2, 0.15, 0.06, tail); tf.position.set(tailX, 0.55, -0.5); g.add(tf);
  const tf2 = tf.clone(); tf2.position.z = 0.5; g.add(tf2);
  // Wheels — axis along Z (rotation.x = π/2)
  for (const wx of wheelXs) for (const wz of [-0.8, 0.8]) {
    const w = cyl(THREE, 0.32, 0.32, 0.18, tire, 12); w.rotation.x = Math.PI / 2;
    w.position.set(wx, 0.32, wz); g.add(w);
  }
  return g;
}

function buildParkingGarage(THREE, b, g, mats) {
  const concrete = mat(THREE, BLDG.concrete, { roughness: 0.95 });
  const trim = mat(THREE, 0x1a1a1e, { roughness: 0.6 });
  const floors = Math.max(2, Math.floor(b.h / 3.5));
  const floorH = b.h / floors;
  // Floor slabs + perimeter pillars
  for (let f = 0; f <= floors; f++) {
    const y = f * floorH;
    const slab = box(THREE, b.w, 0.3, b.d, concrete);
    slab.position.y = y + 0.15;
    g.add(slab);
    // Edge band (where parked cars peek out)
    if (f > 0 && f < floors) {
      for (const side of [-1, 1]) {
        const band = box(THREE, b.w + 0.3, 0.6, 0.2, trim);
        band.position.set(0, y + 0.6, side * (b.d / 2));
        g.add(band);
        const band2 = box(THREE, 0.2, 0.6, b.d + 0.3, trim);
        band2.position.set(side * (b.w / 2), y + 0.6, 0);
        g.add(band2);
      }
    }
  }
  // Corner pillars
  for (const px of [-b.w / 2 + 0.6, b.w / 2 - 0.6]) for (const pz of [-b.d / 2 + 0.6, b.d / 2 - 0.6]) {
    const pl = box(THREE, 0.6, b.h, 0.6, concrete);
    pl.position.set(px, b.h / 2, pz);
    g.add(pl);
  }

  // ── Parked cars ───────────────────────────────────────────────────────────
  // Two rows per floor: one along +z wall (nose toward -z aisle), one along -z wall.
  // Cars are oriented with local +X = forward; we rotate 90° so they park nose-in
  // from the +z or -z side (car length runs along z, nose toward centre aisle).
  const carKinds  = ['sedan','sedan','taxi','van','sportsCar','kei','policeCar','sedan'];
  const carColors = [0x303035, 0x80201a, 0x202d40, 0x807260, 0x1a4030,
                     0xb0b0b8, 0xf0f0f0, 0x604020, 0x304060, 0x803028];
  // Spacing along X: 5 cars across the 26u width (usable: ~22u, pitch ~4.4u)
  const carCount  = 5;
  const pitch     = (b.w - 4) / (carCount - 1);  // ~5.5u between car centers
  const rowZ      = b.d / 2 - 2.6;               // distance from centre to parked-row centre

  for (let f = 0; f < floors; f++) {
    const baseY = f * floorH + 0.3;
    for (let i = 0; i < carCount; i++) {
      const cx = -b.w / 2 + 2 + i * pitch;
      const seed = f * 20 + i;
      const skip = _bldgRand('garage', seed) < 0.18; // ~18% empty spaces
      if (skip) continue;
      const kindIdx  = Math.floor(_bldgRand('garageK', seed) * carKinds.length);
      const colorIdx = Math.floor(_bldgRand('garageC', seed) * carColors.length);
      const kind  = carKinds[kindIdx];
      const color = carColors[colorIdx];

      // Row A: +z side — car noses point toward -z (rotation.y = +π/2 so +X local → -Z world)
      const carA = buildParkedCar(THREE, color, kind);
      carA.position.set(cx, baseY, rowZ);
      carA.rotation.y = Math.PI / 2;   // local +X → world -Z (nose toward aisle centre)
      g.add(carA);

      // Row B: -z side — same car mirrored (rotation.y = -π/2 so +X → +Z world)
      const colorB = carColors[(_bldgRand('garageC2', seed) * carColors.length) | 0];
      const kindB  = carKinds[(_bldgRand('garageK2', seed) * carKinds.length) | 0];
      const skipB  = _bldgRand('garageS2', seed) < 0.18;
      if (!skipB) {
        const carB = buildParkedCar(THREE, colorB, kindB);
        carB.position.set(cx, baseY, -rowZ);
        carB.rotation.y = -Math.PI / 2;
        g.add(carB);
      }
    }
  }

  // Entrance sign
  const sign = box(THREE, 4.0, 1.0, 0.3, mat(THREE, NEON.yellow, { emissive: NEON.yellow, emissiveIntensity: 1.8 }));
  sign.position.set(0, b.h + 0.6, b.d / 2 + 0.16);
  g.add(sign);
}

function buildKoban(THREE, b, g, mats) {
  // Tiny police box — cubic, blue/white painted, lantern on top
  const wallMat = mat(THREE, 0xe8e8ec, { roughness: 0.85 });
  const stripeMat = mat(THREE, 0x2a3a8a, { roughness: 0.7 });
  const main = box(THREE, b.w, b.h, b.d, wallMat);
  main.position.y = b.h / 2;
  g.add(main);
  // Stripe protrudes from main walls cleanly (depth offset by 0.06 each side)
  const stripe = box(THREE, b.w + 0.12, 0.4, b.d + 0.12, stripeMat);
  stripe.position.y = b.h - 1.2;
  g.add(stripe);
  const roof = box(THREE, b.w + 0.4, 0.25, b.d + 0.4, mat(THREE, 0x1a1a1e));
  roof.position.y = b.h + 0.12;
  g.add(roof);
  // Red lantern globe on top
  const lan = cyl(THREE, 0.45, 0.45, 0.7, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 2.4 }), 12);
  lan.position.y = b.h + 0.6;
  g.add(lan);
  // Glass front door — protrudes cleanly past the main wall front face
  const door = box(THREE, b.w * 0.4, b.h - 0.6, 0.08, mat(THREE, 0x88ccff, { emissive: 0xffeec0, emissiveIntensity: 0.6, transparent: true, opacity: 0.45 }));
  door.position.set(0, (b.h - 0.6) / 2 + 0.3, b.d / 2 + 0.05);
  g.add(door);
  // KOBAN sign — sits above the stripe band, past the wall front face
  const sgn = box(THREE, b.w * 0.7, 0.4, 0.06, mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 1.8 }));
  sgn.position.set(0, b.h - 0.45, b.d / 2 + 0.08);
  g.add(sgn);
}

function buildNoodleStand(THREE, b, g, mats, colliders) {
  // Small wooden noodle stall — open front, red lanterns inside
  const wood = mat(THREE, BLDG.wood, { roughness: 1 });
  // Counter/back/sides
  const back = box(THREE, b.w, b.h, 0.2, wood);
  back.position.set(0, b.h / 2, -b.d / 2 + 0.1);
  g.add(back);
  const left = box(THREE, 0.2, b.h, b.d, wood);
  left.position.set(-b.w / 2 + 0.1, b.h / 2, 0);
  g.add(left);
  const right = box(THREE, 0.2, b.h, b.d, wood);
  right.position.set(b.w / 2 - 0.1, b.h / 2, 0);
  g.add(right);
  if (colliders) {
    pushAABB(colliders, b.x, b.z + (-b.d / 2 + 0.1), b.w, 0.2, {
      tier: 'hard', category: 'solid', tag: `${b.id}_noodleBack`, maxY: b.h,
    });
    pushAABB(colliders, b.x + (-b.w / 2 + 0.1), b.z, 0.2, b.d, {
      tier: 'hard', category: 'solid', tag: `${b.id}_noodleL`, maxY: b.h,
    });
    pushAABB(colliders, b.x + (b.w / 2 - 0.1), b.z, 0.2, b.d, {
      tier: 'hard', category: 'solid', tag: `${b.id}_noodleR`, maxY: b.h,
    });
    // Counter — chest-high cover
    pushAABB(colliders, b.x, b.z + (b.d / 2 - 0.4), b.w * 0.85, 0.6, {
      tier: 'prone', category: 'cover', tag: `${b.id}_noodleCounter`, maxY: 1.1,
    });
  }
  // Roof — tiled-style dark slab with small overhang
  const roof = box(THREE, b.w + 1.6, 0.3, b.d + 1.0, mat(THREE, 0x2a1f18, { roughness: 0.7 }));
  roof.position.y = b.h + 0.15;
  g.add(roof);
  // Counter on the front
  const counter = box(THREE, b.w * 0.85, 1.1, 0.6, wood);
  counter.position.set(0, 0.55, b.d / 2 - 0.4);
  g.add(counter);
  // Stools facing out
  for (let i = -1; i <= 1; i++) {
    const stool = cyl(THREE, 0.18, 0.2, 0.5, wood, 8);
    stool.position.set(i * (b.w * 0.3), 0.25, b.d / 2 + 0.4);
    g.add(stool);
  }
  // Inside steam-glow + lantern
  const lan = cyl(THREE, 0.22, 0.22, 0.5, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 2.2 }), 12);
  lan.position.set(-b.w * 0.3, b.h - 0.6, 0);
  g.add(lan);
  const lan2 = cyl(THREE, 0.22, 0.22, 0.5, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 2.2 }), 12);
  lan2.position.set(b.w * 0.3, b.h - 0.6, 0);
  g.add(lan2);
  // Sign
  const signTex = makeBillboardTexture(THREE, b.sign ?? 'ラーメン', NEON.yellow);
  const signMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: signTex, emissive: NEON.yellow, emissiveMap: signTex,
    emissiveIntensity: 1.8, roughness: 0.5,
  });
  const sg = box(THREE, b.w * 1.2, 0.7, 0.12, signMat);
  sg.position.set(0, b.h + 0.7, b.d / 2 + 0.45);
  g.add(sg);
}

// ─────────────────────────────────────────────────────────────────────────────
// New prop builders — destructibles, hazards, varied cover, micro-detail.
// ─────────────────────────────────────────────────────────────────────────────

function buildBillboard(THREE, p, parent, colliders) {
  // Standalone wall billboard on a 2-pole frame.
  const g = new THREE.Group();
  g.name = 'billboard';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const w = p.w ?? 8, h = p.h ?? 4;
  const poleMat = mat(THREE, 0x2a2a30, { metalness: 0.5, roughness: 0.5 });
  for (const px of [-w * 0.35, w * 0.35]) {
    const pole = box(THREE, 0.3, 8, 0.3, poleMat);
    pole.position.set(px, 4, 0);
    g.add(pole);
  }
  const tex = makeBillboardTexture(THREE, p.text ?? '東京', p.color ?? NEON.pink);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, emissive: p.color ?? NEON.pink, emissiveMap: tex,
    emissiveIntensity: 2.2, roughness: 0.4,
  });
  const face = box(THREE, w, h, 0.2, m);
  face.position.set(0, 7, 0);
  g.add(face);
  // Underlight bar
  const bar = box(THREE, w + 0.4, 0.18, 0.5, mat(THREE, NEON.white, { emissive: NEON.white, emissiveIntensity: 2.2 }));
  bar.position.set(0, 5 - 0.2, 0.4);
  g.add(bar);
  // Two poles spaced apart along local X (rotates with billboard)
  const wBill = w;
  for (const localPx of [-wBill * 0.35, wBill * 0.35]) {
    pushRotatedAABB(colliders, p.x, p.z, 0.3, 0.3, p.rot ?? 0, {
      ox: localPx, tier: 'hard', tag: 'billboardpole', maxY: 8,
    });
  }
}

function buildHangingSign(THREE, p, parent, colliders, animatedOut) {
  // Sign hanging by chains from a freestanding street pole (lamppost-style).
  // The pole goes from ground all the way up to the chain top — unambiguous support.
  const g = new THREE.Group();
  g.name = 'hangingSign';
  const baseY = p.y ?? 5.5;
  g.position.set(p.x, baseY, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  // Pole offset from sign hang point (so sign hangs out from pole)
  const POLE_DIRS = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] };
  const dir = POLE_DIRS[p.attach ?? 'west'];
  const poleOffset = p.armLen ?? 1.8;
  const px = dir[0] * poleOffset;
  const pz = dir[1] * poleOffset;
  // Pole material — slightly emissive dark steel so it's visible at night
  const poleMat = mat(THREE, 0x2a2a32, { metalness: 0.7, roughness: 0.4, emissive: 0x141418, emissiveIntensity: 0.4 });
  // In group-local: ground = -baseY, chain-top = +1.4
  const poleH = baseY + 1.4;
  const pole = box(THREE, 0.22, poleH, 0.22, poleMat);
  pole.position.set(px, 1.4 - poleH / 2, pz);
  g.add(pole);
  // Round-ish base flange at ground level
  const flange = box(THREE, 0.55, 0.16, 0.55, poleMat);
  flange.position.set(px, -baseY + 0.08, pz);
  g.add(flange);
  const flangeBolt = mat(THREE, 0x404048, { metalness: 0.9, roughness: 0.3 });
  for (const bx of [-0.18, 0.18]) for (const bz of [-0.18, 0.18]) {
    const b = box(THREE, 0.05, 0.06, 0.05, flangeBolt);
    b.position.set(px + bx, -baseY + 0.18, pz + bz);
    g.add(b);
  }
  // Top cap just above the cantilever
  const cap = box(THREE, 0.28, 0.1, 0.28, poleMat);
  cap.position.set(px, 1.55, pz);
  g.add(cap);
  // Cantilever arm — from pole top to chain hang point at origin
  const armW = Math.max(Math.abs(px), 0.16);
  const armD = Math.max(Math.abs(pz), 0.16);
  const arm = box(THREE, armW, 0.16, armD, poleMat);
  arm.position.set(px / 2, 1.4, pz / 2);
  g.add(arm);
  // Diagonal brace from pole (lower) down to arm midpoint — adds structural feel
  const braceLen = Math.hypot(poleOffset * 0.6, 0.55);
  const brace = box(THREE,
    dir[0] !== 0 ? braceLen : 0.08, 0.08,
    dir[1] !== 0 ? braceLen : 0.08, poleMat);
  brace.position.set(px * 0.7, 1.4 - 0.3, pz * 0.7);
  brace.rotation.z = (dir[0] !== 0) ? Math.atan2(0.55, poleOffset * 0.6) * Math.sign(dir[0]) : 0;
  brace.rotation.x = (dir[1] !== 0) ? -Math.atan2(0.55, poleOffset * 0.6) * Math.sign(dir[1]) : 0;
  g.add(brace);
  // Chains
  const chainMat = poleMat;
  for (const cx of [-0.7, 0.7]) {
    const chain = box(THREE, 0.06, 1.4, 0.06, chainMat);
    chain.position.set(cx, 0.7, 0);
    g.add(chain);
  }
  // Top eyelets where chains attach to the arm
  for (const cx of [-0.7, 0.7]) {
    const eye = box(THREE, 0.12, 0.12, 0.12, poleMat);
    eye.position.set(cx, 1.33, 0);
    g.add(eye);
  }
  // Pole collider so players can't walk through it
  if (colliders) {
    const wx = p.x + px, wz = p.z + pz;
    pushAABB(colliders, wx, wz, 0.4, 0.4, { tier: 'hard', minY: 0, maxY: poleH, tag: 'hangingSignPole' });
  }
  // Sign body (kanji texture)
  const tex = makeKanjiTexture(THREE, p.text ?? '酒', p.color ?? NEON.red, 2.0);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, emissive: p.color ?? NEON.red, emissiveMap: tex,
    emissiveIntensity: 2.0, roughness: 0.5,
  });
  const sw = p.w ?? 1.8, sh = p.h ?? 2.2;
  const swing = new THREE.Group();
  swing.position.set(0, -1.4, 0); // pivot at chain top, sign below
  g.add(swing);
  const face = box(THREE, sw, sh, 0.12, m);
  face.position.y = -sh / 2;
  swing.add(face);
  if (animatedOut) {
    animatedOut.push({ kind: 'hangingSway', target: swing, base: 0, amp: 0.04, speed: 0.7 + Math.random() * 0.5, seed: Math.random() * 6 });
  }
  // No collider — overhead, bullets pass; chains are destructible (engine-side flag).
  g.userData = { destructible: true, kind: 'hangingSign', hp: 30 };
}

function buildGasMain(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'gasMain';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const pipe = mat(THREE, 0xb8a000, { metalness: 0.6, roughness: 0.5 });
  const valve = mat(THREE, 0xc02020, { metalness: 0.5, roughness: 0.4 });
  // Vertical riser
  const riser = cyl(THREE, 0.18, 0.2, 1.6, pipe, 12);
  riser.position.y = 0.8;
  g.add(riser);
  // Horizontal section
  const horiz = cyl(THREE, 0.18, 0.2, 1.4, pipe, 12);
  horiz.rotation.z = Math.PI / 2;
  horiz.position.set(0.7, 1.6, 0);
  g.add(horiz);
  // Valve wheel
  const wheel = cyl(THREE, 0.32, 0.32, 0.06, valve, 12);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(0, 1.2, 0.32);
  g.add(wheel);
  // Warning placard
  const warn = box(THREE, 0.4, 0.3, 0.05, mat(THREE, NEON.yellow, { emissive: NEON.yellow, emissiveIntensity: 1.4 }));
  warn.position.set(0, 0.4, 0.21);
  g.add(warn);
  pushRotatedAABB(colliders, p.x, p.z, 0.6, 0.6, p.rot ?? 0, { tier: 'hard', tag: 'gasmain', maxY: 1.8 });
  g.userData = { destructible: true, kind: 'gasMain', hp: 20, explodes: true, blastRadius: 6 };
}

function buildCrashedCar(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'crashedCar';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = (p.rot ?? 0) + (Math.random() - 0.5) * 0.4;
  parent.add(g);
  const body = mat(THREE, p.color ?? 0x40201a, { roughness: 0.7, metalness: 0.3 });
  const tire = mat(THREE, 0x101010, { roughness: 1 });
  const glass = mat(THREE, 0x10141c, { roughness: 0.3, metalness: 0.5 });
  const tilt = (p.tilt ?? 0.18);
  // Lower body — crumpled
  const lower = box(THREE, 4.0, 0.7, 1.7, body);
  lower.position.set(0, 0.35, 0);
  lower.rotation.z = tilt;
  g.add(lower);
  // Upper cabin tilted
  const cabin = box(THREE, 2.4, 0.8, 1.6, body);
  cabin.position.set(-0.2, 1.05, 0);
  cabin.rotation.z = tilt * 1.4;
  g.add(cabin);
  // Smashed windshield
  const ws = box(THREE, 1.5, 0.6, 1.55, glass);
  ws.position.set(-0.2, 1.0, 0);
  ws.rotation.z = tilt * 1.4;
  g.add(ws);
  // Wheels — one popped off
  for (const wx of [-1.4, 1.4]) for (const wz of [-0.85, 0.85]) {
    if (wx === -1.4 && wz === -0.85) continue;
    const w = cyl(THREE, 0.34, 0.34, 0.22, tire, 12); w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.34, wz);
    g.add(w);
  }
  const popped = cyl(THREE, 0.34, 0.34, 0.22, tire, 12); popped.rotation.x = Math.PI / 2;
  popped.position.set(-1.8, 0.34, -1.4);
  g.add(popped);
  // Crumpled hood detail
  const hood = box(THREE, 1.3, 0.15, 1.5, body);
  hood.position.set(1.5, 0.85, 0); hood.rotation.z = -0.25;
  g.add(hood);
  pushRotatedAABB(colliders, p.x, p.z, 4.2, 1.9, p.rot ?? 0, { tier: 'hard', tag: 'crashcar', maxY: 1.8 });
}

function buildTippedDumpster(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'tippedDumpster';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const tipped = p.tipped ?? false;
  const m = mat(THREE, p.color ?? 0x4a5048, { roughness: 0.85, metalness: 0.2 });
  const lid = mat(THREE, 0x222226, { roughness: 0.7 });
  const body = box(THREE, 2.6, 1.6, 1.4, m);
  const lidMesh = box(THREE, 2.65, 0.1, 1.45, lid);
  if (tipped) {
    body.rotation.z = Math.PI / 2;
    body.position.set(0, 0.7, 0);
    lidMesh.rotation.z = Math.PI / 2;
    lidMesh.position.set(-0.85, 0.7, 0);
    pushRotatedAABB(colliders, p.x, p.z, 1.6, 1.4, p.rot ?? 0, { tier: 'hard', tag: 'dumpster', maxY: 1.4 });
  } else {
    body.position.y = 0.8;
    lidMesh.position.y = 1.65;
    lidMesh.rotation.z = -0.15;
    pushRotatedAABB(colliders, p.x, p.z, 2.6, 1.4, p.rot ?? 0, { tier: 'hard', tag: 'dumpster', maxY: 1.7 });
  }
  g.add(body);
  g.add(lidMesh);
  // Spilled trash bags around
  const bag = mat(THREE, 0x1a1a1c, { roughness: 1 });
  for (let i = 0; i < (p.spillCount ?? 3); i++) {
    const bb = box(THREE, 0.6, 0.4, 0.6, bag);
    const ang = (i * 137) * Math.PI / 180;
    bb.position.set(Math.cos(ang) * 1.6, 0.2, Math.sin(ang) * 1.2);
    g.add(bb);
  }
}

function buildPhoneBooth(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'phoneBooth';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const frame = mat(THREE, 0x2a4a8a, { roughness: 0.6, metalness: 0.3 });
  const glass = mat(THREE, 0x88ccff, { emissive: 0xfff7d0, emissiveIntensity: 1.0, transparent: true, opacity: 0.55 });
  // Frame edges
  const f = (sx, sy, sz, px, py, pz) => { const m = box(THREE, sx, sy, sz, frame); m.position.set(px, py, pz); g.add(m); };
  f(0.9, 0.15, 0.9, 0, 0.075, 0);
  f(0.9, 0.15, 0.9, 0, 2.4, 0);
  for (const px of [-0.45, 0.45]) for (const pz of [-0.45, 0.45]) f(0.1, 2.4, 0.1, px, 1.2, pz);
  // Glass walls
  for (const side of [-1, 1]) {
    const gx = box(THREE, 0.06, 2.2, 0.85, glass);
    gx.position.set(side * 0.42, 1.2, 0);
    g.add(gx);
  }
  const gz = box(THREE, 0.85, 2.2, 0.06, glass);
  gz.position.set(0, 1.2, -0.42);
  g.add(gz);
  // Top sign
  const sign = box(THREE, 0.95, 0.25, 0.95, mat(THREE, 0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 1.4 }));
  sign.position.set(0, 2.55, 0);
  g.add(sign);
  pushRotatedAABB(colliders, p.x, p.z, 1.0, 1.0, p.rot ?? 0, { tier: 'hard', tag: 'phonebooth', maxY: 2.6 });
}

function buildGachapon(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'gachapon';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const colors = [0xff60a0, 0x60c0ff, 0xffd040, 0x60d090];
  const count = p.count ?? 4;
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 0.55;
    const m = mat(THREE, colors[i % colors.length], { emissive: colors[i % colors.length], emissiveIntensity: 0.6, roughness: 0.5 });
    const body = box(THREE, 0.5, 1.4, 0.5, m);
    body.position.set(off, 0.7, 0);
    g.add(body);
    // Globe
    const globe = cyl(THREE, 0.22, 0.22, 0.4, mat(THREE, 0xfff8e0, { roughness: 0.2, transparent: true, opacity: 0.6 }), 12);
    globe.rotation.z = Math.PI / 2;
    globe.position.set(off, 1.05, 0.18);
    g.add(globe);
  }
  // Per-machine (rotation-aware) — spec: one collider per machine.
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 0.55;
    pushRotatedAABB(colliders, p.x, p.z, 0.5, 0.5, p.rot ?? 0, {
      ox: off, tier: 'hard', tag: 'gachapon', maxY: 1.5,
    });
  }
}

function buildPostBox(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'postBox';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const red = mat(THREE, 0xc02020, { roughness: 0.7 });
  const post = box(THREE, 0.5, 1.3, 0.4, red);
  post.position.y = 0.65;
  g.add(post);
  const top = box(THREE, 0.55, 0.1, 0.45, mat(THREE, 0x2a0a0a));
  top.position.y = 1.32;
  g.add(top);
  pushRotatedAABB(colliders, p.x, p.z, 0.5, 0.4, p.rot ?? 0, { tier: 'hard', tag: 'postbox', maxY: 1.4 });
}

function buildParkingMeter(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'parkingMeter';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const m = mat(THREE, 0x404048, { metalness: 0.5, roughness: 0.5 });
  const post = cyl(THREE, 0.05, 0.06, 1.2, m, 8);
  post.position.y = 0.6;
  g.add(post);
  const head = box(THREE, 0.18, 0.3, 0.18, m);
  head.position.y = 1.3;
  g.add(head);
  const screen = box(THREE, 0.12, 0.1, 0.04, mat(THREE, NEON.green, { emissive: NEON.green, emissiveIntensity: 1.2 }));
  screen.position.set(0, 1.32, 0.1);
  g.add(screen);
  pushAABB(colliders, p.x, p.z, 0.2, 0.2, { tier: 'prone', tag: 'meter', maxY: 1.4 });
}

function buildUtilityBox(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'utilityBox';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const m = mat(THREE, 0x808088, { roughness: 0.7, metalness: 0.3 });
  const body = box(THREE, 1.2, 1.4, 0.5, m);
  body.position.y = 0.7;
  g.add(body);
  // Hazard sticker
  const haz = box(THREE, 0.4, 0.4, 0.04, mat(THREE, NEON.yellow, { emissive: NEON.yellow, emissiveIntensity: 0.9 }));
  haz.position.set(0.3, 1.0, 0.27);
  g.add(haz);
  pushRotatedAABB(colliders, p.x, p.z, 1.2, 0.5, p.rot ?? 0, { tier: 'hard', tag: 'utility', maxY: 1.4 });
}

function buildCardboardBoxes(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'cardboardBoxes';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const m = mat(THREE, 0x9a7050, { roughness: 1 });
  const m2 = mat(THREE, 0xa88468, { roughness: 1 });
  const count = p.count ?? 5;
  let seed = (Math.abs(p.x * 31 + p.z * 17) | 0) || 1;
  const rng = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) / 4294967296); };
  for (let i = 0; i < count; i++) {
    const sx = 0.5 + rng() * 0.4;
    const sy = 0.4 + rng() * 0.3;
    const sz = 0.5 + rng() * 0.4;
    const x = (rng() - 0.5) * 1.4;
    const z = (rng() - 0.5) * 1.0;
    const lvl = Math.floor(rng() * 2);
    const y = sy / 2 + lvl * 0.5;
    const cb = box(THREE, sx, sy, sz, i & 1 ? m2 : m);
    cb.position.set(x, y, z);
    cb.rotation.y = rng() * 0.6 - 0.3;
    g.add(cb);
  }
  pushAABB(colliders, p.x, p.z, 1.8, 1.4, { tier: 'prone', tag: 'cardboard', maxY: 1.0 });
}

function buildTrafficCones(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'trafficCones';
  g.position.set(p.x, 0, p.z);
  parent.add(g);
  const cone = mat(THREE, 0xff7020, { emissive: 0xff7020, emissiveIntensity: 0.4, roughness: 0.6 });
  const stripe = mat(THREE, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 });
  const count = p.count ?? 3;
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 0.7;
    const c = cyl(THREE, 0.04, 0.22, 0.55, cone, 8);
    c.position.set(off, 0.275, 0);
    g.add(c);
    const s = cyl(THREE, 0.18, 0.18, 0.04, stripe, 8);
    s.position.set(off, 0.4, 0);
    g.add(s);
  }
}

function buildRoadBarrier(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'roadBarrier';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const concrete = mat(THREE, 0xb8b8a8, { roughness: 0.95 });
  const stripeY = mat(THREE, NEON.yellow, { emissive: NEON.yellow, emissiveIntensity: 0.8 });
  const len = p.length ?? 4;
  const body = box(THREE, len, 1.0, 0.5, concrete);
  body.position.y = 0.5;
  g.add(body);
  // Diagonal stripe
  for (let i = 0; i < Math.floor(len / 0.6); i++) {
    const s = box(THREE, 0.3, 0.5, 0.52, stripeY);
    s.position.set(-len / 2 + i * 0.6 + 0.3, 0.5, 0);
    s.rotation.z = 0.3;
    if (i & 1) g.add(s);
  }
  pushRotatedAABB(colliders, p.x, p.z, len, 0.6, p.rot ?? 0, { tier: 'hard', tag: 'barrier', maxY: 1.1 });
}

function buildPosterStrip(THREE, p, parent) {
  // Patch of 3-5 layered posters on a wall (decorative).
  const g = new THREE.Group();
  g.name = 'posterStrip';
  g.position.set(p.x, p.y ?? 1.6, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const count = p.count ?? 4;
  for (let i = 0; i < count; i++) {
    const tex = makePosterTexture(THREE, ((p.seed ?? 0) + i * 7) | 0);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: tex, emissive: 0x404040, emissiveMap: tex,
      emissiveIntensity: 0.35, roughness: 0.95,
    });
    const w = 0.7 + (i % 2) * 0.2;
    const h = 1.0 + (i % 3) * 0.25;
    const pl = box(THREE, w, h, 0.025, m);
    pl.position.set((i - (count - 1) / 2) * 0.72, (i % 2) * 0.1, 0);
    pl.rotation.z = ((i * 13) % 7 - 3) * 0.02;
    g.add(pl);
  }
}

function buildGraffitiDecal(THREE, p, parent) {
  const g = new THREE.Group();
  g.name = 'graffitiDecal';
  g.position.set(p.x, p.y ?? 1.5, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const tex = makeGraffitiTexture(THREE, p.seed ?? 0);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, emissive: 0xffffff, emissiveMap: tex,
    emissiveIntensity: 0.65, transparent: true, alphaTest: 0.05,
    roughness: 0.95, side: THREE.DoubleSide,
  });
  const pl = box(THREE, p.w ?? 2.4, p.h ?? 1.2, 0.03, m);
  g.add(pl);
}

function buildBenchPair(THREE, p, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'benchPair';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const wood = mat(THREE, BLDG.wood, { roughness: 0.9 });
  const metal = mat(THREE, 0x303034, { metalness: 0.5, roughness: 0.4 });
  for (const off of [-0.6, 0.6]) {
    const seat = box(THREE, 1.6, 0.08, 0.4, wood);
    seat.position.set(0, 0.42, off);
    g.add(seat);
    const back = box(THREE, 1.6, 0.6, 0.05, wood);
    back.position.set(0, 0.7, off + (off > 0 ? 0.18 : -0.18));
    g.add(back);
    for (const lx of [-0.7, 0.7]) {
      const leg = box(THREE, 0.05, 0.4, 0.4, metal);
      leg.position.set(lx, 0.2, off);
      g.add(leg);
    }
  }
  pushRotatedAABB(colliders, p.x, p.z, 1.8, 1.4, p.rot ?? 0, { tier: 'prone', tag: 'bench', maxY: 1.1 });
}

function buildSidewalkSign(THREE, p, parent, colliders) {
  // Big upright shop sign (sidewalk-mounted) — 2 vertical poles + tall sign.
  const g = new THREE.Group();
  g.name = 'sidewalkSign';
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const poleM = mat(THREE, 0x2a2a30, { metalness: 0.4, roughness: 0.5 });
  const tex = makeKanjiTexture(THREE, p.text ?? '居酒屋', p.color ?? NEON.red, p.h ?? 3.4);
  const sm = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, emissive: p.color ?? NEON.red, emissiveMap: tex,
    emissiveIntensity: 2.4, roughness: 0.4,
  });
  const ph = (p.h ?? 3.4) + 1;
  for (const px of [-0.4, 0.4]) {
    const pl = box(THREE, 0.1, ph, 0.1, poleM);
    pl.position.set(px, ph / 2, 0);
    g.add(pl);
  }
  const face = box(THREE, 1.0, p.h ?? 3.4, 0.12, sm);
  face.position.set(0, (p.h ?? 3.4) / 2 + 0.5, 0);
  g.add(face);
  pushRotatedAABB(colliders, p.x, p.z, 1.0, 0.4, p.rot ?? 0, { tier: 'hard', tag: 'sidewalksign', maxY: ph });
}

function buildSatellite(THREE, p, parent) {
  // Roof-mount mini satellite dish.
  const g = new THREE.Group();
  g.name = 'satelliteDish';
  g.position.set(p.x, p.y ?? TIER_ROOF, p.z);
  parent.add(g);
  const m = mat(THREE, 0xd0d0d0, { roughness: 0.5, metalness: 0.4 });
  const post = cyl(THREE, 0.05, 0.07, 0.6, m, 8);
  post.position.y = 0.3;
  g.add(post);
  const dish = cyl(THREE, 0.55, 0.7, 0.08, m, 16);
  dish.rotation.x = -0.4;
  dish.position.y = 0.6;
  g.add(dish);
  const arm = cyl(THREE, 0.04, 0.04, 0.5, m, 6);
  arm.rotation.z = 0.6;
  arm.position.set(0.18, 0.7, 0.3);
  g.add(arm);
}

function buildRooftopUnit(THREE, p, parent, colliders) {
  // Generic HVAC/electrical unit on rooftops — provides cover.
  const g = new THREE.Group();
  g.name = 'rooftopUnit';
  g.position.set(p.x, p.y ?? TIER_ROOF, p.z);
  g.rotation.y = p.rot ?? 0;
  parent.add(g);
  const m = mat(THREE, 0x6a6a72, { roughness: 0.6, metalness: 0.3 });
  const base = box(THREE, 1.8, 1.0, 1.4, m);
  base.position.y = 0.5;
  g.add(base);
  const fan = cyl(THREE, 0.5, 0.5, 0.1, mat(THREE, 0x303030), 12);
  fan.position.y = 1.05;
  g.add(fan);
  const fanCage = cyl(THREE, 0.55, 0.55, 0.2, mat(THREE, 0x202024, { roughness: 0.5, metalness: 0.4 }), 12);
  fanCage.position.y = 1.15;
  g.add(fanCage);
  pushRotatedAABB(colliders, p.x, p.z, 1.8, 1.4, p.rot ?? 0, {
    tier: 'hard', tag: 'rooftopunit',
    minY: p.y ?? TIER_ROOF, maxY: (p.y ?? TIER_ROOF) + 1.3,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Instanced micro-detail scatter — low-cost ground-level clutter.  All passed
// items share one InstancedMesh per type.  Distributed deterministically from
// declarative scatter rules so the level is reproducible.
// ─────────────────────────────────────────────────────────────────────────────

function buildMicroProps(THREE, parent, scatters) {
  const out = [];
  for (const s of scatters) {
    const geo = (() => {
      if (s.type === 'cigButt') return new THREE.CylinderGeometry(0.03, 0.03, 0.06, 5);
      if (s.type === 'bottleCap') return new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8);
      if (s.type === 'paperTrash') return new THREE.BoxGeometry(0.18, 0.02, 0.14);
      if (s.type === 'leaf') return new THREE.BoxGeometry(0.12, 0.01, 0.08);
      if (s.type === 'streetGarbage') return new THREE.BoxGeometry(0.22, 0.05, 0.16);
      if (s.type === 'glassShards') return new THREE.BoxGeometry(0.05, 0.005, 0.05);
      return new THREE.BoxGeometry(0.1, 0.02, 0.1);
    })();
    const matInst = (() => {
      if (s.type === 'cigButt') return mat(THREE, 0xeae0c0, { roughness: 0.95 });
      if (s.type === 'bottleCap') return mat(THREE, 0xc04040, { metalness: 0.4, roughness: 0.5 });
      if (s.type === 'paperTrash') return mat(THREE, 0xd0d0c0, { roughness: 0.95 });
      if (s.type === 'leaf') return mat(THREE, 0x553a18, { roughness: 1 });
      if (s.type === 'streetGarbage') return mat(THREE, 0x6a4030, { roughness: 1 });
      if (s.type === 'glassShards') return mat(THREE, 0xa0c8d8, { metalness: 0.5, roughness: 0.2, emissive: 0x405060, emissiveIntensity: 0.4 });
      return mat(THREE, 0x808080);
    })();
    const inst = new THREE.InstancedMesh(geo, matInst, s.count);
    inst.name = `micro_${s.type}`;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    let seed = s.seed ?? 12345;
    const rng = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) / 4294967296); };
    for (let i = 0; i < s.count; i++) {
      const x = s.minX + rng() * (s.maxX - s.minX);
      const z = s.minZ + rng() * (s.maxZ - s.minZ);
      // Optional avoid-area test (rectangle exclusions)
      let ok = true;
      if (s.avoid) for (const a of s.avoid) {
        if (x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ) { ok = false; break; }
      }
      if (!ok) { i--; continue; }
      const y = (s.y ?? 0.02) + rng() * 0.005;
      const yaw = rng() * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const sc = 0.85 + rng() * 0.4;
      m4.compose(v.set(x, y, z), q, new THREE.Vector3(sc, sc, sc));
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    parent.add(inst);
    out.push(inst);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trees & cherry blossoms — deterministic scatter that avoids buildings/roads.
// ─────────────────────────────────────────────────────────────────────────────

function buildTrees(THREE, parent, opts, colliders) {
  const count = opts.count ?? 60;
  const seed  = opts.seed  ?? 31337;
  const avoid = opts.avoid ?? [];
  const minX  = opts.minX  ?? -120;
  const maxX  = opts.maxX  ??  120;
  const minZ  = opts.minZ  ?? -120;
  const maxZ  = opts.maxZ  ??  120;

  // Mulberry32 RNG
  let s = seed >>> 0;
  const rng = () => { s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Shared materials
  const trunkM   = mat(THREE, 0x4a3520, { roughness: 1, metalness: 0 });
  const trunkMD  = mat(THREE, 0x3a2818, { roughness: 1, metalness: 0 });
  const leafA    = mat(THREE, 0x356b32, { roughness: 1 });
  const leafB    = mat(THREE, 0x2a5f2a, { roughness: 1 });
  const leafC    = mat(THREE, 0x4a8540, { roughness: 1 });
  const sakuraA  = mat(THREE, 0xffb0d0, { roughness: 0.8, emissive: 0xff80b0, emissiveIntensity: 0.18 });
  const sakuraB  = mat(THREE, 0xffd0e0, { roughness: 0.8, emissive: 0xff80b0, emissiveIntensity: 0.10 });
  const sakuraC  = mat(THREE, 0xff90c0, { roughness: 0.8, emissive: 0xff80b0, emissiveIntensity: 0.22 });

  const placed = []; // {x, z, r}
  const tooClose = (x, z, r) => {
    for (const p of placed) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < r + p.r + 1.5) return true;
    }
    return false;
  };
  const inAvoid = (x, z, pad) => {
    for (const a of avoid) {
      if (x > a.minX - pad && x < a.maxX + pad &&
          z > a.minZ - pad && z < a.maxZ + pad) return true;
    }
    return false;
  };

  let placedCount = 0;
  const maxAttempts = count * 30;
  for (let attempt = 0; attempt < maxAttempts && placedCount < count; attempt++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ);
    const isCherry = rng() < 0.45;
    const sizeRoll = rng();
    // Tree dims
    const trunkH = 2.0 + sizeRoll * 4.0;       // 2..6
    const trunkR = 0.14 + sizeRoll * 0.18;     // 0.14..0.32
    const foliageR = 1.1 + sizeRoll * 1.6;     // 1.1..2.7
    const footprint = foliageR * 0.85;
    if (inAvoid(x, z, footprint + 0.6)) continue;
    if (tooClose(x, z, footprint)) continue;

    const g = new THREE.Group();
    g.name = isCherry ? 'cherryBlossom' : 'tree';
    g.position.set(x, 0, z);
    g.rotation.y = rng() * Math.PI * 2;
    parent.add(g);

    // Trunk
    const trunk = cyl(THREE, trunkR * 0.85, trunkR, trunkH, isCherry ? trunkMD : trunkM, 8);
    trunk.position.y = trunkH / 2;
    g.add(trunk);

    // Foliage clusters — 3-5 spheres clustered near top of trunk
    const clusterCount = 3 + Math.floor(rng() * 3);
    const baseY = trunkH * 0.85;
    const palettes = isCherry ? [sakuraA, sakuraB, sakuraC] : [leafA, leafB, leafC];
    for (let i = 0; i < clusterCount; i++) {
      const r = foliageR * (0.7 + rng() * 0.55);
      const ox = (rng() - 0.5) * foliageR * 1.2;
      const oz = (rng() - 0.5) * foliageR * 1.2;
      const oy = baseY + rng() * foliageR * 1.2;
      const sphGeo = new THREE.SphereGeometry(r, 8, 6);
      const sph = new THREE.Mesh(sphGeo, palettes[i % palettes.length]);
      sph.position.set(ox, oy, oz);
      // Slight squash for variety
      sph.scale.set(1, 0.85 + rng() * 0.3, 1);
      g.add(sph);
    }

    // Trunk collider (prone — bullets pass overhead through canopy)
    pushAABB(colliders, x, z, trunkR * 2.4, trunkR * 2.4, {
      tier: 'prone', tag: 'tree', maxY: trunkH * 0.6,
    });
    placed.push({ x, z, r: footprint });
    placedCount++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle traffic — looping cars driving the main avenues.  Pure visual; not
// authoritative.  Each car follows a polyline path at constant speed.
// ─────────────────────────────────────────────────────────────────────────────

// Vehicle bounding boxes — { len, wid, h }. Length is along local +X (forward),
// width is along local Z, height is along Y. Used to generate dynamic colliders
// updated every frame from the vehicle's world position + heading.
const VEHICLE_DIMS = {
  taxi:          { len: 4.0, wid: 1.7, h: 1.7  },
  van:           { len: 4.6, wid: 1.96, h: 1.8 },
  sedan:         { len: 4.2, wid: 1.7, h: 1.4  },
  bus:           { len: 8.0, wid: 2.26, h: 2.9 },
  policeCar:     { len: 4.4, wid: 1.7, h: 1.75 },
  deliveryTruck: { len: 6.0, wid: 2.0, h: 2.4  },
  ambulance:     { len: 5.3, wid: 2.0, h: 2.5  },
  fireTruck:     { len: 7.1, wid: 2.1, h: 2.5  },
  sportsCar:     { len: 4.4, wid: 1.85, h: 1.0 },
  limo:          { len: 7.2, wid: 1.8, h: 1.42 },
  kei:           { len: 3.1, wid: 1.66, h: 1.55 },
};

function buildVehicleTraffic(THREE, parent, vehicles, animatedOut, colliders) {
  for (const v of vehicles) {
    const g = new THREE.Group();
    g.name = `vehicle_${v.kind}`;
    parent.add(g);
    const bodyMat = mat(THREE, v.color ?? 0x303040, { roughness: 0.6, metalness: 0.3 });
    const tire = mat(THREE, 0x101010, { roughness: 1 });
    const glass = mat(THREE, 0x10141c, { roughness: 0.3, metalness: 0.5 });
    const head = mat(THREE, NEON.white, { emissive: NEON.white, emissiveIntensity: 3 });
    const tail = mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 2 });
    if (v.kind === 'taxi') {
      const lower = box(THREE, 4.0, 0.7, 1.7, bodyMat);
      lower.position.y = 0.4; g.add(lower);
      const cabin = box(THREE, 2.5, 0.7, 1.6, bodyMat);
      cabin.position.set(-0.2, 1.05, 0); g.add(cabin);
      const win = box(THREE, 2.4, 0.55, 1.66, glass);
      win.position.set(-0.2, 1.05, 0); g.add(win);
      const sign = box(THREE, 0.6, 0.25, 0.4, mat(THREE, NEON.yellow, { emissive: NEON.yellow, emissiveIntensity: 2.4 }));
      sign.position.set(-0.2, 1.55, 0); g.add(sign);
    } else if (v.kind === 'van') {
      const main = box(THREE, 4.6, 1.8, 1.9, bodyMat);
      main.position.y = 1.0; g.add(main);
      const win = box(THREE, 1.4, 0.7, 1.96, glass);
      win.position.set(1.4, 1.4, 0); g.add(win);
    } else if (v.kind === 'sedan') {
      const lower = box(THREE, 4.2, 0.7, 1.7, bodyMat);
      lower.position.y = 0.4; g.add(lower);
      const cabin = box(THREE, 2.2, 0.6, 1.6, bodyMat);
      cabin.position.set(-0.2, 1.05, 0); g.add(cabin);
      const win = box(THREE, 2.1, 0.4, 1.66, glass);
      win.position.set(-0.2, 1.07, 0); g.add(win);
    } else if (v.kind === 'bus') {
      const main = box(THREE, 8.0, 2.6, 2.2, bodyMat);
      main.position.y = 1.5; g.add(main);
      // Window strip (continuous) — depth slightly less than body so faces don't z-fight
      const winStrip = box(THREE, 7.4, 0.9, 2.26, glass);
      winStrip.position.set(0, 1.95, 0); g.add(winStrip);
      // Roof accent
      const roofAcc = box(THREE, 7.6, 0.06, 0.4, mat(THREE, NEON.white, { emissive: NEON.white, emissiveIntensity: 1.4 }));
      roofAcc.position.set(0, 2.84, 0); g.add(roofAcc);
      // Route number panel — protruding from front face, depth clears z-fight
      const routePanel = box(THREE, 1.0, 0.4, 0.06, mat(THREE, NEON.yellow, { emissive: NEON.yellow, emissiveIntensity: 2.2 }));
      routePanel.position.set(4.03, 2.3, 0); g.add(routePanel);
    } else if (v.kind === 'policeCar') {
      const lower = box(THREE, 4.4, 0.7, 1.7, bodyMat);
      lower.position.y = 0.4; g.add(lower);
      const cabin = box(THREE, 2.4, 0.7, 1.6, mat(THREE, 0xf0f0f0, { roughness: 0.6 }));
      cabin.position.set(-0.2, 1.05, 0); g.add(cabin);
      const win = box(THREE, 2.3, 0.55, 1.66, glass);
      win.position.set(-0.2, 1.05, 0); g.add(win);
      // Light bar
      const barBase = box(THREE, 1.4, 0.12, 0.4, mat(THREE, 0x101014));
      barBase.position.set(-0.2, 1.48, 0); g.add(barBase);
      const lightR = box(THREE, 0.6, 0.18, 0.34, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 3.5 }));
      lightR.position.set(-0.55, 1.66, 0); g.add(lightR);
      const lightB = box(THREE, 0.6, 0.18, 0.34, mat(THREE, 0x2050ff, { emissive: 0x2050ff, emissiveIntensity: 3.5 }));
      lightB.position.set( 0.15, 1.66, 0); g.add(lightB);
    } else if (v.kind === 'deliveryTruck') {
      // Cab at +X (front, with headlights); cargo at -X (back, with taillights)
      const cab = box(THREE, 1.8, 1.6, 1.9, bodyMat);
      cab.position.set(1.7, 1.0, 0); g.add(cab);
      const cabWin = box(THREE, 1.4, 0.55, 1.96, glass);
      cabWin.position.set(1.7, 1.42, 0); g.add(cabWin);
      const cargo = box(THREE, 4.2, 2.2, 2.0, mat(THREE, 0xe8d8a0, { roughness: 0.85 }));
      cargo.position.set(-1.3, 1.3, 0); g.add(cargo);
      // Logo strip on cargo side — protrudes from cargo face cleanly
      const logo = box(THREE, 4.0, 0.5, 0.06, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 1.6 }));
      logo.position.set(-1.3, 1.5, 1.03); g.add(logo);
    } else if (v.kind === 'ambulance') {
      // Boxy white body with red cross + flashing lightbar
      const cab = box(THREE, 1.6, 1.7, 1.9, mat(THREE, 0xf2f2f2, { roughness: 0.55 }));
      cab.position.set(1.85, 1.05, 0); g.add(cab);
      const cabWin = box(THREE, 1.2, 0.65, 1.96, glass);
      cabWin.position.set(1.85, 1.5, 0); g.add(cabWin);
      const boxBody = box(THREE, 3.6, 2.3, 2.0, mat(THREE, 0xf6f6f6, { roughness: 0.55 }));
      boxBody.position.set(-0.85, 1.35, 0); g.add(boxBody);
      // Red cross on side — protrudes cleanly from body face
      const crossH = box(THREE, 0.8, 0.18, 0.06, mat(THREE, 0xe02020, { emissive: 0xe02020, emissiveIntensity: 1.2 }));
      crossH.position.set(-0.85, 1.5, 1.03); g.add(crossH);
      const crossV = box(THREE, 0.18, 0.8, 0.06, mat(THREE, 0xe02020, { emissive: 0xe02020, emissiveIntensity: 1.2 }));
      crossV.position.set(-0.85, 1.5, 1.03); g.add(crossV);
      const crossH2 = crossH.clone(); crossH2.position.z = -1.03; g.add(crossH2);
      const crossV2 = crossV.clone(); crossV2.position.z = -1.03; g.add(crossV2);
      // Lightbar (flicker)
      const barBase = box(THREE, 1.5, 0.1, 0.5, mat(THREE, 0x101014));
      barBase.position.set(1.5, 1.95, 0); g.add(barBase);
      const lR = box(THREE, 0.65, 0.2, 0.4, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 3.5 }));
      lR.position.set(1.15, 2.12, 0); g.add(lR);
      const lB = box(THREE, 0.65, 0.2, 0.4, mat(THREE, 0x2050ff, { emissive: 0x2050ff, emissiveIntensity: 3.5 }));
      lB.position.set(1.85, 2.12, 0); g.add(lB);
    } else if (v.kind === 'fireTruck') {
      // Long red truck with ladder
      const cab = box(THREE, 2.0, 1.9, 2.0, bodyMat);
      cab.position.set(3.05, 1.15, 0); g.add(cab);
      const cabWin = box(THREE, 1.5, 0.7, 2.06, glass);
      cabWin.position.set(3.05, 1.55, 0); g.add(cabWin);
      const main = box(THREE, 5.0, 2.1, 2.1, bodyMat);
      main.position.set(-0.5, 1.25, 0); g.add(main);
      // Ladder on top (two rails + rungs)
      const ladderMat = mat(THREE, 0xa0a0a8, { roughness: 0.5, metalness: 0.7 });
      const railL = box(THREE, 6.5, 0.08, 0.08, ladderMat);
      railL.position.set(0, 2.4, -0.6); g.add(railL);
      const railR = box(THREE, 6.5, 0.08, 0.08, ladderMat);
      railR.position.set(0, 2.4, 0.6); g.add(railR);
      for (let i = 0; i < 8; i++) {
        const rung = box(THREE, 0.08, 0.06, 1.2, ladderMat);
        rung.position.set(-2.8 + i * 0.8, 2.4, 0); g.add(rung);
      }
      // Emergency lights — perched on cab roof, clear of cab top
      const fL = box(THREE, 0.5, 0.16, 0.34, mat(THREE, NEON.red, { emissive: NEON.red, emissiveIntensity: 3.5 }));
      fL.position.set(3.05, 2.22, -0.5); g.add(fL);
      const fR = fL.clone(); fR.position.z = 0.5; g.add(fR);
      // White trim band — depth less than main body to avoid coplanar side faces
      const trim = box(THREE, 5.0, 0.1, 2.04, mat(THREE, 0xf0f0f0, { roughness: 0.4 }));
      trim.position.set(-0.5, 0.55, 0); g.add(trim);
    } else if (v.kind === 'sportsCar') {
      // Low slung body with neon underglow
      const lower = box(THREE, 4.4, 0.5, 1.85, bodyMat);
      lower.position.y = 0.32; g.add(lower);
      const cabin = box(THREE, 1.9, 0.45, 1.65, bodyMat);
      cabin.position.set(-0.5, 0.79, 0); g.add(cabin);
      const wedgeF = box(THREE, 1.3, 0.32, 1.65, bodyMat);
      wedgeF.position.set(1.3, 0.71, 0); g.add(wedgeF);
      const win = box(THREE, 1.85, 0.25, 1.71, glass);
      win.position.set(-0.5, 0.81, 0); g.add(win);
      // Underglow — sits below body, clear of ground
      const glowColor = (v.color === 0xff2050) ? NEON.pink : (v.color === 0x20d0ff) ? NEON.cyan : NEON.yellow;
      const glow = box(THREE, 4.2, 0.04, 1.7, mat(THREE, glowColor, { emissive: glowColor, emissiveIntensity: 2.2 }));
      glow.position.y = 0.05; g.add(glow);
      // Rear spoiler
      const spoiler = box(THREE, 0.2, 0.08, 1.6, bodyMat);
      spoiler.position.set(-2.05, 0.98, 0); g.add(spoiler);
      const spoilerStand = box(THREE, 0.08, 0.18, 1.4, bodyMat);
      spoilerStand.position.set(-2.0, 0.85, 0); g.add(spoilerStand);
    } else if (v.kind === 'limo') {
      // Extra-long sedan, very dark
      const lower = box(THREE, 7.2, 0.7, 1.8, bodyMat);
      lower.position.y = 0.4; g.add(lower);
      const cabin = box(THREE, 5.4, 0.65, 1.7, bodyMat);
      cabin.position.set(-0.3, 1.07, 0); g.add(cabin);
      // Heavily tinted windows — depth less than cabin so faces don't z-fight
      const winGlass = mat(THREE, 0x05060a, { roughness: 0.2, metalness: 0.6 });
      const win = box(THREE, 5.2, 0.45, 1.76, winGlass);
      win.position.set(-0.3, 1.1, 0); g.add(win);
      // Subtle accent strip — sits between lower body and cabin, slim profile
      const strip = box(THREE, 7.0, 0.04, 1.74, mat(THREE, 0x303040, { roughness: 0.5 }));
      strip.position.set(0, 0.78, 0); g.add(strip);
    } else { // kei
      const cab = box(THREE, 1.7, 1.5, 1.6, bodyMat);
      cab.position.set(-0.65, 0.95, 0); g.add(cab);
      const win = box(THREE, 1.65, 0.45, 1.66, glass);
      win.position.set(-0.65, 1.38, 0); g.add(win);
      const bed = box(THREE, 1.4, 0.9, 1.55, bodyMat);
      bed.position.set(0.95, 0.65, 0); g.add(bed);
    }
    // Lights — headX/tailX matched to actual body extents per kind
    const headX = {
      limo: 3.5, fireTruck: 3.55, ambulance: 2.45,
      bus: 3.85, deliveryTruck: 2.45, kei: 1.35,
    }[v.kind] ?? 2.0;
    const tailX = {
      limo: -3.5, fireTruck: -2.95, ambulance: -2.4,
      bus: -3.85, deliveryTruck: -2.95, kei: -1.45,
    }[v.kind] ?? -2.0;
    const hf = box(THREE, 0.25, 0.18, 0.06, head); hf.position.set(headX, 0.55, -0.5); g.add(hf);
    const hf2 = hf.clone(); hf2.position.z = 0.5; g.add(hf2);
    const tf = box(THREE, 0.2, 0.15, 0.06, tail); tf.position.set(tailX, 0.55, -0.5); g.add(tf);
    const tf2 = tf.clone(); tf2.position.z = 0.5; g.add(tf2);
    // Wheels — rotation.x = π/2 aligns cylinder axis along Z (the axle direction)
    let wheelXs = [-1.5, 1.5];
    if (v.kind === 'limo') wheelXs = [-3.0, -1.2, 1.2, 3.0];
    else if (v.kind === 'fireTruck') wheelXs = [-2.4, -0.6, 2.4];
    else if (v.kind === 'ambulance' || v.kind === 'deliveryTruck') wheelXs = [-2.2, 1.8];
    else if (v.kind === 'bus') wheelXs = [-3.0, 3.0];
    else if (v.kind === 'sportsCar') wheelXs = [-1.7, 1.7];
    for (const wx of wheelXs) for (const wz of [-0.8, 0.8]) {
      const w = cyl(THREE, 0.32, 0.32, 0.18, tire, 12); w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.32, wz); g.add(w);
    }
    // Per-vehicle dynamic collider — added to the colliders array at build time
    // and re-positioned every frame in the update loop.
    let collider = null;
    if (colliders) {
      const dims = VEHICLE_DIMS[v.kind] ?? { len: 4.0, wid: 1.7, h: 1.7 };
      collider = pushAABB(colliders, 0, 0, dims.len, dims.wid, {
        tier: 'hard', category: 'solid',
        tag: `vehicle_${v.kind}`,
        tags: ['vehicle', v.kind],
        minY: 0, maxY: dims.h,
        jumpable: false,
      });
      collider.dynamic = true;
      collider._vDims = dims;     // cached for update step
    }
    animatedOut.push({
      kind: 'vehicle', target: g, path: v.path,
      speed: v.speed ?? 6, t: v.tStart ?? Math.random(),
      curSpeed: v.speed ?? 6,
      collider,
    });
  }
}

// Update a vehicle's dynamic collider to match its current world transform.
// Vehicles travel along axis-aligned grid paths (rotation.y = 0, ±π/2, π); for
// diagonal segments we still produce a correct world AABB by projecting the
// rotated local box onto the world axes.
function updateVehicleCollider(c, x, z, fwdX, fwdZ) {
  if (!c) return;
  const { len, wid, h } = c._vDims;
  const halfL = len / 2, halfW = wid / 2;
  const ax = Math.abs(fwdX), az = Math.abs(fwdZ);
  const hxWorld = halfL * ax + halfW * az;
  const hzWorld = halfL * az + halfW * ax;
  // Update both legacy 2D fields (consumed by the 2D collision engine) and
  // the new spec-format bounds in lockstep.
  c.x = x;
  c.y = z;             // legacy: 'y' here means world z
  c.w = hxWorld * 2;
  c.h = hzWorld * 2;
  c.bounds.min.x = x - hxWorld;
  c.bounds.min.z = z - hzWorld;
  c.bounds.max.x = x + hxWorld;
  c.bounds.max.z = z + hzWorld;
  c.bounds.min.y = 0;
  c.bounds.max.y = h;
}

// All four-way intersections (kept in sync with buildTrafficLights)
const TRAFFIC_INTERSECTIONS = [
  { x:   0, z: -62 },
  { x:   0, z:  20 },
  { x:   0, z:  80 },
  { x: -70, z: -62 },
  { x: -70, z:  20 },
  { x:  70, z: -62 },
  { x:  70, z:  20 },
];

// Returns true if the light is green (or yellow) for a vehicle approaching the
// given intersection from N/S (isNS=true) or E/W (isNS=false). Mirrors the
// 90s phase cycle in the trafficLight animator.
function _isLightGo(time, ix, iz, isNS) {
  const seed = ix * 0.17 + iz * 0.11;
  const t = ((time + seed * 7) % 60 + 60) % 60;
  // Yellow counts as stop for cars that haven't entered yet — they brake
  // before the stop line. Cars already inside the intersection no longer have
  // an upcoming stop checkpoint, so they continue clearing.
  if (isNS) return t < 25;            // NS green 0–25
  else      return t >= 30 && t < 55; // EW green 30–55
}
// ─────────────────────────────────────────────────────────────────────────────
// Hazards (manhole + storm drain)
// ─────────────────────────────────────────────────────────────────────────────

function buildManhole(THREE, f, parent, hazardsList, colliders) {
  const g = new THREE.Group();
  g.name = 'manhole';
  g.position.set(f.x, 0, f.z);
  parent.add(g);
  // Rim
  const rim = cyl(THREE, 0.85, 0.85, 0.12, mat(THREE, 0x2a2a2c, { roughness: 0.7 }), 24);
  rim.position.y = 0.06;
  g.add(rim);
  // Shaft walls — open cylinder, inside-facing so we see inner concrete from above.
  const shaftMat = mat(THREE, 0x1a1a1c, { roughness: 1, side: THREE.BackSide });
  const shaftGeo = new THREE.CylinderGeometry(0.7, 0.7, 4.2, 24, 1, true);
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.y = -2.0;
  g.add(shaft);
  // Shaft floor
  const floor = cyl(THREE, 0.7, 0.7, 0.05, mat(THREE, 0x0a0a0c, { roughness: 1 }), 24);
  floor.position.y = -4.07;
  g.add(floor);
  // Rim accent
  const accent = cyl(THREE, 0.86, 0.86, 0.01, mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 0.6 }), 24);
  accent.position.y = 0.121;
  g.add(accent);
  // Descending ladder rungs (visible through the hole) — runs along +z wall.
  const rungMat = mat(THREE, 0x6a6a70, { roughness: 0.5, metalness: 0.6 });
  const railMat = mat(THREE, 0x4a4a50, { roughness: 0.5, metalness: 0.6 });
  for (let i = 0; i < 9; i++) {
    const rung = cyl(THREE, 0.04, 0.04, 0.5, rungMat, 6);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0, -0.1 - i * 0.45, 0.55);
    g.add(rung);
  }
  const railL = box(THREE, 0.06, 4.0, 0.06, railMat);
  railL.position.set(-0.25, -2.0, 0.6);
  g.add(railL);
  const railR = box(THREE, 0.06, 4.0, 0.06, railMat);
  railR.position.set( 0.25, -2.0, 0.6);
  g.add(railR);
  hazardsList.push({ kind: 'manhole', x: f.x, z: f.z, r: 0.8 });
  // Trigger zone — fires an event when the player enters; no physical block.
  if (colliders) {
    pushAABB(colliders, f.x, f.z, 1.7, 1.7, {
      tier: 'prone',
      category: 'trigger',
      tag: 'manhole',
      minY: 0, maxY: 0.4,
      jumpable: false,
    });
  }
}

function buildStormDrain(THREE, f, parent, colliders, hazardsList) {
  const g = new THREE.Group();
  g.name = 'stormDrain';
  parent.add(g);
  const dx = f.to.x - f.from.x;
  const dz = f.to.z - f.from.z;
  const len = Math.hypot(dx, dz);
  const cx = (f.from.x + f.to.x) / 2;
  const cz = (f.from.z + f.to.z) / 2;
  const ang = Math.atan2(dz, dx);
  const wallMat = mat(THREE, 0x1a1a1c, { roughness: 1 });
  const floorMat = mat(THREE, 0x0e0e10, { roughness: 1 });
  const ceilMat = mat(THREE, 0x141416, { roughness: 1 });
  const w = f.w ?? 4;
  const depth = f.depth ?? 4;
  const pivot = new THREE.Group();
  pivot.position.set(cx, -depth, cz);
  pivot.rotation.y = -ang;
  g.add(pivot);
  const floor = box(THREE, len, 0.2, w, floorMat);
  floor.position.y = 0.1;
  pivot.add(floor);
  const wL = box(THREE, len, depth, 0.3, wallMat); wL.position.set(0, depth / 2, -w / 2 + 0.15); pivot.add(wL);
  const wR = box(THREE, len, depth, 0.3, wallMat); wR.position.set(0, depth / 2,  w / 2 - 0.15); pivot.add(wR);
  // End caps — seal the tunnel where it terminates beyond the manhole openings.
  const wF = box(THREE, 0.3, depth, w, wallMat); wF.position.set(-len / 2 + 0.15, depth / 2, 0); pivot.add(wF);
  const wB = box(THREE, 0.3, depth, w, wallMat); wB.position.set( len / 2 - 0.15, depth / 2, 0); pivot.add(wB);
  // Ceiling — seals the tunnel below the asphalt; manhole shafts pierce through it
  // visually because the shaft cylinder is rendered after this slab.
  const ceil = box(THREE, len, 0.2, w, ceilMat);
  ceil.position.y = depth - 0.1;
  pivot.add(ceil);
  // Faint cyan emissive strips on walls
  const stripMat = mat(THREE, NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: 0.4 });
  const sL = box(THREE, len, 0.05, 0.04, stripMat); sL.position.set(0, depth * 0.7, -w / 2 + 0.32); pivot.add(sL);
  const sR = box(THREE, len, 0.05, 0.04, stripMat); sR.position.set(0, depth * 0.7,  w / 2 - 0.32); pivot.add(sR);

  hazardsList.push({ kind: 'stormDrain', from: f.from, to: f.to, w: f.w, depth: f.depth });
  // No surface collider — it's underground
}

// Sidewalk steam-vent grate — damages players standing on it during ON phase.
function buildSteamGrate(THREE, f, parent, hazardsList, animatedOut) {
  const g = new THREE.Group();
  g.name = 'steamGrate';
  g.position.set(f.x, 0, f.z);
  parent.add(g);
  // Recessed grate (1.4 × 1.4)
  const frame = box(THREE, 1.5, 0.08, 1.5, mat(THREE, 0x2a2a2c, { roughness: 0.6, metalness: 0.4 }));
  frame.position.y = 0.04;
  g.add(frame);
  // Slats
  const slatMat = mat(THREE, 0x141416, { roughness: 0.7, metalness: 0.3 });
  for (let i = -3; i <= 3; i++) {
    const slat = box(THREE, 0.12, 0.04, 1.3, slatMat);
    slat.position.set(i * 0.18, 0.085, 0);
    g.add(slat);
  }
  // Warning-stripe accent (dim amber, brightens during ON)
  const accentMat = mat(THREE, 0xff8a20, { emissive: 0xff8a20, emissiveIntensity: 0.4 });
  const accent = box(THREE, 1.55, 0.012, 0.08, accentMat);
  accent.position.set(0, 0.09, 0.78);
  g.add(accent);
  const accent2 = box(THREE, 1.55, 0.012, 0.08, accentMat);
  accent2.position.set(0, 0.09, -0.78);
  g.add(accent2);
  // Steam plume — 4 stacked translucent quads, animated.
  const billows = [];
  const steamMat = () => mat(THREE, 0xeaf2ff, { transparent: true, opacity: 0.0, roughness: 1, emissive: 0x9aa0b0, emissiveIntensity: 0.4 });
  for (let i = 0; i < 4; i++) {
    const b = box(THREE, 1.2, 0.05, 1.2, steamMat());
    b.position.set(0, 0.4 + i * 0.7, 0);
    g.add(b);
    billows.push(b);
  }
  hazardsList.push({
    kind: 'steamGrate', x: f.x, z: f.z, r: 1.0,
    period: f.period ?? 5.0, dutyOn: f.dutyOn ?? 0.5,
  });
  animatedOut.push({
    kind: 'steamGrate', billows, accents: [accent, accent2],
    seed: Math.random() * 100,
    period: f.period ?? 5.0,
    dutyOn: f.dutyOn ?? 0.5,
  });
}

// Sparking downed power line — pole with severed cable shooting periodic arcs.
function buildElectricArc(THREE, f, parent, colliders, hazardsList, animatedOut) {
  const g = new THREE.Group();
  g.name = 'electricArc';
  g.position.set(f.x, 0, f.z);
  parent.add(g);
  // Toppled wooden pole lying on ground — center lowered so pole body rests
  // flat on the asphalt (radius ≈ 0.20, so y=0.20 keeps bottom flush with ground).
  const poleMat = mat(THREE, 0x4a3520, { roughness: 1 });
  const pole = cyl(THREE, 0.18, 0.20, 5.0, poleMat, 8);
  pole.rotation.z = Math.PI / 2 - 0.2;
  pole.position.set(0, 0.20, 0);
  g.add(pole);
  // Broken-off stump at the low end (buried into the asphalt, cracked wood top)
  const stumpMat = mat(THREE, 0x3a2a14, { roughness: 1 });
  const stump = cyl(THREE, 0.20, 0.22, 0.55, stumpMat, 8);
  stump.position.set(-2.3, 0.18, 0);
  g.add(stump);
  // Junction transformer canister riding the high end of the pole
  const trans = cyl(THREE, 0.4, 0.45, 0.8, mat(THREE, 0x8a8a72, { roughness: 0.5, metalness: 0.4 }), 12);
  trans.position.set(2.3, 0.65, 0);
  trans.rotation.z = -0.2;
  g.add(trans);
  // Severed cable draping from pole to the ground — kept short so it stays above asphalt
  const cableMat = mat(THREE, 0x101010, { roughness: 0.9 });
  const cable = cyl(THREE, 0.04, 0.04, 0.65, cableMat, 6);
  cable.rotation.z = 0.9;
  cable.position.set(-1.4, 0.22, 0.3);
  g.add(cable);
  // Arc spark on asphalt surface
  const arcMat = mat(THREE, 0x80f0ff, { emissive: 0x80f0ff, emissiveIntensity: 4.0, transparent: true, opacity: 0.85 });
  const arc = box(THREE, 0.18, 0.18, 0.18, arcMat);
  arc.position.set(-2.0, 0.09, 0.45);
  g.add(arc);
  // PointLight removed — emissive arc box is bright enough; cuts forward-render cost.
  // Pole acts as a low obstacle (prone tier)
  pushAABB(colliders, f.x, f.z, 5.0, 0.6, { tier: 'prone', tag: 'downedPole', maxY: 0.9 });
  hazardsList.push({ kind: 'electricArc', x: f.x, z: f.z, r: 1.6 });
  animatedOut.push({ kind: 'electricArc', arc, light: null, seed: Math.random() * 100 });
}

// Ignited gas leak — fissure in the asphalt with a roaring flame column.
function buildGasFire(THREE, f, parent, hazardsList, animatedOut) {
  const g = new THREE.Group();
  g.name = 'gasFire';
  g.position.set(f.x, 0, f.z);
  parent.add(g);
  // Cracked asphalt scorch ring
  const scorch = cyl(THREE, 1.3, 1.3, 0.02, mat(THREE, 0x080808, { roughness: 1 }), 18);
  scorch.position.y = 0.012;
  g.add(scorch);
  // Inner crack (slight bright crack line)
  const crack = cyl(THREE, 0.7, 0.7, 0.025, mat(THREE, 0xff4010, { emissive: 0xff4010, emissiveIntensity: 1.2 }), 14);
  crack.position.y = 0.018;
  g.add(crack);
  // Flame body — three nested elongated boxes (orange→yellow inner)
  const flameOuter = box(THREE, 1.0, 2.4, 1.0, mat(THREE, 0xff5020, { emissive: 0xff5020, emissiveIntensity: 2.5, transparent: true, opacity: 0.7 }));
  flameOuter.position.y = 1.2;
  g.add(flameOuter);
  const flameMid = box(THREE, 0.7, 2.0, 0.7, mat(THREE, 0xff9020, { emissive: 0xff9020, emissiveIntensity: 3.5, transparent: true, opacity: 0.85 }));
  flameMid.position.y = 1.0;
  g.add(flameMid);
  const flameInner = box(THREE, 0.4, 1.6, 0.4, mat(THREE, 0xffd060, { emissive: 0xffd060, emissiveIntensity: 5.0, transparent: true, opacity: 0.95 }));
  flameInner.position.y = 0.8;
  g.add(flameInner);
  // PointLight removed — three nested emissive flame boxes already glow strongly.
  hazardsList.push({ kind: 'gasFire', x: f.x, z: f.z, r: 1.6 });
  animatedOut.push({ kind: 'gasFire', layers: [flameOuter, flameMid, flameInner], light: null, seed: Math.random() * 100 });
}

// Toxic chemical puddle — flat glowing sludge slick on the ground.
function buildToxicSpill(THREE, f, parent, hazardsList, animatedOut) {
  const g = new THREE.Group();
  g.name = 'toxicSpill';
  g.position.set(f.x, 0, f.z);
  parent.add(g);
  const w = f.w ?? 4.0;
  const d = f.d ?? 2.5;
  // Outer dark spill stain
  const stain = box(THREE, w + 1.4, 0.012, d + 1.0, mat(THREE, 0x182018, { roughness: 1 }));
  stain.position.y = 0.011;
  g.add(stain);
  // Glowing sludge surface
  const sludgeMat = mat(THREE, 0x40ff60, {
    emissive: 0x40ff60, emissiveIntensity: 1.6,
    transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.1,
  });
  const sludge = box(THREE, w, 0.025, d, sludgeMat);
  sludge.position.y = 0.022;
  g.add(sludge);
  // Bright bubble highlights
  const bubMat = mat(THREE, 0xa0ffb0, { emissive: 0xa0ffb0, emissiveIntensity: 2.4 });
  const bubbles = [];
  for (let i = 0; i < 5; i++) {
    const b = cyl(THREE, 0.12, 0.12, 0.04, bubMat, 8);
    b.position.set((Math.random() - 0.5) * w * 0.7, 0.04, (Math.random() - 0.5) * d * 0.7);
    g.add(b);
    bubbles.push(b);
  }
  // PointLight removed — emissive sludge + bubble materials carry the glow.
  hazardsList.push({ kind: 'toxicSpill', x: f.x, z: f.z, w, d });
  animatedOut.push({ kind: 'toxicSpill', bubbles, sludge: sludgeMat, light: null, seed: Math.random() * 100 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground / streets
// ─────────────────────────────────────────────────────────────────────────────

function buildGround(THREE, parent) {
  const g = new THREE.Group();
  g.name = 'ground';
  parent.add(g);

  // Base asphalt slab covering full bounds — procedural noise texture.
  const W = LEVEL_BOUNDS.maxX - LEVEL_BOUNDS.minX;
  const D = LEVEL_BOUNDS.maxZ - LEVEL_BOUNDS.minZ;
  const asphTex = makeAsphaltTexture(THREE);
  asphTex.wrapS = asphTex.wrapT = THREE.RepeatWrapping;
  asphTex.repeat.set(W / 16, D / 16);
  const asphMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a30, map: asphTex, roughness: 1.0, metalness: 0.05,
  });
  const base = box(THREE, W, 0.2, D, asphMat);
  base.position.y = -0.1;
  g.add(base);

  // ── Roads ───────────────────────────────────────────────────────────────
  // Slightly darker patches over the asphalt indicate vehicle lanes.
  const lane = mat(THREE, 0x14141a, { roughness: 1 });

  // Main N-S avenue (x = 0, full length) — further narrowed to match secondaries.
  const mainNS = box(THREE, 10, 0.04, D, lane); mainNS.position.set(0, 0.011, 0); g.add(mainNS);
  // Secondary N-S avenues at x = ±70
  const wNS = box(THREE, 12, 0.04, D, lane); wNS.position.set(-70, 0.011, 0); g.add(wNS);
  const eNS = box(THREE, 12, 0.04, D, lane); eNS.position.set( 70, 0.011, 0); g.add(eNS);
  // Main E-W avenue (z = -62, runs full width)
  const mainEW = box(THREE, W, 0.04, 14, lane); mainEW.position.set(0, 0.011, -62); g.add(mainEW);
  // Secondary E-W avenue — moved south to z=20 so it doesn't clip izakaya at z=38.
  const sEW = box(THREE, W, 0.04, 12, lane); sEW.position.set(0, 0.011, 20); g.add(sEW);
  // Far north E-W avenue (z = +80)
  const nEW = box(THREE, W, 0.04, 12, lane); nEW.position.set(0, 0.011, 80); g.add(nEW);

  // ── Sidewalks ───────────────────────────────────────────────────────────
  const sidewalkTex = makeSidewalkTexture(THREE);
  sidewalkTex.wrapS = sidewalkTex.wrapT = THREE.RepeatWrapping;
  const swMat = new THREE.MeshStandardMaterial({
    color: 0x383844, map: sidewalkTex, roughness: 1.0,
  });
  function sw(w, d, x, z) {
    const tex = sidewalkTex.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 4, d / 4);
    tex.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ color: 0x383844, map: tex, roughness: 1.0 });
    const s = box(THREE, w, 0.05, d, m);
    s.position.set(x, 0.025, z);
    g.add(s);
  }
  // Flanking the main N-S avenue — sidewalks tight against narrowed road edges.
  sw(3, D, -6.5, 0); sw(3, D, 6.5, 0);
  // Flanking secondary N-S avenues
  sw(3, D, -77, 0); sw(3, D, -63, 0);
  sw(3, D,  63, 0); sw(3, D,  77, 0);
  // Flanking main E-W (z = -62)
  sw(W, 3, 0, -54); sw(W, 3, 0, -70);
  // Flanking secondary E-W (z = 20)
  sw(W, 3, 0,  14); sw(W, 3, 0,  26);
  // Flanking far-north E-W (z = 80)
  sw(W, 3, 0,  74); sw(W, 3, 0,  86);

  // ── Lane markings ───────────────────────────────────────────────────────
  const paint = mat(THREE, 0xd0c060, { emissive: 0xd0c060, emissiveIntensity: 0.22, roughness: 0.7 });
  function dashRow(axis, fromA, toA, fixed) {
    for (let a = fromA; a <= toA; a += 4) {
      const dash = axis === 'z'
        ? box(THREE, 0.3, 0.022, 1.5, paint)
        : box(THREE, 1.5, 0.022, 0.3, paint);
      const pos = axis === 'z' ? [fixed, 0.04, a] : [a, 0.04, fixed];
      dash.position.set(...pos);
      g.add(dash);
    }
  }
  // N-S center dashes (main + secondaries)
  dashRow('z', LEVEL_BOUNDS.minZ + 4, LEVEL_BOUNDS.maxZ - 4, 0);
  dashRow('z', LEVEL_BOUNDS.minZ + 4, LEVEL_BOUNDS.maxZ - 4, -70);
  dashRow('z', LEVEL_BOUNDS.minZ + 4, LEVEL_BOUNDS.maxZ - 4,  70);
  // E-W center dashes
  dashRow('x', LEVEL_BOUNDS.minX + 4, LEVEL_BOUNDS.maxX - 4, -62);
  dashRow('x', LEVEL_BOUNDS.minX + 4, LEVEL_BOUNDS.maxX - 4,  20);
  dashRow('x', LEVEL_BOUNDS.minX + 4, LEVEL_BOUNDS.maxX - 4,  80);

  // ── Crosswalks at intersections (zebra stripes) ─────────────────────────
  const cw = mat(THREE, 0xeeeeee, { roughness: 0.9 });
  function crosswalk(axis, cx, cz, len) {
    for (let i = -3; i <= 3; i++) {
      const s = axis === 'z'
        ? box(THREE, 0.6, 0.025, len, cw)
        : box(THREE, len, 0.025, 0.6, cw);
      const off = i * 0.9;
      const pos = axis === 'z' ? [cx + off, 0.05, cz] : [cx, 0.05, cz + off];
      s.position.set(...pos);
      g.add(s);
    }
  }
  // Major intersections (N-S × E-W avenues)
  crosswalk('z',  0, -55, 5);  crosswalk('x', -6, -62, 5);
  crosswalk('z',  0,  27, 5);  crosswalk('x', -6,  20, 5);
  crosswalk('z',  0,  87, 5);  crosswalk('x', -6,  80, 5);
  crosswalk('z', -70, -55, 4); crosswalk('z', -70,  27, 4);
  crosswalk('z',  70, -55, 4); crosswalk('z',  70,  27, 4);

  // Manhole rings on roads (cosmetic)
  const ring = mat(THREE, 0x18181c, { roughness: 1, metalness: 0.6 });
  const manholes = [[ 0, 50], [0, -30], [0, 100], [70, 0], [-70, 0], [70, -90], [-70, -90]];
  for (const [mx, mz] of manholes) {
    const r = cyl(THREE, 0.7, 0.7, 0.04, ring, 16);
    r.position.set(mx, 0.034, mz);
    g.add(r);
  }

  // ── Zone overlays ────────────────────────────────────────────────────────
  // Helper: place a textured flat plane at y=0.03 (just above sidewalk slabs).
  function zone(texFn, color, w2, d2, x, z, repeatScale) {
    const tex = texFn(THREE);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w2 / repeatScale, d2 / repeatScale);
    const m = new THREE.MeshStandardMaterial({ color, map: tex, roughness: 1.0 });
    const p = box(THREE, w2, 0.015, d2, m);
    p.position.set(x, 0.03, z);
    g.add(p);
  }

  // Small shrine gravel courtyard (shrine at -15, -16 / 10×12 footprint)
  zone(makeShrineGravelTexture, 0x4a4438, 22, 20, -15, -16, 4);

  // Grand shrine approach + plaza (grand shrine at 40, 0 / 20×18 footprint)
  zone(makeShrineGravelTexture, 0x48423a, 30, 26, 40, 0, 4);

  // Plaza stone forecourt in front of department store and cinema
  // (These sit within city blocks so use a lighter color so they show above the block paver)
  zone(makePlazaStoneTexture, 0xffffff, 18, 10, 22, -28, 6);
  zone(makePlazaStoneTexture, 0xffffff, 16, 10, 22,  56, 6);

  // ── Sidewalk utility markings ────────────────────────────────────────────
  // Painted bike-parking outlines (white/yellow rectangles) on sidewalk strips.
  const bikePaint = mat(THREE, 0xe8e0a0, { emissive: 0xe8e0a0, emissiveIntensity: 0.12, roughness: 0.8 });
  function bikeBox(x, z, rot) {
    const frame = new THREE.Group();
    frame.position.set(x, 0.04, z);
    if (rot) frame.rotation.y = rot;
    // Outer rectangle outline (4 thin bars)
    const long = box(THREE, 2.0, 0.015, 0.06, bikePaint);
    const longB = box(THREE, 2.0, 0.015, 0.06, bikePaint);
    const side = box(THREE, 0.06, 0.015, 0.9, bikePaint);
    const sideB = box(THREE, 0.06, 0.015, 0.9, bikePaint);
    long.position.set(0, 0, -0.45);
    longB.position.set(0, 0,  0.45);
    side.position.set(-0.97, 0, 0);
    sideB.position.set( 0.97, 0, 0);
    frame.add(long, longB, side, sideB);
    g.add(frame);
  }
  // A cluster near the konbini (main road west sidewalk)
  bikeBox(-7.2,  6, 0); bikeBox(-7.2,  8.5, 0); bikeBox(-7.2, 11, 0);
  // Near the pachinko / east side
  bikeBox(7.2, -18, 0); bikeBox(7.2, -20.5, 0);
  // Along east secondary road sidewalk
  bikeBox(63.5, -30, Math.PI / 2); bikeBox(63.5, -33, Math.PI / 2);

  // Utility access hatches on sidewalk (painted square outlines, grey)
  const hatchPaint = mat(THREE, 0x5a5a68, { roughness: 0.9 });
  function hatch(x, z) {
    const h2 = box(THREE, 0.7, 0.012, 0.7, hatchPaint);
    h2.position.set(x, 0.038, z);
    g.add(h2);
    const h2i = box(THREE, 0.54, 0.012, 0.54, mat(THREE, 0x3a3a48, { roughness: 1 }));
    h2i.position.set(x, 0.042, z);
    g.add(h2i);
  }
  hatch(-6.8,  40); hatch(-6.8, -10); hatch(6.8,  25); hatch(6.8, -40);
  hatch(-7.1, -55); hatch( 7.1,  70); hatch(-77,   10); hatch(77,  -30);

  // ── City block surfaces ──────────────────────────────────────────────────
  // Each block between roads gets its own distinct paver material.
  // y=0.008 sits above the asphalt base (y=0) but below sidewalk slabs (y=0.025).
  function blk(texFn, color, w2, d2, x, z, rs) {
    const tex = texFn(THREE);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w2 / rs, d2 / rs);
    const m = new THREE.MeshStandardMaterial({ color, map: tex, roughness: 1.0 });
    const p = box(THREE, w2, 0.01, d2, m);
    p.position.set(x, 0.008, z);
    g.add(p);
  }
  // NW quadrant — warm brick-red pavers (shopping-street feel)
  blk(makeWarmPaverTexture,  0xffffff, 54, 46, -35,  50, 6);
  // NE quadrant — beige/cream pavers
  blk(makeBeigePaverTexture, 0xffffff, 54, 46,  35,  50, 6);
  // Central-W — cool slate stone (shrine / office district)
  blk(makePlazaStoneTexture, 0xffffff, 54, 66, -35, -20, 8);
  // Central-E — warm brick again (grand shrine approach)
  blk(makeWarmPaverTexture,  0xffffff, 54, 66,  35, -20, 6);
  // North outer strips (beyond far-north road)
  blk(makeBeigePaverTexture, 0xffffff, 54, 36, -35, 106, 6);
  blk(makeWarmPaverTexture,  0xffffff, 54, 36,  35, 106, 6);
  // South outer blocks
  blk(makePlazaStoneTexture, 0xffffff, 54, 52, -35, -98, 8);
  blk(makeBeigePaverTexture, 0xffffff, 54, 52,  35, -98, 6);
  // Far outer strips (beyond secondary N-S roads) — dark alley concrete
  blk(makeAlleyTexture, 0xffffff, 46, 250, -101, 0, 6);
  blk(makeAlleyTexture, 0xffffff, 46, 250,  101, 0, 6);

  // ── Parking lot markings ─────────────────────────────────────────────────
  // White bay lines + yellow loading stripes scattered across city blocks.
  const bayMat  = mat(THREE, 0xc8c8a8, { roughness: 0.85 });
  const loadMat = mat(THREE, 0xe0b820, { emissive: 0xe0b820, emissiveIntensity: 0.25, roughness: 0.8 });

  // bayRow: a row of parking bays.  dir='x' → bays face along X (row runs along Z).
  function bayRow(cx, cz, count, bayW, bayD, dir) {
    const total = count * bayW;
    // Front + back lines
    for (const side of [-0.5, 0.5]) {
      const line = dir === 'x'
        ? box(THREE, bayD, 0.01, 0.1, bayMat)
        : box(THREE, 0.1, 0.01, bayD, bayMat);
      line.position.set(
        dir === 'x' ? cx + side * bayD : cx,
        0.02,
        dir === 'x' ? cz : cz + side * bayD
      );
      g.add(line);
    }
    // Dividers
    for (let i = 0; i <= count; i++) {
      const off = i * bayW - total / 2;
      const div = dir === 'x'
        ? box(THREE, 0.1, 0.01, bayD, bayMat)
        : box(THREE, bayD, 0.01, 0.1, bayMat);
      div.position.set(
        dir === 'x' ? cx : cx + off,
        0.02,
        dir === 'x' ? cz + off : cz
      );
      g.add(div);
    }
  }

  // Loading zone: yellow border + diagonal stripes
  function loadZone(cx, cz, lw, ld) {
    for (const s of [-0.5, 0.5]) {
      const hline = box(THREE, lw, 0.01, 0.12, loadMat); hline.position.set(cx, 0.022, cz + s * ld); g.add(hline);
      const vline = box(THREE, 0.12, 0.01, ld, loadMat);  vline.position.set(cx + s * lw, 0.022, cz); g.add(vline);
    }
    const diagCount = Math.max(2, Math.floor(lw / 2));
    for (let i = 0; i < diagCount; i++) {
      const dx = (i + 0.5) * (lw / diagCount) - lw / 2;
      const diag = box(THREE, 0.28, 0.01, ld * 1.15, loadMat);
      diag.rotation.y = 0.65;
      diag.position.set(cx + dx, 0.021, cz);
      g.add(diag);
    }
  }

  // Parking rows — south outer blocks (large open lots)
  bayRow(-35, -88, 8, 2.5, 5, 'z');   bayRow(-35, -94, 8, 2.5, 5, 'z');
  bayRow(-35,-100, 8, 2.5, 5, 'z');   bayRow(-35,-106, 8, 2.5, 5, 'z');
  bayRow( 35, -88, 8, 2.5, 5, 'z');   bayRow( 35, -94, 8, 2.5, 5, 'z');
  bayRow( 35,-100, 8, 2.5, 5, 'z');

  // Parking rows — north outer blocks
  bayRow(-35,  97, 7, 2.5, 5, 'z');   bayRow(-35, 103, 7, 2.5, 5, 'z');
  bayRow( 35,  97, 7, 2.5, 5, 'z');   bayRow( 35, 103, 7, 2.5, 5, 'z');

  // Parking rows — central-E back (behind grand shrine, east side)
  bayRow(55, -10, 5, 2.5, 5, 'x');    bayRow(55,   5, 5, 2.5, 5, 'x');
  bayRow(55,  -45, 5, 2.5, 5, 'x');

  // Far outer strips — sparse service parking rows
  bayRow(-101, -50, 4, 2.5, 5, 'z');  bayRow(-101, -60, 4, 2.5, 5, 'z');
  bayRow( 101,  30, 4, 2.5, 5, 'z');  bayRow( 101,  40, 4, 2.5, 5, 'z');
  bayRow( 101, -60, 4, 2.5, 5, 'z');

  // Loading zones — service bays near alleys
  loadZone(-35, -78, 10, 6);
  loadZone( 55,  20,  8, 5);
  loadZone(-101, 10,  6, 8);
  loadZone( 101,-20,  6, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lighting
// ─────────────────────────────────────────────────────────────────────────────

function buildLights(THREE, parent, lightPlan, flickerOut, colliders) {
  const g = new THREE.Group();
  g.name = 'lights';
  parent.add(g);
  for (const L of lightPlan) {
    if (L.kind === 'hemi') {
      const h = new THREE.HemisphereLight(L.sky, L.ground, L.intensity);
      g.add(h);
    } else if (L.kind === 'directional') {
      const d = new THREE.DirectionalLight(L.color, L.intensity);
      d.position.set(L.x, L.y, L.z);
      g.add(d);
    } else if (L.kind === 'point') {
      const p = new THREE.PointLight(L.color, L.intensity, L.dist ?? 18, 2);
      p.position.set(L.x, L.y, L.z);
      g.add(p);
    } else if (L.kind === 'streetlight') {
      const slGroup = new THREE.Group();
      slGroup.position.set(L.x, 0, L.z);
      g.add(slGroup);
      // Pole
      const pole = cyl(THREE, 0.07, 0.1, 5.0, mat(THREE, 0x2a2a2e, { metalness: 0.5, roughness: 0.5 }), 8);
      pole.position.y = 2.5;
      slGroup.add(pole);
      const arm = box(THREE, 0.7, 0.06, 0.06, mat(THREE, 0x2a2a2e, { metalness: 0.5, roughness: 0.5 }));
      arm.position.set(0.35, 5.0, 0);
      slGroup.add(arm);
      // Lamp head — emissive only; PointLight removed (12 streetlights × point
      // light = too many for the forward renderer). Flicker still drives the
      // head's emissiveIntensity; the renderer's update() tolerates a null light.
      const head = box(THREE, 0.5, 0.18, 0.3, mat(THREE, 0xfff7d0, { emissive: 0xfff7d0, emissiveIntensity: 1.6 }));
      head.position.set(0.6, 4.95, 0);
      slGroup.add(head);
      if (L.flicker) flickerOut.push({ light: null, head, base: 1.6 });
      if (colliders) {
        pushAABB(colliders, L.x, L.z, 0.25, 0.25, {
          tier: 'hard', category: 'solid', tag: 'streetlight_pole', maxY: 5.0,
        });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Traffic lights — animated NS / EW phase cycling at every major intersection
// ─────────────────────────────────────────────────────────────────────────────

function buildTrafficLights(THREE, parent, animated, colliders) {
  const g = new THREE.Group();
  g.name = 'trafficLights';
  parent.add(g);

  const poleMat  = mat(THREE, 0x1c1c22, { metalness: 0.65, roughness: 0.4 });
  const houseMat = mat(THREE, 0x0e0e14, { roughness: 0.9 });
  const visorMat = mat(THREE, 0x0a0a10, { roughness: 1.0 });

  // Road half-widths (pole sits at sidewalk corner, offset from road centre)
  const XOFF = 8;   // N-S road
  const ZOFF = 8;   // E-W road

  // All 7 four-way intersections on the grid
  const INTERSECTIONS = [
    { x:   0, z: -62 },
    { x:   0, z:  20 },
    { x:   0, z:  80 },
    { x: -70, z: -62 },
    { x: -70, z:  20 },
    { x:  70, z: -62 },
    { x:  70, z:  20 },
  ];

  // Corner layout: [xSign, zSign, group]
  // group 0 = NS phase (NE + SW diagonal): green while N-S traffic flows
  // group 1 = EW phase (NW + SE diagonal): green while E-W traffic flows
  const CORNERS = [
    [ 1, -1, 0], // NE
    [-1, -1, 1], // NW
    [ 1,  1, 1], // SE
    [-1,  1, 0], // SW
  ];

  function addPole(px, pz, cx, cz, group) {
    const pg = new THREE.Group();
    pg.position.set(px, 0, pz);
    g.add(pg);

    // Arm + housing face diagonally toward the intersection centre
    const facing = Math.atan2(cz - pz, cx - px);
    const fx = Math.cos(facing);
    const fz = Math.sin(facing);
    const ARM = 1.3;

    // Pole
    const pole = cyl(THREE, 0.07, 0.09, 5.6, poleMat, 8);
    pole.position.y = 2.8;
    pg.add(pole);

    // Cap plate on top
    const cap = box(THREE, 0.14, 0.10, 0.14, poleMat);
    cap.position.y = 5.67;
    pg.add(cap);

    // Horizontal arm cantilevering over the road
    const arm = box(THREE, ARM, 0.07, 0.07, poleMat);
    arm.position.set(fx * ARM * 0.5, 5.62, fz * ARM * 0.5);
    pg.add(arm);

    // Signal housing (black vertical box at arm tip)
    const hx = fx * ARM;
    const hz = fz * ARM;
    const house = box(THREE, 0.56, 1.72, 0.46, houseMat);
    house.position.set(hx, 5.04, hz);
    pg.add(house);

    // Visor hoods above each lens — brim sticks forward past the housing front
    const Y = [0.52, 0, -0.52];
    for (const yo of Y) {
      const v = box(THREE, 0.62, 0.04, 0.22, visorMat);
      v.position.set(hx + fx * 0.34, 5.04 + yo + 0.21, hz + fz * 0.34);
      v.rotation.y = facing;
      pg.add(v);
    }

    // Light lenses — spheres so they glow visibly from any camera angle.
    // Centred slightly past the housing front so the back half is hidden
    // inside the housing while the front protrudes cleanly without z-fighting.
    const LENS_COLORS = [0xff2020, 0xffba00, 0x22e840];
    // PointLight per traffic-light pole was 28 lights × 7 intersections — far too
    // many for the forward renderer. Lens spheres are emissive so they still
    // visibly glow; the animator just won't cast spilled light onto the road.
    const glow = null;

    const lenses = LENS_COLORS.map((c, i) => {
      const lm = new THREE.MeshStandardMaterial({
        color: c,
        emissive: c,
        emissiveIntensity: 0.08,
        roughness: 0.3,
      });
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), lm);
      lens.position.set(hx + fx * 0.30, 5.04 + Y[i], hz + fz * 0.30);
      pg.add(lens);
      return { mat: lm };
    });

    // All poles at the same intersection share a seed so they stay in sync
    animated.push({
      kind:   'trafficLight',
      red:    lenses[0],
      yellow: lenses[1],
      green:  lenses[2],
      glow,
      group,
      seed:   cx * 0.17 + cz * 0.11,
    });

    if (colliders) {
      pushAABB(colliders, px, pz, 0.22, 0.22, {
        tier: 'hard', category: 'solid', tag: 'trafficLight_pole', maxY: 5.6,
      });
    }
  }

  for (const { x, z } of INTERSECTIONS) {
    for (const [xs, zs, group] of CORNERS) {
      addPole(x + xs * XOFF, z + zs * ZOFF, x, z, group);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Club spotlight beams — rotating cones on club / love-hotel / billboard
// rooftops that sweep the night sky.  One emissive double-sided cone per beam,
// transparent-additive so they read as light shafts; one slim base post anchors
// the visual to the rooftop.
// ─────────────────────────────────────────────────────────────────────────────

const CLUB_SPOTLIGHT_DEFS = [
  // pachinko rooftop (h=14): pink, fast, paired with second beam offset π
  { x:  22, y: 14.6, z: -28, color: 0xff3aa0, speed: 0.55, tilt: 1.05, baseRot: 0.0,        len: 60, radius: 5.5 },
  { x:  22, y: 14.6, z: -28, color: 0xff3aa0, speed: 0.55, tilt: 1.05, baseRot: Math.PI,    len: 60, radius: 5.5 },
  // loveHotel rooftop (h=13): purple
  { x:  50, y: 13.6, z: -94, color: 0xb066ff, speed: 0.40, tilt: 1.10, baseRot: 0.7,        len: 60, radius: 6.0 },
  { x:  50, y: 13.6, z: -94, color: 0xb066ff, speed: 0.40, tilt: 1.10, baseRot: 0.7+Math.PI, len: 60, radius: 6.0 },
  // midriseC (クラブ, h=24): cyan
  { x:  20, y: 24.6, z: -95, color: 0x44e0ff, speed: 0.32, tilt: 1.00, baseRot: 1.5,        len: 65, radius: 5.8 },
  // billboardTower (h=34): white
  { x:  95, y: 34.6, z:  55, color: 0xffe8c0, speed: 0.25, tilt: 1.15, baseRot: 0.0,        len: 80, radius: 6.5 },
  // billboardTower2 (h=36): pink
  { x: -58, y: 36.6, z: -86, color: 0xff66cc, speed: 0.35, tilt: 1.10, baseRot: 0.4,        len: 80, radius: 6.5 },
  // midriseG (ライブ, h=20): orange
  { x: -100, y: 20.6, z: -44, color: 0xffaa44, speed: 0.45, tilt: 1.00, baseRot: 2.1,        len: 60, radius: 5.5 },
];

function buildClubSpotlights(THREE, parent, animated) {
  const g = new THREE.Group();
  g.name = 'clubSpotlights';
  parent.add(g);

  const postMat = mat(THREE, 0x101018, { metalness: 0.7, roughness: 0.5 });
  // Group beams that share an (x,z) anchor so we only add one base post per spot.
  const seen = new Set();

  for (let i = 0; i < CLUB_SPOTLIGHT_DEFS.length; i++) {
    const d = CLUB_SPOTLIGHT_DEFS[i];
    const key = `${d.x}_${d.z}`;
    if (!seen.has(key)) {
      seen.add(key);
      const post = cyl(THREE, 0.10, 0.14, 0.8, postMat, 8);
      post.position.set(d.x, d.y - 0.4, d.z);
      g.add(post);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 12, 8),
        mat(THREE, 0x222228, { metalness: 0.8, roughness: 0.3 })
      );
      head.position.set(d.x, d.y, d.z);
      g.add(head);
    }

    // Pivot rotates around Y (sweep).  Inside, a tilter group leans the beam
    // away from vertical by `tilt` radians.  The cone geometry is baked so
    // its apex sits at the local origin and the wide end extends along +Y —
    // i.e. straight up before the tilter is applied.
    const pivot = new THREE.Group();
    pivot.position.set(d.x, d.y, d.z);
    g.add(pivot);

    const tilter = new THREE.Group();
    tilter.rotation.x = -d.tilt; // tilt the beam outward (toward +Z in pivot's local frame)
    pivot.add(tilter);

    const beamMat = new THREE.MeshBasicMaterial({
      color: d.color,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const coneGeo = new THREE.ConeGeometry(d.radius, d.len, 18, 1, true);
    coneGeo.translate(0, -d.len / 2, 0); // apex at local origin, base at -d.len
    coneGeo.rotateX(Math.PI);            // flip so base points along +Y
    const cone = new THREE.Mesh(coneGeo, beamMat);
    tilter.add(cone);

    pivot.rotation.y = d.baseRot;

    animated.push({
      kind: 'clubSpotlight',
      target: pivot,
      baseRot: d.baseRot,
      speed: d.speed,
      seed: i * 1.7,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bird flocks — pigeons/crows perched on a rooftop.  Idle until any obstacle
// (player, civilian, alien) approaches within FLEE_RADIUS, then scatter
// skyward along outward-arcing parabolas.  Once well above the city, they
// fade and respawn back on the perch after a cooldown.
// ─────────────────────────────────────────────────────────────────────────────

const BIRD_FLOCK_DEFS = [
  // pachinko rooftop south edge — 6 birds in a row
  { x:  22, y: 14.4, z: -17, dirX:  1, dirZ: 0, count: 6, color: 0x141418 },
  // midriseB rooftop east edge — 5 birds (crows)
  { x: -25, y: 20.4, z: -78, dirX: 0,  dirZ: 1, count: 5, color: 0x0a0a0c },
  // sento rooftop — 7 pigeons
  { x: -95, y:  7.4, z:  64, dirX: 1,  dirZ: 0, count: 7, color: 0x2c2a30 },
];

function buildBirdFlocks(THREE, parent, animated) {
  const g = new THREE.Group();
  g.name = 'birdFlocks';
  parent.add(g);

  for (let f = 0; f < BIRD_FLOCK_DEFS.length; f++) {
    const def = BIRD_FLOCK_DEFS[f];
    const flockGroup = new THREE.Group();
    g.add(flockGroup);
    const bodyMat = mat(THREE, def.color, { roughness: 0.85, metalness: 0.05 });

    const birds = [];
    const SPACING = 0.55;
    const startOff = -(def.count - 1) * 0.5 * SPACING;
    for (let i = 0; i < def.count; i++) {
      const off = startOff + i * SPACING;
      const px = def.x + def.dirX * off;
      const pz = def.z + def.dirZ * off;

      const bg = new THREE.Group();
      bg.position.set(px, def.y, pz);
      flockGroup.add(bg);

      // Body: small flattened ovoid
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), bodyMat);
      body.scale.set(1.0, 0.7, 1.6);
      bg.add(body);

      // Two wing planes (folded tight while perched, fan out while flying)
      const wingGeo = new THREE.PlaneGeometry(0.32, 0.14);
      const wL = new THREE.Mesh(wingGeo, bodyMat);
      const wR = new THREE.Mesh(wingGeo, bodyMat);
      wL.material.side = THREE.DoubleSide;
      wL.position.set(0, 0.04, 0);
      wR.position.set(0, 0.04, 0);
      wL.rotation.y = -Math.PI / 2;
      wR.rotation.y =  Math.PI / 2;
      // Fold along body while perched
      wL.rotation.x = 0.1;
      wR.rotation.x = 0.1;
      bg.add(wL); bg.add(wR);

      birds.push({
        target: bg,
        wL, wR,
        homeX: px, homeY: def.y, homeZ: pz,
        // Parabolic flight: outward velocity + initial up-velocity, gravity-ish
        seed: i * 0.9 + f * 3.1,
        flightX: 0, flightZ: 0,                   // initial outward dir, set on flee
        flightSpeed: 0,
        bodyAng: 0,                               // facing yaw while perched (random)
      });
      bg.rotation.y = Math.random() * Math.PI * 2;
      birds[birds.length - 1].bodyAng = bg.rotation.y;
    }

    animated.push({
      kind: 'birdFlock',
      anchorX: def.x,
      anchorY: def.y,
      anchorZ: def.z,
      birds,
      // 'idle' | 'fleeing' | 'cooldown'
      state: 'idle',
      stateT: 0,
      seed: f * 7.3,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawns / cover empties
// ─────────────────────────────────────────────────────────────────────────────

function buildSpawns(THREE, parent, spawnsData) {
  const g = new THREE.Group();
  g.name = 'spawns';
  parent.add(g);
  const groupFor = (n) => {
    let sub = g.getObjectByName(n);
    if (!sub) { sub = new THREE.Group(); sub.name = n; g.add(sub); }
    return sub;
  };
  for (const s of spawnsData.player) {
    const e = new THREE.Object3D(); e.name = s.name;
    e.position.set(s.x, s.y ?? 0, s.z);
    e.rotation.y = Math.PI / 2 - (s.facing ?? 0);
    e.userData = { kind: 'spawn', team: 'player', ...s };
    groupFor('player').add(e);
  }
  for (const s of spawnsData.enemies) {
    const e = new THREE.Object3D(); e.name = s.name;
    e.position.set(s.x, s.y ?? 0, s.z);
    e.rotation.y = Math.PI / 2 - (s.facing ?? 0);
    e.userData = { kind: 'spawn', team: 'enemy', ...s };
    groupFor('enemies').add(e);
  }
  for (const s of spawnsData.cover) {
    const e = new THREE.Object3D(); e.name = s.name;
    e.position.set(s.x, s.y ?? 0, s.z);
    e.userData = { kind: 'cover', ...s };
    groupFor('cover').add(e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Elevated expressway ring — Shuto-style concrete flyover around the map edge.
// Runs at x=±110 and z=±110, deck at y=6.  Beyond it, thicker fog hides the void.
// ─────────────────────────────────────────────────────────────────────────────

function buildExpressway(THREE, parent, colliders) {
  const g = new THREE.Group();
  g.name = 'expressway';
  parent.add(g);

  // Pre-create all shared materials once — reused across all 4 segments
  const conc      = mat(THREE, 0x50505c, { roughness: 0.95 });
  const concDk    = mat(THREE, 0x2c2c36, { roughness: 1.0  });
  const jbar      = mat(THREE, 0x5a5a68, { roughness: 0.85 });
  const stripeM   = mat(THREE, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 });
  const signBg    = mat(THREE, 0x0e4020, { roughness: 0.9  });
  const signTx    = mat(THREE, 0xe8e8d8, { emissive: 0xe8e8d8, emissiveIntensity: 0.6, roughness: 0.8 });
  const lampM     = mat(THREE, 0xffeecc, { emissive: 0xffeecc, emissiveIntensity: 3.0 });
  const dashPaint = mat(THREE, 0xd8c858, { emissive: 0xd8c858, emissiveIntensity: 0.15, roughness: 0.8 });

  const DECK_Y  = 6.0;
  const DECK_H  = 0.55;
  const DECK_W  = 11.0;
  const PIR_H   = DECK_Y - DECK_H;
  const EDGE    = 125;   // map boundary is ±125; deck centerline sits on the edge
  const SPAN    = 264;   // covers ±132 so corners of adjacent segments overlap cleanly

  function segment(axis, fixedCoord) {
    const cx = axis === 'x' ? 0 : fixedCoord;
    const cz = axis === 'x' ? fixedCoord : 0;

    // Deck slab
    const deck = axis === 'x'
      ? box(THREE, SPAN, DECK_H, DECK_W, conc)
      : box(THREE, DECK_W, DECK_H, SPAN, conc);
    deck.position.set(cx, DECK_Y - DECK_H / 2, cz);
    g.add(deck);
    if (colliders) {
      // Elevated deck (player walks under freely since min.y ≈ 5.45 > 2.0).
      // maxY includes the jersey barriers (deck top + 0.9 barrier = DECK_Y + 0.9).
      const dw = axis === 'x' ? SPAN : DECK_W;
      const dd = axis === 'x' ? DECK_W : SPAN;
      pushAABB(colliders, cx, cz, dw, dd, {
        tier: 'hard', category: 'solid', tag: 'expressway_deck',
        minY: DECK_Y - DECK_H, maxY: DECK_Y + 0.9, jumpable: false,
      });
    }

    // Soffit
    const sof = axis === 'x'
      ? box(THREE, SPAN, 0.08, DECK_W - 0.6, concDk)
      : box(THREE, DECK_W - 0.6, 0.08, SPAN, concDk);
    sof.position.set(cx, DECK_Y - DECK_H - 0.04, cz);
    g.add(sof);

    // Jersey barriers + reflective stripe
    for (const side of [-1, 1]) {
      const bOff = side * (DECK_W / 2 - 0.3);
      const b = axis === 'x'
        ? box(THREE, SPAN, 0.9, 0.38, jbar)
        : box(THREE, 0.38, 0.9, SPAN, jbar);
      b.position.set(
        axis === 'x' ? cx : fixedCoord + bOff,
        DECK_Y + 0.45,
        axis === 'x' ? fixedCoord + bOff : cz
      );
      g.add(b);
      const stripe = axis === 'x'
        ? box(THREE, SPAN, 0.06, 0.38, stripeM)
        : box(THREE, 0.38, 0.06, SPAN, stripeM);
      stripe.position.set(
        axis === 'x' ? cx : fixedCoord + bOff,
        DECK_Y + 0.93,
        axis === 'x' ? fixedCoord + bOff : cz
      );
      g.add(stripe);
    }

    // Lane centre dashes — every 14u (sparse enough to not overwhelm)
    for (let a = -SPAN / 2 + 3; a < SPAN / 2 - 3; a += 14) {
      const dash = axis === 'x'
        ? box(THREE, 3.5, 0.018, 0.22, dashPaint)
        : box(THREE, 0.22, 0.018, 3.5, dashPaint);
      dash.position.set(
        axis === 'x' ? a + 1.75 : fixedCoord,
        DECK_Y + 0.008,
        axis === 'x' ? fixedCoord : a + 1.75
      );
      g.add(dash);
    }

    // Support pillars every 18u (reduced from 9)
    for (let a = -SPAN / 2 + 9; a < SPAN / 2 - 4; a += 18) {
      const px = axis === 'x' ? a : fixedCoord;
      const pz = axis === 'x' ? fixedCoord : a;
      const pier = axis === 'x'
        ? box(THREE, 1.0, PIR_H, DECK_W - 2.5, conc)
        : box(THREE, DECK_W - 2.5, PIR_H, 1.0, conc);
      pier.position.set(px, PIR_H / 2, pz);
      g.add(pier);
      const cap = axis === 'x'
        ? box(THREE, 1.1, 0.55, DECK_W - 0.5, concDk)
        : box(THREE, DECK_W - 0.5, 0.55, 1.1, concDk);
      cap.position.set(px, PIR_H + 0.28, pz);
      g.add(cap);
      if (colliders) {
        const pw = axis === 'x' ? 1.0 : DECK_W - 2.5;
        const pd = axis === 'x' ? DECK_W - 2.5 : 1.0;
        pushAABB(colliders, px, pz, pw, pd, {
          tier: 'hard', category: 'solid', tag: `expressway_pier`, maxY: PIR_H + 0.55,
        });
      }
    }

    // Sodium lamps every 36u — halved from 18 to cut PointLight count
    for (let a = -SPAN / 2 + 8; a < SPAN / 2 - 6; a += 36) {
      const lx = axis === 'x' ? a : fixedCoord - (DECK_W / 2 - 0.8);
      const lz = axis === 'x' ? fixedCoord - (DECK_W / 2 - 0.8) : a;
      const pole = box(THREE, 0.12, 1.4, 0.12, concDk);
      pole.position.set(lx, DECK_Y + 0.7, lz);
      g.add(pole);
      const head = box(THREE, 0.55, 0.14, 0.28, lampM);
      head.position.set(lx, DECK_Y + 1.47, lz);
      g.add(head);
      // Sodium PointLight removed — emissive head box still glows; cuts ~24
      // lights from the elevated expressway alone (forward render limit).
    }

    // Sign gantries every ~80u
    for (let a = -SPAN / 2 + 40; a < SPAN / 2 - 20; a += 80) {
      const gx = axis === 'x' ? a : fixedCoord;
      const gz = axis === 'x' ? fixedCoord : a;
      for (const side of [-1, 1]) {
        const postOff = side * (DECK_W / 2 + 0.4);
        const post = box(THREE, 0.25, 3.2, 0.25, conc);
        post.position.set(
          axis === 'x' ? gx : gx + postOff,
          DECK_Y + 1.6,
          axis === 'x' ? gz + postOff : gz
        );
        g.add(post);
      }
      const beam = axis === 'x'
        ? box(THREE, 0.2, 0.3, DECK_W + 1.0, conc)
        : box(THREE, DECK_W + 1.0, 0.3, 0.2, conc);
      beam.position.set(gx, DECK_Y + 3.35, gz);
      g.add(beam);
      const sign = axis === 'x'
        ? box(THREE, 0.1, 1.1, DECK_W - 0.8, signBg)
        : box(THREE, DECK_W - 0.8, 1.1, 0.1, signBg);
      sign.position.set(gx, DECK_Y + 2.65, gz);
      g.add(sign);
      for (const tOff of [-0.3, 0.15]) {
        const txt = axis === 'x'
          ? box(THREE, 0.06, 0.18, DECK_W * 0.55, signTx)
          : box(THREE, DECK_W * 0.55, 0.18, 0.06, signTx);
        txt.position.set(
          axis === 'x' ? gx : gx + 0.06,
          DECK_Y + 2.65 + tOff,
          axis === 'x' ? gz + 0.06 : gz
        );
        g.add(txt);
      }
    }
  }

  segment('x',  EDGE);
  segment('x', -EDGE);
  segment('z',  EDGE);
  segment('z', -EDGE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sky / fog
// ─────────────────────────────────────────────────────────────────────────────

function buildSky(THREE, scene) {
  // Denser fog so the void beyond the expressway fades out naturally.
  scene.fog = new THREE.FogExp2(0x141e30, 0.009);
  // Inverted-cube skybox with 6 procedural faces (city silhouette + stars + moon).
  const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const mats = faces.map(f => {
    const tex = makeSkyTexture(THREE, f);
    return new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(800, 800, 800), mats);
  cube.name = 'skybox';
  cube.renderOrder = -1000;
  // Remove existing skybox if re-applied
  const existing = scene.getObjectByName('skybox');
  if (existing) scene.remove(existing);
  scene.add(cube);
  // Set background to deep sky color so any seam shows the right tone
  scene.background = new THREE.Color(0x05080f);
}

// ─────────────────────────────────────────────────────────────────────────────
// Master builder
// ─────────────────────────────────────────────────────────────────────────────

function makePropBuilders(animatedOut) {
  return {
    vendingCluster: buildVendingCluster,
    verticalSign:   (THREE, p, parent /*, colliders*/) => buildVerticalSign(THREE, p, parent, animatedOut),
    powerPole:      buildPowerPole,
    bicycle:        buildBicycle,
    keiTruck:       buildKeiTruck,
    scooter:        buildScooter,
    trashPile:      buildTrashPile,
    crateStack:     buildCrateStack,
    lanternRow:     (THREE, p, parent /*, colliders*/) => buildLanternRow(THREE, p, parent, animatedOut),
    aFrame:         buildAFrame,
    acUnit:         (THREE, p, parent /*, colliders*/) => buildAcUnit(THREE, p, parent),
    steamVent:      (THREE, p, parent /*, colliders*/) => buildSteamVent(THREE, p, parent, animatedOut),
    puddle:         (THREE, p, parent /*, colliders*/) => buildPuddle(THREE, p, parent),
    foodCart:       buildFoodCart,
    sakeBarrels:    buildSakeBarrels,
    waterTank:      buildWaterTank,
    duct:           buildDuct,
    stoneLantern:   buildStoneLantern,
    offeringBox:    buildOfferingBox,
    bollardLine:    buildBollardLine,
    // New
    billboard:       buildBillboard,
    hangingSign:     (THREE, p, parent, colliders) => buildHangingSign(THREE, p, parent, colliders, animatedOut),
    gasMain:         buildGasMain,
    crashedCar:      buildCrashedCar,
    tippedDumpster:  buildTippedDumpster,
    phoneBooth:      buildPhoneBooth,
    gachapon:        buildGachapon,
    postBox:         buildPostBox,
    parkingMeter:    buildParkingMeter,
    utilityBox:      buildUtilityBox,
    cardboardBoxes:  buildCardboardBoxes,
    trafficCones:    buildTrafficCones,
    roadBarrier:     buildRoadBarrier,
    posterStrip:     (THREE, p, parent /*, colliders*/) => buildPosterStrip(THREE, p, parent),
    graffitiDecal:   (THREE, p, parent /*, colliders*/) => buildGraffitiDecal(THREE, p, parent),
    benchPair:       buildBenchPair,
    sidewalkSign:    buildSidewalkSign,
    satellite:       (THREE, p, parent /*, colliders*/) => buildSatellite(THREE, p, parent),
    rooftopUnit:     buildRooftopUnit,
  };
}

export function buildKabukichoLevel(THREE, opts = {}) {
  const root = new THREE.Group();
  root.name = 'kabukicho_level';

  const groups = {
    buildings: new THREE.Group(),
    props:     new THREE.Group(),
    lights:    new THREE.Group(),
    spawns:    new THREE.Group(),
    hazards:   new THREE.Group(),
    decals:    new THREE.Group(),
  };
  for (const [k, gr] of Object.entries(groups)) { gr.name = k; root.add(gr); }

  const colliders = [];
  const hazards = [];
  const flickerLights = [];
  const animated = [];
  const sharedMats = { _animated: animated };

  // Ground
  buildGround(THREE, groups.decals);

  // Elevated expressway ring around map edge
  buildExpressway(THREE, groups.buildings, colliders);

  // Buildings — build with per-iteration tagging so the level editor can
  // identify which Three.js group + colliders belong to which BUILDINGS entry.
  // We copy BUILDINGS into `levelBuildings` so applyLevelEdits can mutate
  // per-instance positions without poisoning the module-level constant.
  const levelBuildings = BUILDINGS.map(b => ({ ...b }));
  for (let bi = 0; bi < levelBuildings.length; bi++) {
    const b = levelBuildings[bi];
    const childStart = groups.buildings.children.length;
    const colStart   = colliders.length;
    buildBuilding(THREE, b, groups.buildings, colliders, sharedMats);
    for (let c = childStart; c < groups.buildings.children.length; c++) {
      groups.buildings.children[c].userData.editorRef = { kind: 'building', index: bi };
    }
    for (let c = colStart; c < colliders.length; c++) {
      colliders[c].buildingIndex = bi;
    }
  }

  // Tactical features (ladders, plank, manhole, drain, vault window collider)
  for (const f of TACTICAL_FEATURES) {
    if (f.kind === 'fireLadder') {
      const b = BUILDINGS.find(x => x.id === f.buildingId);
      if (b) buildFireLadder(THREE, b, f.wall, groups.buildings, colliders, f.wallOffset ?? 0);
    } else if (f.kind === 'plank') {
      buildPlank(THREE, f, groups.buildings, colliders);
    } else if (f.kind === 'rooftopBeam') {
      buildRooftopBeam(THREE, f.from, f.to, groups.buildings, colliders);
    } else if (f.kind === 'manhole') {
      buildManhole(THREE, f, groups.hazards, hazards, colliders);
    } else if (f.kind === 'stormDrain') {
      buildStormDrain(THREE, f, groups.hazards, colliders, hazards);
    } else if (f.kind === 'steamGrate') {
      buildSteamGrate(THREE, f, groups.hazards, hazards, animated);
    } else if (f.kind === 'electricArc') {
      buildElectricArc(THREE, f, groups.hazards, colliders, hazards, animated);
    } else if (f.kind === 'gasFire') {
      buildGasFire(THREE, f, groups.hazards, hazards, animated);
    } else if (f.kind === 'toxicSpill') {
      buildToxicSpill(THREE, f, groups.hazards, hazards, animated);
    } else if (f.kind === 'vaultWindow') {
      // Just record metadata + an Object3D marker
      const b = BUILDINGS.find(x => x.id === f.buildingId);
      if (b) {
        const e = new THREE.Object3D();
        e.name = `vaultwindow_${f.buildingId}`;
        const off = (b.w / 2) + 0.05;
        e.position.set(b.x + off, f.y, b.z);
        e.userData = { kind: 'vaultWindow', ...f };
        groups.buildings.add(e);
      }
    }
  }

  // Props — same tagging scheme as buildings. Per-prop copy so editor edits
  // don't mutate the source PROPS_INITIAL constant.
  const propBuilders = makePropBuilders(animated);
  const sourcePropList = (opts.props ?? PROPS_INITIAL);
  const levelProps = sourcePropList.map(p => ({ ...p }));
  for (let pi = 0; pi < levelProps.length; pi++) {
    const p = levelProps[pi];
    const fn = propBuilders[p.type];
    if (!fn) continue;
    const childStart = groups.props.children.length;
    const colStart   = colliders.length;
    fn(THREE, p, groups.props, colliders);
    for (let c = childStart; c < groups.props.children.length; c++) {
      groups.props.children[c].userData.editorRef = { kind: 'prop', index: pi };
    }
    for (let c = colStart; c < colliders.length; c++) {
      colliders[c].propIndex = pi;
    }
  }

  // Power cables — connect adjacent poles in each declared sequence.
  buildPowerCables(THREE, opts.cables ?? POWER_CABLE_SEQUENCES, groups.props);

  // Micro-prop instanced scatter (cig butts, paper trash, leaves, glass)
  buildMicroProps(THREE, groups.props, opts.micro ?? MICRO_SCATTERS);

  // Trees & cherry blossoms — scattered across open ground (avoids buildings/roads)
  buildTrees(THREE, groups.props, {
    count: 70,
    seed: 91237,
    minX: -118, maxX: 118, minZ: -118, maxZ: 118,
    avoid: _bldgAvoid,
  }, colliders);

  // Vehicle traffic (animated cars on main avenues)
  buildVehicleTraffic(THREE, groups.props, opts.vehicles ?? VEHICLE_PATHS, animated, colliders);

  // Lights
  buildLights(THREE, groups.lights, opts.lights ?? LIGHT_PLAN, flickerLights, colliders);

  // Traffic lights at road intersections
  buildTrafficLights(THREE, groups.props, animated, colliders);

  // Rotating club spotlights on club / love-hotel / billboard rooftops
  buildClubSpotlights(THREE, groups.lights, animated);

  // Bird flocks on rooftops — scatter when player approaches
  buildBirdFlocks(THREE, groups.props, animated);

  // Spawns
  buildSpawns(THREE, groups.spawns, opts.spawns ?? SPAWNS);

  // Outer level boundary AABBs (4 walls so play stays inside 250×250)
  const t = 2;
  const W = LEVEL_BOUNDS.maxX - LEVEL_BOUNDS.minX;
  const D = LEVEL_BOUNDS.maxZ - LEVEL_BOUNDS.minZ;
  pushAABB(colliders, 0, LEVEL_BOUNDS.minZ - t / 2, W + t * 2, t, { tier: 'hard', tag: 'wall_s' });
  pushAABB(colliders, 0, LEVEL_BOUNDS.maxZ + t / 2, W + t * 2, t, { tier: 'hard', tag: 'wall_n' });
  pushAABB(colliders, LEVEL_BOUNDS.minX - t / 2, 0, t, D, { tier: 'hard', tag: 'wall_w' });
  pushAABB(colliders, LEVEL_BOUNDS.maxX + t / 2, 0, t, D, { tier: 'hard', tag: 'wall_e' });

  // ── Validation pass ─────────────────────────────────────────────────────
  // Per spec: log warnings for elevated colliders (min.y > 0) whose lowest
  // point sits in the head-strike zone (under 2.0u). Anything meant to be
  // walked under should clear 2u; anything that drops below is likely a
  // generation bug.
  for (const c of colliders) {
    if (c.minY > 0.05 && c.minY < 2.0 && !c.requires_crouch && c.category !== 'climbable') {
      // Plank decks, rooftop beams, fire-escape platforms et al. are intended
      // to be stood on, not walked under — skip those (their tag will hint).
      const standableTags = new Set(['plank', 'rooftopBeam', 'rooftopUnit', 'duct', 'watertank']);
      if (standableTags.has(c.tag)) continue;
      COLLIDER_WARNINGS.push(
        `[collider] elevated '${c.tag ?? '?'}' min.y=${c.minY.toFixed(2)} in head-strike zone (<2.0u); flag requires_crouch=true if intentional`
      );
    }
  }
  if (COLLIDER_WARNINGS.length > 0) {
    // Log distinct messages once each, then clear the buffer so reloads start fresh.
    const seen = new Set();
    for (const w of COLLIDER_WARNINGS) if (!seen.has(w)) { seen.add(w); console.warn(w); }
    COLLIDER_WARNINGS.length = 0;
  }

  // Animator: an update(dt, time) function that handles flicker, sway, vehicles.
  let flickerSeed = 1;
  // Cosmetic effects (sign flicker, lantern sway, hanging-sign sway, steam,
  // antenna blink) drive a sin/cos with no gameplay state — running them at
  // 30 Hz instead of 60 Hz is visually indistinguishable but halves the
  // emissive-uniform / scale writes per frame. Vehicles, traffic lights,
  // and hazards keep running every frame because they affect collision /
  // damage timing.
  const HALF_RATE_KINDS = new Set([
    'signFlicker', 'lanternSway', 'hangingSway', 'steamPulse',
    'steamGrate', 'antennaBlink', 'birdFlock', 'clubSpotlight',
  ]);
  let _frameParity = 0;
  // opts.obstacles: optional [{ x, z, r? }] — characters (player, civilians,
  // aliens) for vehicles to brake for. r defaults to 0.5u.
  const update = (dt, time, opts = {}) => {
    const obstacles = opts.obstacles || null;
    _frameParity ^= 1;
    flickerSeed = (flickerSeed * 1664525 + 1013904223) | 0;
    for (const fl of flickerLights) {
      const r = ((flickerSeed >>> 0) / 4294967296);
      const blackout = r < 0.02;
      const noise = 0.85 + 0.3 * Math.sin(time * 13 + r * 7);
      const k = blackout ? 0.15 : noise;
      if (fl.light) fl.light.intensity = fl.base * k;
      if (fl.head && fl.head.material && fl.head.material.emissiveIntensity != null) {
        fl.head.material.emissiveIntensity = 2.4 * k;
      }
      flickerSeed = (flickerSeed * 1664525 + 1013904223) | 0;
    }
    // Animated entries (signs, lanterns, hanging signs, vehicles, steam).
    // Cosmetic kinds run at 30 Hz via parity skip; gameplay kinds run at 60 Hz.
    for (let i = 0; i < animated.length; i++) {
      const a = animated[i];
      if (HALF_RATE_KINDS.has(a.kind) && ((i ^ _frameParity) & 1)) continue;
      if (a.kind === 'signFlicker') {
        const seedR = (Math.sin(time * 7.7 + a.seed) + 1) * 0.5;
        const blackout = seedR > 0.985;
        const k = blackout ? 0.1 : (0.85 + 0.3 * Math.sin(time * 11 + a.seed * 3));
        a.mat.emissiveIntensity = a.base * k;
      } else if (a.kind === 'lanternSway') {
        const ang = Math.sin(time * a.speed + a.seed) * a.amp;
        if (a.axis === 'x') a.target.rotation.x = ang;
        else a.target.rotation.z = ang;
      } else if (a.kind === 'hangingSway') {
        a.target.rotation.x = Math.sin(time * a.speed + a.seed) * a.amp;
        a.target.rotation.z = Math.cos(time * a.speed * 0.7 + a.seed) * a.amp * 0.6;
      } else if (a.kind === 'steamPulse') {
        for (let i = 0; i < a.billows.length; i++) {
          const b = a.billows[i];
          const phase = time * 0.6 + a.seed + i * 0.7;
          b.material.opacity = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(phase));
          b.position.y = 0.6 + i * 0.7 + Math.sin(phase) * 0.15;
          const s = 1 + 0.15 * Math.sin(phase * 1.3);
          b.scale.set(s, s, s);
        }
      } else if (a.kind === 'antennaBlink') {
        const phase = (Math.sin(time * 2.4 + a.seed) + 1) * 0.5;
        const on = phase > 0.5;
        if (a.target.material) a.target.material.emissiveIntensity = on ? 4.5 : 0.4;
      } else if (a.kind === 'steamGrate') {
        // Duty-cycle ON/OFF; during ON, billows rise and fade.
        const t = (time + a.seed) % a.period;
        const onT = t < a.period * a.dutyOn;
        for (let i = 0; i < a.billows.length; i++) {
          const b = a.billows[i];
          const phase = time * 1.4 + a.seed + i * 0.6;
          const target = onT ? (0.16 + 0.18 * (0.5 + 0.5 * Math.sin(phase))) : 0;
          b.material.opacity += (target - b.material.opacity) * 0.12;
          b.position.y = 0.5 + i * 0.7 + Math.sin(phase) * 0.18;
          const s = 1 + 0.2 * Math.sin(phase * 1.1);
          b.scale.set(s, 1, s);
        }
        // Accent stripes brighten during ON
        const accentI = onT ? (1.4 + 0.6 * Math.sin(time * 8 + a.seed)) : 0.4;
        for (const acc of a.accents) acc.material.emissiveIntensity = accentI;
      } else if (a.kind === 'electricArc') {
        // Random sharp flicker — mostly bright, occasional brief blackout
        const r = (Math.sin(time * 23 + a.seed) + 1) * 0.5;
        const r2 = (Math.sin(time * 41 + a.seed * 2.3) + 1) * 0.5;
        const dim = (r > 0.93) || (r2 < 0.05);
        const k = dim ? 0.2 : (3.0 + 2.0 * r2);
        if (a.arc.material) {
          a.arc.material.emissiveIntensity = k;
          a.arc.material.opacity = dim ? 0.3 : (0.7 + 0.3 * r2);
          // Tiny size jitter for crackle feel
          const sc = 0.7 + 0.6 * r2;
          a.arc.scale.set(sc, sc, sc);
        }
        if (a.light) a.light.intensity = dim ? 0.1 : (0.4 + 0.5 * r2);
      } else if (a.kind === 'gasFire') {
        // Each layer flickers at a slightly different rate; intensities pulse.
        for (let i = 0; i < a.layers.length; i++) {
          const layer = a.layers[i];
          const phase = time * (5 + i * 1.7) + a.seed + i * 0.9;
          const k = 0.85 + 0.3 * Math.sin(phase);
          if (layer.material) layer.material.emissiveIntensity = (i === 0 ? 2.5 : i === 1 ? 3.5 : 5.0) * k;
          const sx = 1 + 0.08 * Math.sin(phase * 1.3);
          const sy = 1 + 0.10 * Math.sin(phase * 0.9);
          layer.scale.set(sx, sy, sx);
        }
        if (a.light) a.light.intensity = 1.4 + 0.5 * Math.sin(time * 6 + a.seed);
      } else if (a.kind === 'toxicSpill') {
        // Sludge breathes; bubbles bob.
        const k = 1.4 + 0.4 * Math.sin(time * 1.6 + a.seed);
        if (a.sludge) a.sludge.emissiveIntensity = k;
        for (let i = 0; i < a.bubbles.length; i++) {
          const b = a.bubbles[i];
          const phase = time * 1.3 + a.seed + i * 1.4;
          b.position.y = 0.04 + 0.03 * (0.5 + 0.5 * Math.sin(phase));
          const s = 0.9 + 0.25 * Math.sin(phase * 1.7);
          b.scale.set(s, 1, s);
        }
        if (a.light) a.light.intensity = 0.5 + 0.25 * Math.sin(time * 1.6 + a.seed);
      } else if (a.kind === 'trafficLight') {
        // 60s cycle:  group 0 (NS) green 0–25, yellow 25–28, red 28–60
        //             group 1 (EW) red 0–30, green 30–55, yellow 55–58, red 58–60
        const period = 60;
        const t = ((time + a.seed * 7) % period + period) % period;
        let r, y, gn, gc;
        if (a.group === 0) {
          if (t < 25)      { r = 0.08; y = 0.08; gn = 5.0; gc = 0x22e840; }
          else if (t < 28) { r = 0.08; y = 4.0;  gn = 0.08; gc = 0xffba00; }
          else             { r = 5.0;  y = 0.08; gn = 0.08; gc = 0xff2020; }
        } else {
          if (t < 30)      { r = 5.0;  y = 0.08; gn = 0.08; gc = 0xff2020; }
          else if (t < 55) { r = 0.08; y = 0.08; gn = 5.0; gc = 0x22e840; }
          else if (t < 58) { r = 0.08; y = 4.0;  gn = 0.08; gc = 0xffba00; }
          else             { r = 5.0;  y = 0.08; gn = 0.08; gc = 0xff2020; }
        }
        a.red.mat.emissiveIntensity    = r;
        a.yellow.mat.emissiveIntensity = y;
        a.green.mat.emissiveIntensity  = gn;
        if (a.glow) { a.glow.color.setHex(gc); a.glow.intensity = 1.2; }
      } else if (a.kind === 'clubSpotlight') {
        a.target.rotation.y = a.baseRot + time * a.speed;
      } else if (a.kind === 'birdFlock') {
        // State machine: idle → fleeing (when obstacle within FLEE_RADIUS)
        // → cooldown → idle.
        const FLEE_RADIUS = 6.0;
        const FLEE_DUR = 6.0;
        const COOLDOWN = 5.0;

        if (a.state === 'idle') {
          // Idle wing twitch + occasional head bob.  Cheap.
          for (let i = 0; i < a.birds.length; i++) {
            const b = a.birds[i];
            const ph = time * 6 + b.seed * 11;
            const tw = Math.sin(ph) * 0.04;
            b.wL.rotation.x = 0.1 + tw;
            b.wR.rotation.x = 0.1 - tw;
            b.target.position.y = b.homeY + Math.sin(time * 1.7 + b.seed * 3) * 0.01;
          }
          // Trigger check
          let trigger = false;
          if (obstacles && obstacles.length) {
            for (const o of obstacles) {
              const dx = o.x - a.anchorX;
              const dz = o.z - a.anchorZ;
              if (dx * dx + dz * dz < FLEE_RADIUS * FLEE_RADIUS) { trigger = true; break; }
            }
          }
          if (trigger) {
            a.state = 'fleeing';
            a.stateT = 0;
            // Initialize flight vectors per bird: outward from flock anchor +
            // small random spread + slight forward push along facing.
            for (const b of a.birds) {
              const dx = b.homeX - a.anchorX;
              const dz = b.homeZ - a.anchorZ;
              const baseAng = (Math.abs(dx) + Math.abs(dz) > 0.001)
                ? Math.atan2(dz, dx)
                : Math.random() * Math.PI * 2;
              const ang = baseAng + (Math.random() - 0.5) * 1.2;
              b.flightX = Math.cos(ang);
              b.flightZ = Math.sin(ang);
              b.flightSpeed = 4.5 + Math.random() * 2.0;
              b.bodyAng = ang;
              b.target.rotation.y = -ang + Math.PI / 2;
              // Wings open
              b.wL.rotation.x = -0.4;
              b.wR.rotation.x = -0.4;
            }
          }
        } else if (a.state === 'fleeing') {
          a.stateT += dt;
          for (let i = 0; i < a.birds.length; i++) {
            const b = a.birds[i];
            const t = a.stateT;
            // Outward XZ + parabolic Y: rise fast, level off.
            b.target.position.x = b.homeX + b.flightX * b.flightSpeed * t;
            b.target.position.z = b.homeZ + b.flightZ * b.flightSpeed * t;
            const upV = 5.5;
            b.target.position.y = b.homeY + upV * t - 0.3 * t * t;
            // Wing flap
            const flapPh = time * 22 + b.seed * 13;
            const flap = Math.sin(flapPh) * 0.9;
            b.wL.rotation.x = -0.4 + flap;
            b.wR.rotation.x = -0.4 - flap;
          }
          if (a.stateT > FLEE_DUR) {
            a.state = 'cooldown';
            a.stateT = 0;
          }
        } else if (a.state === 'cooldown') {
          a.stateT += dt;
          // Hide birds far above the city while cooling down
          for (const b of a.birds) {
            b.target.position.y = b.homeY + 80;
          }
          if (a.stateT > COOLDOWN) {
            // Check obstacles still away before respawn — otherwise extend cooldown
            let near = false;
            if (obstacles && obstacles.length) {
              for (const o of obstacles) {
                const dx = o.x - a.anchorX;
                const dz = o.z - a.anchorZ;
                if (dx * dx + dz * dz < (FLEE_RADIUS + 2) * (FLEE_RADIUS + 2)) { near = true; break; }
              }
            }
            if (!near) {
              a.state = 'idle';
              a.stateT = 0;
              for (const b of a.birds) {
                b.target.position.set(b.homeX, b.homeY, b.homeZ);
                b.target.rotation.y = b.bodyAng;
                b.wL.rotation.x = 0.1;
                b.wR.rotation.x = 0.1;
              }
            } else {
              a.stateT = 0; // keep waiting
            }
          }
        }
      } else if (a.kind === 'vehicle') {
        // Advance t along polyline, set position+yaw.
        const path = a.path;
        if (!path || path.length < 2) continue;
        // Compute total length, intersection stop-checkpoints once and cache.
        if (a._segLens == null) {
          a._segLens = [];
          a._total = 0;
          for (let i = 0; i < path.length - 1; i++) {
            const dx = path[i + 1].x - path[i].x;
            const dz = path[i + 1].z - path[i].z;
            const L = Math.hypot(dx, dz);
            a._segLens.push(L);
            a._total += L;
          }
          // Stops: arc-positions where the path enters an intersection.
          // Detected by scanning each segment for one whose end is much closer
          // to an intersection centre than its start (within 5u). Stop-line is
          // placed 1.6u before the entry waypoint so cars halt on the approach.
          a._stops = [];
          {
            // STOP_RADIUS is the distance from the intersection centre at
            // which a car should park. Solving for the path's entry into
            // this disk gives a consistent stop line regardless of where
            // the path waypoint sits — fixes cars halting inside the box
            // when the next waypoint happens to lie near the centre.
            const STOP_RADIUS = 12.0;
            let arc = 0;
            for (let i = 0; i < path.length - 1; i++) {
              const p0 = path[i], p1 = path[i + 1];
              const segLen = a._segLens[i];
              for (const ix_iz of TRAFFIC_INTERSECTIONS) {
                const dx0 = p0.x - ix_iz.x, dz0 = p0.z - ix_iz.z;
                const dx1 = p1.x - ix_iz.x, dz1 = p1.z - ix_iz.z;
                const d0 = Math.hypot(dx0, dz0);
                const d1 = Math.hypot(dx1, dz1);
                if (d1 < STOP_RADIUS && d0 > d1 + 1) {
                  const vx = p1.x - p0.x, vz = p1.z - p0.z;
                  const A = vx*vx + vz*vz;
                  const B = 2 * (vx*dx0 + vz*dz0);
                  const C = dx0*dx0 + dz0*dz0 - STOP_RADIUS*STOP_RADIUS;
                  const disc = B*B - 4*A*C;
                  let tStop = 0;
                  if (disc >= 0 && A > 1e-6) {
                    const sd = Math.sqrt(disc);
                    const ta = (-B - sd) / (2*A);
                    const tb = (-B + sd) / (2*A);
                    if (ta >= 0 && ta <= 1) tStop = ta;
                    else if (tb >= 0 && tb <= 1) tStop = tb;
                  }
                  const isNS = Math.abs(vz) > Math.abs(vx);
                  const stopArc = arc + tStop * segLen;
                  a._stops.push({ arcLen: stopArc, ix: ix_iz.x, iz: ix_iz.z, isNS });
                  break;
                }
              }
              arc += segLen;
            }
          }
          a._stops.sort((p, q) => p.arcLen - q.arcLen);
        }

        // Current arc-position and current segment direction (for collision lookahead)
        const myArc = a.t * a._total;
        let dist = myArc;
        let segI = 0;
        while (segI < a._segLens.length - 1 && dist > a._segLens[segI]) {
          dist -= a._segLens[segI];
          segI++;
        }
        const f = a._segLens[segI] > 0 ? dist / a._segLens[segI] : 0;
        const p0 = path[segI], p1 = path[segI + 1];
        const meX = p0.x + (p1.x - p0.x) * f;
        const meZ = p0.z + (p1.z - p0.z) * f;
        const segL = a._segLens[segI] || 1;
        const fwdX = (p1.x - p0.x) / segL;
        const fwdZ = (p1.z - p0.z) / segL;

        // ── Decide target speed ────────────────────────────────────────────
        let targetSpeed = a.speed;

        // Physics-based brake target: with decel cap DECEL the speed at which
        // a car can still stop within `d` units is sqrt(2 * DECEL * d). Solving
        // backward gives the highest target speed that stops cleanly at the
        // marker; cars never coast through the safe distance.
        const DECEL = 8.0;
        const safeSpeed = (d) => d <= 0 ? 0 : Math.sqrt(2 * DECEL * d);

        // (1) Red-light braking: brake so the car stops 0.5u before the line.
        const LOOK_LIGHT = 14;
        for (const s of a._stops) {
          let d = s.arcLen - myArc;
          if (d < -2) d += a._total;
          if (d < -0.05 || d > LOOK_LIGHT) continue;
          if (!_isLightGo(time, s.ix, s.iz, s.isNS)) {
            targetSpeed = Math.min(targetSpeed, safeSpeed(d - 0.5));
          }
          break;
        }

        // (2) Vehicle-ahead braking: stop at SAFE_GAP centre-to-centre. Cars are
        // ~4u long, so 8u leaves ~4u of clear road between bumpers. LOOK_AHEAD
        // must exceed SAFE_GAP plus the full-speed stopping distance so the
        // brake is enforceable before the gap closes.
        const LOOK_AHEAD = 14.0;
        const SAFE_GAP   = 8.0;
        let nearestAhead = Infinity;
        for (const b of animated) {
          if (b === a || b.kind !== 'vehicle' || !b.target) continue;
          const ox = b.target.position.x - meX;
          const oz = b.target.position.z - meZ;
          const along = ox * fwdX + oz * fwdZ;
          if (along < 0.2 || along > LOOK_AHEAD) continue;
          const lat = -ox * fwdZ + oz * fwdX;
          if (Math.abs(lat) > 1.7) continue;
          // Heading filter: only follow cars heading roughly the same way.
          // Without this, a perpendicular car stopped at a red light is seen
          // as a "leader" by cross-traffic with the green, deadlocking the
          // intersection. Oncoming cars (dot < 0) get filtered out too.
          if (b._fwdX != null) {
            const hdot = b._fwdX * fwdX + b._fwdZ * fwdZ;
            if (hdot < 0.5) continue;
          }
          if (along < nearestAhead) nearestAhead = along;
        }
        // Cache my forward for other vehicles to read next frame.
        a._fwdX = fwdX; a._fwdZ = fwdZ;
        if (nearestAhead < LOOK_AHEAD) {
          targetSpeed = Math.min(targetSpeed, safeSpeed(nearestAhead - SAFE_GAP));
        }

        // (3) Obstacle braking: civilians, players, aliens. Brake to stop
        //     ~PED_GAP units before the obstacle's leading edge so cars
        //     never run characters over.
        if (obstacles && obstacles.length) {
          const PED_LOOK = 14.0;
          const PED_GAP  = 3.5;
          let nearestPed = Infinity;
          for (const o of obstacles) {
            const ox = o.x - meX;
            const oz = o.z - meZ;
            const along = ox * fwdX + oz * fwdZ;
            const r = (o.r ?? 0.5);
            if (along < 0.2 || along > PED_LOOK) continue;
            const lat = -ox * fwdZ + oz * fwdX;
            if (Math.abs(lat) > 1.7 + r) continue;
            const edge = along - r;
            if (edge < nearestPed) nearestPed = edge;
          }
          if (nearestPed < PED_LOOK) {
            targetSpeed = Math.min(targetSpeed, safeSpeed(nearestPed - PED_GAP));
          }
        }

        // ── Speed control: brake instantly so the safeSpeed curve is honoured
        //    exactly (smoothing lag here causes overshoot into the safe gap),
        //    but ramp acceleration smoothly when the path is clear.
        if (a.curSpeed == null) a.curSpeed = a.speed;
        if (targetSpeed < a.curSpeed) {
          a.curSpeed = targetSpeed;
        } else {
          a.curSpeed = Math.min(targetSpeed, a.curSpeed + 3.0 * dt);
        }
        if (a.curSpeed < 0) a.curSpeed = 0;

        // ── Advance + place ───────────────────────────────────────────────
        a.t += (a.curSpeed * dt) / a._total;
        a.t -= Math.floor(a.t);
        a.target.position.set(meX, 0, meZ);
        a.target.rotation.y = -Math.atan2(p1.z - p0.z, p1.x - p0.x);
        updateVehicleCollider(a.collider, meX, meZ, fwdX, fwdZ);
      }
    }
  };

  return {
    root,
    groups,
    colliders,
    hazards,
    spawns: opts.spawns ?? SPAWNS,
    bounds: LEVEL_BOUNDS,
    buildings: levelBuildings,
    props: levelProps,
    update,
    applyAtmosphere: (scene) => buildSky(THREE, scene),
  };
}

export function exportColliderJSON(level, pretty = true) {
  // Strip legacy 2D fields from the export — gameplay/AI/bullet code consuming
  // the JSON should use the spec format only. The in-memory level.colliders
  // still carries both formats for runtime back-compat with the 2D collision
  // engine in src/engine/collision.js.
  const colliders = level.colliders.map(c => ({
    type: c.type,
    category: c.category,
    bounds: c.bounds,
    jumpable: c.jumpable,
    requires_crouch: c.requires_crouch,
    tags: c.tags,
  }));
  const data = {
    bounds: level.bounds,
    spawns: level.spawns,
    hazards: level.hazards,
    colliders,
    buildings: level.buildings.map(b => ({ id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, type: b.type })),
  };
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}
