# Gantz — Claude project notes

Multiplayer first-person roguelike inspired by the Gantz manga/anime. Browser-only,
static-hostable, P2P via Trystero. Built for the Ordinary Game Jam #1 format.

Live preview: `http://localhost:8766/` (see `.claude/launch.json`).

---

## Architecture

```
game.js                 ← orchestrator; owns phase + input + network glue
src/
  engine/               ← framework-agnostic primitives
    loop.js             ← fixed 60Hz update, variable render
    input.js            ← keyboard + mouse, setInputSuspended for modals
    collision.js        ← circle/AABB push-out + hitscan raycast
    rng.js              ← seeded mulberry32 (for deterministic procgen)
    state.js            ← Phase enum + phase machine
    world.js            ← world container + entity factory
  render3d/             ← the live renderer (Three.js)
    scene3d.js          ← scene manager, camera (FP), mesh pools, raycast to ground
    factories.js        ← mesh builders: humans, aliens, props, buildings, rooms
  render/               ← 2D canvas renderers (drawAlienPortrait, drawAlien, drawHuman, etc.)
  net/
    trystero.js         ← multi-CDN loader
    network.js          ← room, host election, 15Hz pose, chat/session/roster channels
  content/
    palettes.js, humanSpec.js, alienSpec.js, propSpec.js, npcRoster.js,
    mapGen.js, achievements.js
  combat/
    weapons.js, aliens.js
  ai/
    npcCombat.js        ← personality-weighted NPC combat + chat lines
  scenes/
    lobby.js, mission.js
  ui/
    chat.js, gantzMenu.js
```

### The big seam: data spec → renderer
Every visible entity is described as a **data spec** (human, alien, prop, building).
`factories.js` turns specs into Three.js meshes. Game logic never touches meshes.
To swap renderers (back to 2D, or to another 3D engine), replace `scene3d.js` +
`factories.js`; nothing else changes.

### Retained-mode rendering
Unlike a 2D immediate-mode loop, `scene3d.render(state, dt)` diffs game state
against persistent mesh pools (`humans`, `aliens`, `props` maps) — creating,
updating, or pruning meshes per frame. One call from `game.js` drives everything.

---

## Coordinate conventions

- **World units are meters.** Always.
- **Game logic uses 2D `(x, y)`.** AI, collision, entity positions, net broadcasts.
- **3D renderer maps `(x, y)` → `(x, 0, y)`.** The 2D "y" axis is the 3D Z axis.
- **Facing angle** `player.facing = atan2(dy, dx)` in game coords.
  In first-person, it's derived from camera yaw: `atan2(-cos(yaw), -sin(yaw))`.

This is why collision, movement, AI all stayed untouched when we migrated to 3D.

---

## Phase machine (host-authoritative)

`LOBBY → BRIEFING → MISSION → DEBRIEF → LOBBY` (infinite loop until wipe)

| Phase     | Triggered by                     | UI shown                  | Shop | Weapons fire |
|-----------|----------------------------------|---------------------------|------|--------------|
| LOBBY     | Initial / after DEBRIEF timer    | Gantz menu available      | ✓    | ✗            |
| BRIEFING  | All humans ready → host starts   | Gantz ball canvas UI      | ✗    | ✗            |
| MISSION   | Briefing timer → host teleports  | Mission HUD + weapon HUD  | ✗    | ✓            |
| DEBRIEF   | All aliens dead, timer, or wipe  | Debrief overlay (10s)     | ✓    | ✗            |

Host drives transitions in `hostTick(nowMs)`. Session state is broadcast on every
change + every 1.5s (`SESSION_REBROADCAST_MS`) so late joiners catch up.

### Ready rules
- Players toggle ready via the Gantz menu (`E` near sphere).
- NPCs auto-ready. AFK humans auto-ready after 3 minutes of inactivity.
- DEBRIEF timer can be pre-empted by all-ready → straight to next BRIEFING.

### Wipe (permadeath)
If ALL humans + NPCs die in a mission, it's a total wipe:
- Player points → 0, loadout → baseline, roster → reset.
- `gantz:stats.totalWipes` increments. `missionsCompleted` and
  `hundredPointClub` achievements persist across wipes.

---

## Networking

**Trystero** (Nostr strategy), no backend, keyless. App ID `gantz-jam-2026`,
room ID `gantz-global-lobby` (single global room for now).

Channels (via `room.makeAction`):
| Channel     | Shape                               | Frequency       |
|-------------|-------------------------------------|-----------------|
| `pose`      | player pose + ready + specSeed      | 15 Hz           |
| `chat`      | `{ text, username, color, ts }`     | on send         |
| `session`   | full session state (host → all)     | on change + 1.5s|
| `aliens`    | alien array (host → all)            | 10 Hz in mission|
| `shot`      | tracer endpoints for visuals        | on fire         |
| `hit`       | shooter → host: "I hit X"           | on impact       |
| `kill`      | host → all: "Y killed X for N pts"  | on confirmed kill|
| `rosterA`   | roster version announce             | on join         |
| `rosterF`   | full roster (on version mismatch)   | as needed       |

**Host election** is deterministic: lowest peer ID among connected peers wins.
Auto-migration on peer leave. Host is the only peer that:
- Spawns aliens and runs their AI
- Runs NPC recruit AI (when enabled)
- Applies damage / awards points / broadcasts kills
- Advances session phase

### Bandwidth rule
- Seed-generated static content (map props, building layouts, NPC specs) **never
  syncs** — same seed = same result on every peer.
- Dynamic-transient (tracers, footsteps) **never syncs** — each peer renders
  their own for feel.
- Authoritative state (positions, HP, phase, points) syncs.

---

## Collision

`src/engine/collision.js` — simple 2D (circle-vs-circle + circle-vs-AABB) with
push-out resolution, plus a `hitscan` ray helper.

**Tiers** attached to every collider:
- `hard` — blocks movement AND bullets (walls, crates, pillars, Gantz ball)
- `prone` — blocks movement, bullets pass overhead (benches, trash)
- `decorative` — ignored entirely (lamps, signs)

Characters (`player`, NPCs, aliens, civilians) use soft pairwise push so they
don't stack or lock up.

---

## Key systems & gotchas

- **Never delay `menu.closeMenu()` for cosmetic effects.** Movement, input, pointer
  lock, and combat all gate on `menu.isOpen()`. Keeping it `true` during a fade
  delay freezes the game. The correct pattern: call `closeMenu()` immediately so
  game state is clean, then do purely cosmetic rendering in `_drawBallMenu` using a
  timestamp (`_menuFadeOutAt`) and `justClosed = !isOpen && _menuWasOpenRaw`.
  `ctx.globalAlpha` in `_btn` calls must use `disabled = false` so colors aren't
  forced to `'#003010'` (near-black). Wrap fade draws in `ctx.save()`/`ctx.restore()`
  to prevent globalAlpha leaking into subsequent frames.

- **`window.__gantz`** exposes runtime state (`player`, `session`, `net`, `aliens()`,
  `menu`, `scene3d`, `forceReady()`, etc.) for dev / testing via `preview_eval`.
- **Pointer lock**: click canvas to lock. Chat input focus + menu open auto-exit
  lock (a MutationObserver watches `#gantz-menu` display).
- **Mouse aim in 3D = camera forward vector projected to XZ** (`getCameraForwardXZ`).
  `tryFire` uses this, not ground raycast.
- **Movement in 3D is camera-relative** — W=forward, A/D strafe, based on yaw.
- **Viewmodel (scene3d.js)**: `viewWeapon` group is `camera.add`'d. Hip→ADS lerp driven
  by `_adsT` (smoothstepped → `_adsE`). `triggerMuzzleFlash()` sets `_barrelExtend = 1`
  for the panel fire spike. Panel mesh refs (`_panelL/R/B` = Object_7/8/6) are lazily
  resolved in the render loop after the GLB loads. Muzzle flash sphere radius 0.09.
- **Gantz HUD screen** (`_scrCanvas` 256×128): drawn each frame in `_drawGantzScreen`.
  Safe UV region: X 59–211, Y 4–31. `_scrTex.needsUpdate = true` every frame.
- **Local player mesh is hidden** in first-person mode (scene3d checks
  `state.firstPerson`). Other players still see you.
- **Room switching**: scene3d tracks `currentRoomKind` ('lobby' | 'mission') and
  rebuilds the room group on phase change. Entity pools prune stale meshes.
  The map must have `missionMap._seed = session.missionSeed` stamped on it or
  the room rebuilds every frame (shader recompile storm).
- **Tracers**: `emitTracer()` queues for scene3d next frame; scene3d owns TTL.
- **Scale convention**: eye height 1.7m, player radius 0.35m, Gantz ball 1.2m,
  mission bounds 40×40m, lobby bounds 18×14m.
- **Facing ↔ yaw**: `facing = atan2(-cos(yaw), -sin(yaw))`, inverse is
  `yaw = atan2(-cos(facing), -sin(facing))`. Both must be set on mission spawn.

### Briefing UI — canvas renderer, NOT the HTML overlay
The briefing screen is drawn entirely on a 2D canvas by the **Gantz ball renderer**
in `game.js` (search `// ── BRIEFING phase ──`, ~line 1715). It uses a pixel font
and typewriter effect. **Do not edit `refreshPhaseOverlay`** for briefing visuals.

- Portrait slot: `{ isMug: true }` row in `rows[]`; dimensions `PW=130, PH=155`
- Drawn via `_getPortraitCanvas(tgt.archetype, tgt.specSeed, PW, PH)` →
  `drawAlienPortrait` (offscreen canvas) → `ctx.drawImage`
- `_portraitCache` (Map) caches canvases per mission; cleared on briefing start
- Target data (`archetype`, `specSeed`) set in `hostStartBriefing` on `session.targets[i]`
- `drawAlienPortrait` lives in `src/render/drawAlienPortrait.js`; 5 body plans:
  biped, quadruped, serpent, floater, insectoid

### Alien names
- Pool of 65 names in `src/content/alienSpec.js` (`ALIEN_NAMES`)
- `pickAlienNames(seed, count)` draws unique names deterministically per mission
- Called in `hostStartBriefing`; result stored on `session.targets[i].name`

---

## Storage (localStorage)

| Key             | Content                                   | Reset on            |
|-----------------|-------------------------------------------|---------------------|
| `gantz:roster`  | Persistent NPC recruits (names, seeds, points, gear) | Total wipe |
| `gantz:stats`   | Lifetime achievements (100pt club, missions cleared, wipes, bosses) | Never (honor-system) |

Purge both to start fresh:
```js
localStorage.removeItem('gantz:roster');
localStorage.removeItem('gantz:stats');
location.reload();
```

---

## Current state / deferred

**Shipped:**
- Full 13-chunk plan complete (engine → combat → NPCs → death → polish)
- 3D migration done (Three.js retained-mode scene)
- First-person camera with pointer lock + head bob + weapon view model + muzzle flash
- Canonical Gantz lobby room (tatami, shoji doors, Tokyo skyline, futon, kotatsu, TV)
- Procedural shopping-street mission map with civilians, buildings, props
- Four alien archetypes (patroller, brute, swarmer, boss) + bonus-boss roll
- Mystery-roll shop, mission modifiers, last-alien pulse, spectate mode
- Randomized alien names (65-name pool, seeded per mission, deterministic across peers)
- Detailed canvas portrait system in briefing (`drawAlienPortrait` — 5 body plans,
  dossier aesthetic with Gantz scan UI, threat bar, per-spec colors/features)
- First-person X-Gun viewmodel: ADS transition, head bob, muzzle flash, recoil spring
- ADS muzzle flash centred at barrel tip (local X −0.188); FOV narrows 72°→55° in ADS
- ADS recoil scaled 50% at full aim (`adsScale = 1 − 0.5 * _adsT`)
- Barrel panel fire animation: Object_7/8/6 splay open on shoot (smoothstep spike,
  spring-decays at dt×6); panel refs resolved lazily after GLB load
- Gantz HUD canvas texture on `craneo_pantalla` mesh: TARGETS / POINTS / WEAPON
  readout, neon glow (`shadowBlur`), sweep line gradient, glitch flicker effect
  (safe draw region X 59–211, Y 4–31 derived from UV bounds U 0.204–0.839)
- Shot tracers removed (local + network); new shooting effect TBD

**Disabled (re-enable when ready):**
- NPC recruits (Mika/Rina/Nori/Hiro) — `const npcs = []` in game.js; roster
  system is intact, just not populated into the scene. Three lines to restore
  (see comments above `const npcs = []` and in `applyRoster`).

**Not built yet:**
- Portal Protocol integration (jam deadline feature) — `portal.js` is loaded
  but unused; would let players travel between jam games.
- Proper gear drop-on-death + pickup UX (hooks are in place, no visual yet).
- Revive flow from shop (points are deducted, but no "revive-on-next-mission"
  state carryover wired to enterPhase).
- Audio (user is providing files).
- Additional mission themes beyond shopping street (residential, park, subway, etc).
- Dedicated crosshair + damage indicator + reload animations.
- New shooting effect to replace removed tracers.
- Remove gun viewmodel from lobby once all gun work is done (currently visible for testing).

---

## Running / developing

```
# Serve locally (via .claude/launch.json)
Preview server starts at http://localhost:8766/

# Key files to reload on change
game.js, src/**/*.js, style.css, index.html  # just Ctrl+R in browser

# Dev hook
window.__gantz in DevTools — all runtime state
window.__gantz.forceReady()  // skip readying up
```

If Python isn't available, the launch config uses `Trapped/server.ps1` copied
to `gantz/server.ps1` — a minimal PowerShell HttpListener static server.
