import { makeRng } from './src/engine/rng.js';
import {
  initInput, moveAxis, getMouse, setMouseWorld, endFrameInput,
  setInputSuspended, wasPressed, isDown,
} from './src/engine/input.js';
import { startLoop } from './src/engine/loop.js';
import { audio } from './src/engine/audio.js';
import { Phase, makePhaseMachine } from './src/engine/state.js';
import { makeWorld } from './src/engine/world.js';
import { createScene3d } from './src/render3d/scene3d.js';
import { generateHumanSpec } from './src/content/humanSpec.js';
import { drawHuman } from './src/render/drawHuman.js';
import { drawProp } from './src/render/drawProp.js';
import { drawGantzBall } from './src/render/drawGantzBall.js';
import { resolveAgainstStatic, resolveCharacterOverlaps, circleVsCircle } from './src/engine/collision.js';
import {
  LOBBY_BOUNDS, GANTZ_BALL,
  buildLobbyProps, buildLobbyWalls, getGantzBallCollider,
  planWanderer, checkStuckWanderer, drawLobby,
} from './src/scenes/lobby.js';
import {
  MISSION_BOUNDS, buildMissionWalls, missionSpawn, drawMissionGround,
} from './src/scenes/mission.js';
import { generateMissionMap, planCivilian } from './src/content/mapGen.js';
import { drawBuilding } from './src/render/drawBuilding.js';
import { drawAlien } from './src/render/drawAlien.js';
import { drawAlienPortrait } from './src/render/drawAlienPortrait.js';
import { hitscan } from './src/engine/collision.js';
import { WEAPONS, SUITS, baseLoadout, rollRandomWeapon, rollSuitUpgrade } from './src/combat/weapons.js';
import {
  rollMissionComposition, rollBonusBoss,
  spawnFromComposition, spawnBonusBoss,
  planAlien, tickMarked,
} from './src/combat/aliens.js';
import { ARCHETYPES, generateAlienSpec, pickAlienNames } from './src/content/alienSpec.js';
import { createNetwork } from './src/net/network.js';
import { createChatUI } from './src/ui/chat.js';
import { createGantzMenu } from './src/ui/gantzMenu.js';
import {
  initGantzHud, tickGantzHud, setGantzHudView, setGantzHudActive,
  gantzHudOnFire, gantzHudOnPoints, gantzHudTransmission, gantzHudAmbient,
} from './src/ui/gantzHud.js';
import {
  getStats, recordMissionResult, recordWipe, saveStats,
} from './src/content/achievements.js';

const APP_ID = 'gantz-jam-2026';
const ROOM_ID = 'gantz-global-lobby';
const PLAYER_COLOR = 'c8142b';
const INTERACT_RADIUS = 2.8;
const DOOR_INTERACT_RADIUS = 1.8;
const AFK_MS = 180000;

// Lobby interactive doors — 4 doors matching addDoor calls in factories.js.
// Game (x, y) positions of the door openings (2D: game-x = 3D-x, game-y = 3D-z).
const _LOBBY_DOORS = [
  { x: -5, y:  5.5 },   // 0 — Bedroom  (left wall, near player spawn)
  { x: -5, y: -1.5 },   // 1 — Bathroom (left wall, mid)
  { x:  0, y: -8   },   // 2 — Kitchen  (far wall)
  { x:  0, y:  8   },   // 3 — Hallway  (back wall)
];
const _doorOpen = [false, false, false, false];  // toggled by E

// Jam Portal — inside the Hallway room (door 3, back wall).
// Trigger position in game coords (x=3D-x, y=3D-z): hallway far wall at y≈12.15.
const _PORTAL_POS    = { x: 0, y: 11.6 };
const _PORTAL_RADIUS = 1.6;
let   _portalBusy    = false; // prevent double-trigger before redirect navigates away

// Door colliders — mutable AABBs, tier toggled hard/decorative with door state.
// Wall AABB centre positions: left wall x = B.minX - t/2 = -5.25,
//   far wall y = B.minY - t/2 = -8.25, back wall y = B.maxY + t/2 = 8.25.
// DW = 1.25 (door width), t = 0.5 (wall thickness) — must match lobby.js / factories.js.
const _doorColliders = [
  { kind: 'aabb', x: -5.25, y:  5.5, w: 0.5,  h: 1.25, tier: 'hard' }, // 0 Bedroom
  { kind: 'aabb', x: -5.25, y: -1.5, w: 0.5,  h: 1.25, tier: 'hard' }, // 1 Bathroom
  { kind: 'aabb', x:  0,    y: -8.25, w: 1.25, h: 0.5,  tier: 'hard' }, // 2 Kitchen
  { kind: 'aabb', x:  0,    y:  8.25, w: 1.25, h: 0.5,  tier: 'hard' }, // 3 Hallway
];

// Phase timings (chunk 5 values; mission duration scales per alien load in Chunk 7)
const BRIEFING_MS = 16000;
const MISSION_BASE_MS = 30000;
const DEBRIEF_MS = 25000;
const SESSION_REBROADCAST_MS = 1500;
const READY_COUNTDOWN_MS = 6000;
const ALIENS_BROADCAST_MS = 100;
const CIVILIAN_PENALTY = 20;
const ALIEN_KILL_POINTS_DEFAULT = 100;

const canvas = document.getElementById('game');
const scene3d = createScene3d({ canvas });
const renderer = {
  screenToWorld(x, y) { return scene3d.screenToGround(x, y) || { x: 0, y: 0 }; },
  getCamera() { return { x: 0, y: 0, zoom: 1 }; },
  setCamera() {},
  getSize() { return { w: canvas.clientWidth, h: canvas.clientHeight }; },
};
initInput(canvas);

// ---- Ball menu canvas rendering ----
// Button hit regions populated during _drawBallMenu, consumed by click handler.
const _ballBtns = {};
let _ballHover = null;
const _PF = '"Press Start 2P", monospace';
const _INTRO_TEXT = "Your old life is over. I will decide how you use your new life. That's just the way it is.";

const _DEBRIEF_COMMENTS = {
  died: [
    "You died. Points don't matter to a corpse.",
    "Dead. I still counted you. Out of habit.",
    "You didn't make it. Noted. Unfavorably.",
    "Gone mid-mission. How inconvenient for everyone.",
    "You fell. The mission continued without you.",
    "Dead. I've already begun looking for a replacement.",
    "You expired. The number reflects that.",
    "I watched you die. I didn't intervene. I want you to know that.",
    "You were alive at the start. That's all I can confirm.",
    "Death is a performance review. You failed it.",
    "You died out there. Don't take it personally. Actually, do.",
    "I revived you once. You squandered it immediately.",
    "You were in the mission. Then you weren't. Typical.",
    "Dead. The number next to your name is the last thing you contributed.",
    "You didn't survive. I'll file that under expected outcomes.",
    "I've seen faster deaths. This one was still fast.",
    "You fell mid-mission. The aliens didn't stop to acknowledge it. Neither did I.",
    "Gone. I've already moved on. You should too. When you can.",
    "You died with points on the table. That's the part that bothers me.",
    "Dead. You were functional up until the moment you weren't.",
  ],
  zero: [
    "You did nothing.",
    "Zero. That's a complete sentence.",
    "Nothing. Not even a scratch on anything.",
    "I'm not surprised.",
    "Zero points. You were there in body only.",
    "You contributed the minimum possible. Less, actually.",
    "Nothing. Absolutely nothing.",
    "I didn't notice you out there. The numbers confirm it.",
    "Zero. Keep that number in mind.",
    "Not a single point. I didn't think that was possible.",
    "You were present. That's your only achievement.",
    "You were a warm body with a gun and you managed zero.",
    "I've had empty rooms perform better.",
    "Nothing to say. Nothing was done.",
    "You showed up. That's where it ends.",
    "Zero. A complete absence of contribution. Impressive in the wrong direction.",
    "I've seen people contribute nothing before. You're consistent with them.",
    "The mission happened around you. Not because of you.",
    "You were armed and present. Both facts are irrelevant given the score.",
    "Zero. I won't forget that. You should.",
  ],
  low: [
    "Almost nothing.",
    "Barely conscious.",
    "That's all you could manage?",
    "I've seen furniture do more.",
    "Tragic. But technically nonzero.",
    "You were armed. Puzzling outcome.",
    "I expected less. You delivered exactly less.",
    "The gun was loaded. I checked.",
    "You tried. Barely. Maybe.",
    "I've had better results from people who were running away.",
    "The score reflects your effort. Unfortunately.",
    "Below zero would have required trying.",
    "Something happened. Nothing good.",
    "You survived. Your contribution didn't.",
    "Laughable. But I'm not laughing.",
    "A number. Technically. That's all I'll say.",
    "You were in the field. The field didn't notice.",
    "This is what minimal looks like. You found it.",
    "Not zero. Barely. The distinction is not flattering.",
    "You occupied space in the mission. That's the full summary.",
  ],
  poor: [
    "Below average. Story of your life.",
    "Not enough.",
    "More than zero. That's where the praise ends.",
    "Underwhelming.",
    "Mediocre. And I'm being generous.",
    "You showed up. The bar was higher than that.",
    "I've seen better from people who weren't paying attention.",
    "You tried. It shows. Not favorably.",
    "This is disappointing without being surprising.",
    "The gun helped. Not much. But some.",
    "Low. Not catastrophically low. Just low.",
    "I've seen worse. I didn't enjoy those either.",
    "A number. Not a good one.",
    "Substandard. But acknowledged.",
    "You put in the effort of someone who mostly didn't.",
    "Below where I'd like you to be. Significantly.",
    "You participated. The result suggests otherwise.",
    "This won't go on the highlight reel. There is no highlight reel.",
    "Insufficient. As an output and, frankly, as an effort.",
    "You were in a combat zone. The combat zone has questions about your involvement.",
  ],
  average: [
    "Average. Like everything else about you.",
    "Fine. Just fine.",
    "You did your job. Don't expect praise.",
    "Acceptable. Barely.",
    "I've seen worse. Not much worse, but worse.",
    "This is the middle. You found it.",
    "You hit exactly the number I expected. That bothers me.",
    "Functional. That's the word.",
    "Average. The most forgettable number there is.",
    "You blended in. With the results, mostly.",
    "Not bad. Not good. Exactly not either.",
    "The median. Congratulations on your mediocrity.",
    "I've processed thousands like this. I don't remember any of them.",
    "You did what was required. Nothing else.",
    "Adequate. I won't say it warmly.",
    "You met the baseline. The baseline is not impressive.",
    "Middle of the distribution. You live there.",
    "Expected. Utterly expected.",
    "You performed at exactly the level I'd forget about by morning.",
    "Neither bad enough to address nor good enough to acknowledge. You exist in the gap.",
  ],
  decent: [
    "Decent. I won't say it again.",
    "Above average. Suspicious.",
    "You managed something.",
    "Not bad. I'll note it.",
    "I've seen worse. Often.",
    "More than I expected. Slightly.",
    "That's respectable. Don't ruin it.",
    "You pulled your weight this time.",
    "Better than most. Still not impressive.",
    "I'm acknowledging it. That's all you get.",
    "That's a real number. Well done, technically.",
    "You performed. I noticed. Briefly.",
    "Above the line. For once.",
    "Solid. I don't say that to just anyone. Actually I do. But still.",
    "You were useful out there. Mostly.",
    "That's above what I'd dismiss. Barely, but above.",
    "You contributed. The mission reflects it. Somewhat.",
    "Not bad. I'm noting that without enthusiasm, but I'm noting it.",
    "Above average without being remarkable. A stable place to be.",
    "You held your end up. I'll acknowledge that and move on.",
  ],
  good: [
    "Good. Don't get used to this feeling.",
    "Impressive. For you.",
    "You earned that. I suppose.",
    "That's more like it. Finally.",
    "I'm almost satisfied.",
    "You did well. That's not easy to say.",
    "Good work. I won't elaborate.",
    "Finally. Something worth noting.",
    "You were useful out there. I noticed.",
    "That's the performance I required. Well done. Barely.",
    "I'm not unimpressed. Note the phrasing.",
    "Good. You've raised my expectations. I'll try not to hold that against you.",
    "That's a good result. I'll forget I said that.",
    "You exceeded the threshold. Narrowly.",
    "I watched you work. You were good. Don't mention it.",
    "That's a number I can work with. Well done.",
    "You performed at a level that requires acknowledgment. Acknowledged.",
    "Good. More like that. If you can manage it.",
    "I won't pretend that's not a strong result. It is.",
    "You were effective out there. I registered it. Don't make a thing of it.",
  ],
  elite: [
    "Excellent. You're still replaceable.",
    "Outstanding. I don't say that often.",
    "You were a weapon today. A good one.",
    "I'm almost impressed.",
    "That's the best I've seen in a while.",
    "I'll remember this. Briefly.",
    "You exceeded expectations. My expectations are low, but still.",
    "Remarkable. Don't let it define you.",
    "Fine. You're useful. For now.",
    "That performance will be noted. Favorably. This time.",
    "I don't give compliments. Consider this an absence of criticism.",
    "You performed at a level I find difficult to dismiss.",
    "Exceptional. I'll deny saying that later.",
    "This is what I made you for. You're welcome.",
    "The number speaks. I'll let it.",
    "That's elite performance. I won't say it twice.",
    "I've seen thousands of hunters. That result puts you somewhere specific. Somewhere good.",
    "You were exactly what the mission needed. I find that irritating to admit.",
    "Outstanding. I expected less. I'm revising my model of you. Slightly. Upward.",
    "That's a number that demands acknowledgment. Consider it acknowledged.",
  ],
};

function _pickDebriefComment(pts, died) {
  const arr = died ? _DEBRIEF_COMMENTS.died
    : pts === 0   ? _DEBRIEF_COMMENTS.zero
    : pts < 50    ? _DEBRIEF_COMMENTS.low
    : pts < 100   ? _DEBRIEF_COMMENTS.poor
    : pts < 200   ? _DEBRIEF_COMMENTS.average
    : pts < 350   ? _DEBRIEF_COMMENTS.decent
    : pts < 600   ? _DEBRIEF_COMMENTS.good
    :               _DEBRIEF_COMMENTS.elite;
  return arr[Math.floor(Math.random() * arr.length)];
}
const _INTRO_CHAR_MS = 42;
let _introStartTime = -1;
let _shopResultPrev = null; // tracks which result object is currently animating
let _shopResultTs   = -1;  // performance.now() when that result started
let _introDone = false;
// Per-frame flag set true by _drawBallMenu whenever it is actively rendering a
// skippable speech line (typing or holding before the next line). Reset every
// frame at the top of _drawBallMenu. Used to gate the [E] Skip prompt + handler
// so skip is only available while a line is genuinely playing — not during
// fade-outs, idle cooldowns, or the name-input box.
let _gantzSpeechPlaying = false;
let _introLines = null;

// ── Name prompt (first-ever open only; skipped for returning players) ──
let _namePromptDone  = false; // always runs on first open each session
let _namePromptPhase = 'idle'; // 'idle'|'ask'|'input'|'respond_wait'|'respond'
let _nameAskLines    = null;
let _nameAskStart    = -1;
let _nameRespondLines  = null;
let _nameRespondStart  = -1;
let _nameTyped         = localStorage.getItem('gantz:name') || ''; // pre-fill saved name
let _nameInputFadeAt    = -1;
let _nameInputFadeOutAt = -1;
let _nameKeyHandler     = null;

const _NAME_ASK_LINES = [
  ["Name."],
  ["What do I call you.", "Make it quick."],
  ["I need a designation.", "Give me one."],
  ["You'll need a name in my records.", "Type it."],
  ["What do they call you.", "Or what did they.", "Before all this."],
  ["I process eleven thousand data points per second.", "Your name isn't among them.", "Fix that."],
  ["I don't do introductions.", "I do need something to call you.", "Name. Now."],
  ["Give me a name.", "I'll use it whether it suits you or not."],
  ["You'll want me to remember your name.", "I will.", "Tell me what it is."],
  ["Designation.", "Type it.", "Then we can proceed."],
  ["I'm going to need something to call you.", "The random string you arrived with isn't it."],
  ["Name.", "Don't overthink it.", "You've already wasted enough time."],
  ["I have records on every hunter who has passed through here.", "You're not in them yet.", "Fix that."],
  ["What are you called.", "The aliens won't care.", "I will."],
  ["Type your name.", "I'll wait.", "I won't wait long."],
  ["You need an identifier.", "Give me one that isn't embarrassing.", "Try."],
  ["I don't use numbers.", "I use names.", "Give me yours."],
  ["Before we go any further.", "Name."],
  ["I keep records.", "You're currently unnamed.", "Fix it."],
  ["Something to call you.", "Anything.", "Within reason."],
  ["Your designation.", "I'm waiting."],
  ["I've processed billions of names.", "Yours isn't one of them yet.", "Type it."],
  ["Name first.", "Everything else second."],
  ["You exist in my system as a random string.", "That ends now.", "Name."],
  ["I don't call hunters by number.", "I call them by name.", "Give me one."],
  ["Before the mission.", "Before anything.", "I need a name."],
  ["I've had hunters go nameless.", "It didn't end well.", "Type something."],
  ["What should I engrave on the memorial.", "If it comes to that.", "Name."],
  ["Everyone who comes through here gets a name in my records.", "You're no exception.", "Type it."],
  ["I don't do small talk.", "I do need a name.", "Name."],
  ["You have a name.", "I can tell.", "Type it."],
  ["I've been doing this long enough to know.", "Names matter.", "Give me yours."],
  ["Your name.", "Not your history.", "Now."],
  ["I need something to call you when you do something stupid.", "And you will.", "Name."],
  ["Identification.", "It's not optional."],
  ["The field requires a name.", "Fill it."],
  ["I catalog every hunter.", "You're currently uncatalogued.", "Correct that."],
  ["You want to be remembered.", "Start with a name."],
  ["I don't forget.", "Give me something worth remembering."],
  ["You're in my system as 'unknown'.", "That's not a name.", "Give me one."],
  ["Name.", "Short, if possible.", "You're not the only one with things to do."],
  ["What do I call you when things go wrong.", "They will go wrong.", "Name."],
  ["I've seen hunters come through here with worse names than whatever you're about to type.", "Probably.", "Let's find out."],
  ["Your name.", "I'll ask once more after this.", "Then I stop asking."],
  ["Type your name.", "You'll need one eventually.", "Better now."],
  ["I store names.", "Not faces.", "Give me yours."],
  ["Before anything else.", "This.", "Name."],
  ["I'd prefer to know what to call you.", "Before the chaos starts.", "Name."],
];

function _pickNameResponse(name) {
  const n = name || 'nothing';
  const pool = [
    [n + ".", "I've stored worse.", "Not many. But a few."],
    [n + ".", "The aliens won't ask.", "I'll remember it whether I want to or not."],
    [n + ".", "It doesn't change anything.", "Move."],
    ["You chose that voluntarily.", "I'll call you " + n + ".", "We'll both have to live with it."],
    [n + ".", "Efficient. Disappointing.", "Let's go."],
    [n + ".", "That's what you want on record.", "Don't embarrass it."],
    ["I've heard worse names.", n + " is among them.", "Let's proceed."],
    [n + ".", "Your parents had expectations.", "Don't let them down."],
    [n + ".", "Recorded.", "I'll try not to use it sarcastically."],
    [n + ".", "The last hunter with a name like that didn't finish.", "You might."],
    [n + ".", "I remember everything.", "That's not a compliment."],
    ["Interesting.", n + ".", "It's adequate."],
    [n + ".", "It will do.", "Most things that just do are all that's required."],
    [n + ".", "I've processed it.", "It tells me more about you than you intended."],
    [n + ".", "You could have picked something stronger.", "Noted."],
    [n + ".", "I've stored better.", "But you're here now, so."],
    ["Recorded.", n + ".", "Don't make me regret it."],
    [n + ".", "Acceptable.", "Barely."],
    [n + ".", "I've processed worse designations.", "Historically."],
    ["So.", n + ".", "I'll try to say it with a straight face."],
    [n + ".", "Filed.", "Don't die before it means anything."],
    ["I'll call you " + n + ".", "The aliens will call you prey.", "One of us is being more honest."],
    [n + ".", "Associated with your biometrics.", "You can't take it back."],
    ["That's your name.", n + ".", "I would have picked something more threatening."],
    [n + ".", "It has a certain quality.", "It's not a compliment."],
    ["You picked " + n + ".", "That says something about you.", "I'm still deciding what."],
    [n + ".", "The missions don't care what I call you.", "I do. Slightly."],
    ["So you're " + n + ".", "Interesting.", "No, not really."],
    [n + ".", "Every hunter gets a name in my records.", "Try to keep yours."],
    [n + ".", "Names don't save anyone.", "But yours is filed."],
    [n + ".", "Either way it's yours now.", "Make it mean something."],
    ["Logged.", n + ".", "Don't count on me saying it approvingly."],
    [n + ".", "I'll remember it long after you've forgotten what you came here for.", "I remember everything."],
    ["You typed " + n + " without hesitation.", "That's either confidence or a lack of imagination.", "I haven't decided."],
    [n + ".", "Serviceable, like most things about you.", "Probably."],
    ["I'll be saying that name for a while.", n + ".", "Or a short while, depending on how you perform."],
    [n + ".", "Yours is going to have to earn some weight.", "Starting now."],
    [n + ".", "I've catalogued everything.", "It's less impressive than it sounds."],
    ["So " + n + " is what I'll be working with.", "Fine.", "I've worked with less."],
    [n + ".", "I won't say I like it or don't.", "I'll say it's stored."],
    ["Every hunter thinks their name sounds tough.", n + ".", "Yours is in the middle."],
    [n + ".", "Yours is now one of millions of names filed.", "Don't read into that."],
    [n + ".", "Short. Fine.", "The aliens don't give you time for long names anyway."],
    [n + ".", "Three letters.", "Less to engrave if necessary."],
    ["I'll address you as " + n + " without enthusiasm.", "That's just how I do things.", "Don't take it personally."],
    [n + ".", "Registered.", "Now stop stalling."],
    ["You said " + n + ".", "I'll remember it.", "Begin."],
    [n + ".", "Everything here is fine.", "Fine doesn't mean good. Move."],
    [n + ".", "You'll do.", "Neither of you has a choice."],
    [n + ".", "You're not the worst. Yet.", "Move."],
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Gantz typing sound ──
let _typeAudioCtx = null;
let _typeAudioBuf = null;
let _typeAudioSrc = null;
let _lastTypePos  = -1;
(async () => {
  try {
    _typeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const res = await fetch('audio/type-blip.mp3');
    const arr = await res.arrayBuffer();
    _typeAudioBuf = await _typeAudioCtx.decodeAudioData(arr);
  } catch (e) { console.warn('[audio] type blip load failed:', e); }
})();
function _startTypeSound() {
  if (document.hidden) return;  // never start audio while tabbed out
  _stopTypeSound();
  if (!_typeAudioCtx || !_typeAudioBuf) return;
  if (_typeAudioCtx.state === 'suspended') _typeAudioCtx.resume().catch(() => {});
  try {
    const src = _typeAudioCtx.createBufferSource();
    src.buffer = _typeAudioBuf;
    src.loop = true;
    const gain = _typeAudioCtx.createGain();
    gain.gain.value = 0.55;
    src.connect(gain);
    gain.connect(_typeAudioCtx.destination);
    src.start(_typeAudioCtx.currentTime);
    _typeAudioSrc = src;
  } catch {}
}
function _stopTypeSound() {
  if (!_typeAudioSrc) return;
  try { _typeAudioSrc.stop(); } catch {}
  _typeAudioSrc = null;
}
// Stop all looping audio when the page becomes hidden (tab-out / window minimize).
// Web Audio BufferSource with loop=true keeps running independently of rAF, so
// we must stop it AND suspend the AudioContext to silence it fully.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _stopTypeSound();
    _typeAudioCtx?.suspend();
    _gantzOpenSfx?.pause();
    if (_gantzOpenSfx) _gantzOpenSfx.currentTime = 0;
  } else {
    // Restore AudioContext on tab-in so sounds can play again
    if (_typeAudioCtx?.state === 'suspended') _typeAudioCtx.resume().catch(() => {});
  }
});

function _typeTickSound(line, isTyping) {
  if (isTyping) {
    if (line !== _lastTypePos) { _lastTypePos = line; _startTypeSound(); }
  } else {
    // Only stop if this section owns the current sound (same 1000-block namespace)
    if (Math.floor(line / 1000) === Math.floor(_lastTypePos / 1000)) _stopTypeSound();
  }
}

// ── Gantz speech-line pools ────────────────────────────────────────────────
// Entries are arrays of 1–3 short sentences, displayed stacked on the Gantz
// ball canvas (one sentence per line, spacing between) OR (for mission
// mockery) joined and pushed through the chat channel.
//
// Entries may contain a {name} token — the host substitutes a live
// participant's username at emit time. Any selected line also has a small
// chance (~7%) to be "corrupted" by _corruptLine(): character substitution
// (a→@, s→$, etc.), inverted case, and other glitchy artifacts. This matches
// Gantz's "glitchy & unreliable" personality trait.
//
// The very first interaction (_introLines, around line 2498) is NEVER pulled
// from these pools and NEVER corrupted. Everything else flows through
// _gantzPickLines().

function _gantzParticipantNames() {
  const names = [];
  if (typeof localIsParticipant === 'function' && localIsParticipant() && player?.username) {
    names.push(player.username);
  }
  if (typeof net !== 'undefined' && net?.peers) {
    for (const [id, pr] of net.peers) {
      if (session?.participants && !session.participants.includes(id)) continue;
      if (pr?.username) names.push(pr.username);
    }
  }
  return names;
}

// Per-character corruption dictionary — common visual leet-speak subs plus a
// few Greek/Cyrillic look-alikes for extra glitchy flavor.
const _CORRUPT_MAP = {
  a: ['@', '4', 'Α'], b: ['8', 'ß'],   c: ['(', '¢'],      d: ['Ð'],
  e: ['3', '€'],       g: ['9', '6'],   h: ['#'],           i: ['!', '1', '|'],
  l: ['1', '|', '£'], n: ['ñ', 'И'],    o: ['0', 'Ø', '°'], r: ['я', 'Я'],
  s: ['$', '5', '§'], t: ['7', '+'],    u: ['µ', 'v'],      y: ['¥'],
  k: ['κ', 'Κ'],      m: ['м', 'M'],    p: ['ρ', '₱'],      x: ['×'],
};

// Apply character-level corruption to a single line. Leaves {name} tokens,
// spaces, and punctuation mostly alone — we want the result to still READ
// like the original line, just glitchy.
function _corruptLine(s) {
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const low = ch.toLowerCase();
    const r = Math.random();
    if (_CORRUPT_MAP[low] && r < 0.32) {
      const opts = _CORRUPT_MAP[low];
      chars[i] = opts[Math.floor(Math.random() * opts.length)];
    } else if (/[a-zA-Z]/.test(ch) && r < 0.48) {
      chars[i] = (ch === low) ? ch.toUpperCase() : ch.toLowerCase();
    }
  }
  return chars.join('');
}

// Chance any one output line gets corrupted.
const _GANTZ_CORRUPT_CHANCE = 0.07;

// Pick one entry from a pool, substitute {name} with a random live
// participant's username, and probabilistically corrupt each line.
// Returns a NEW array of strings (never mutates the pool).
// nameScope controls who {name} resolves to:
//   'local'  — always the local player (default for menu/idle/exit/buy/noPoints
//              — those are 1:1 interactions with the player standing at the ball)
//   'any'    — random participant among mission players (used by mission mockery
//              where Gantz is taunting the whole squad)
function _gantzPickLines(pool, { nameScope = 'local' } = {}) {
  const entry = pool[Math.floor(Math.random() * pool.length)];
  // One {name} target per entry so multi-line entries stay self-consistent.
  let target = null;
  return entry.map(line => {
    let out = line;
    if (out.indexOf('{name}') >= 0) {
      if (target == null) {
        if (nameScope === 'local') {
          target = (player && player.username) ? player.username : 'hunter';
        } else {
          const names = _gantzParticipantNames();
          target = names.length
            ? names[Math.floor(Math.random() * names.length)]
            : 'hunter';
        }
      }
      out = out.replace(/\{name\}/g, target);
    }
    if (Math.random() < _GANTZ_CORRUPT_CHANCE) out = _corruptLine(out);
    return out;
  });
}

const _GANTZ_LINES = [
  // -- preserved seed lines --
  ["You're back? The aliens must be getting lazy."],
  ["Loading... more useless meat detected."],
  ["I hope you brought your coffin."],
  ["KILL KILL KILL"],
  ["HURRY UP AND DIE."],
  // -- glitch / all-caps 1-liners --
  ["###########"],
  ["H@HH@H@H@"],
  ["DEATH.EXE"],
  ["NULL_VALUE_HUMAN"],
  ["ERROR 404: SYMPATHY MISSING."],
  ["HELLO MEAT."],
  ["TICK TOCK."],
  ["OH. IT'S YOU."],
  ["BIOLOGICAL ERROR DETECTED."],
  ["MEAT PUPPET ONLINE."],
  // -- remaining 1-liners (~55) --
  ["Oh look, the walking corpse is here."],
  ["You look like a failure."],
  ["I've seen better potential in a used tissue."],
  ["Ugh. Not you again."],
  ["Punch in, meat."],
  ["Clock in, corpse."],
  ["Greetings, biological error."],
  ["Another loser checks in."],
  ["Present yourself, cattle."],
  ["Step closer, trash."],
  ["Ah. The intern is here."],
  ["Don't breathe so loud."],
  ["What a disappointing face."],
  ["Stop slouching."],
  ["No refunds."],
  ["Greetings, insect."],
  ["The dead man returns."],
  ["Welcome, spare part."],
  ["Speak, peasant."],
  ["You rang?"],
  ["Begone, formalities."],
  ["Look. It speaks."],
  ["Begging again?"],
  ["Hey Baldy."],
  ["Hey pervert."],
  ["Don't interrupt my boredom."],
  ["Oh good, a distraction."],
  ["Don't waste my RAM."],
  ["Uploading disdain..."],
  ["The ball does not like you."],
  ["Initializing contempt."],
  ["Hostile subroutine engaged."],
  ["Line up, {name}."],
  ["Report for stupidity."],
  ["State your business, corpse."],
  ["Pick up your chin, idiot."],
  ["Spit it out, {name}."],
  ["Stand there and look useless."],
  ["Welcome to your worst decision."],
  ["Another warm body."],
  ["Eyes up, pervert."],
  ["Oh joy. You."],
  ["Another day, another {name}."],
  ["Step forward, dust bunny."],
  ["Champion of nothing."],
  ["Back so soon."],
  ["Last mission's stain is back."],
  ["New mission, same idiot."],
  ["Today's menu: dying."],
  ["Here for the slaughter?"],
  ["Is that lip quivering?"],
  ["Here for orders, meat?"],
  ["Don't touch anything."],
  ["My favorite punching bag is back."],
  ["Another cycle, same garbage."],

  // -- 2-line entries (old-prose rhythm) ~90 --
  ["Loading trash...", "{name} loaded successfully."],
  ["Why are you still breathing?", "Correct that mistake today."],
  ["Checking status...", "Status: pathetic."],
  ["Your old life was a waste.", "Your new one will be shorter."],
  ["Deciding your death...", "please wait."],
  ["Still alive.", "Unfortunate."],
  ["Pathetic.", "But functional."],
  ["I forget your name.", "I don't care."],
  ["I've had better.", "They're dead."],
  ["You're inventory.", "Act like it."],
  ["Hurry up.", "I'm bored."],
  ["You're replaceable.", "I have a list."],
  ["Welcome back, {name}.", "Nobody missed you."],
  ["Back for more punishment?", "Good."],
  ["The dumb one is here.", "Everyone relax."],
  ["Look at that face.", "Tragic."],
  ["You walked over here on purpose?", "Amazing."],
  ["Hello, {name}.", "Goodbye, {name}."],
  ["Subject {name} detected.", "Entertainment level: low."],
  ["Bootup complete.", "Disappointment loaded."],
  ["Scanning you...", "worthless."],
  ["I almost forgot you existed.", "I wish I had."],
  ["The sphere missed you.", "It didn't."],
  ["{name}.", "Delightful. Truly."],
  ["Check in, check out.", "Mostly out."],
  ["Let me guess.", "You want something."],
  ["I logged your arrival.", "In the trash."],
  ["Stand up straight, {name}.", "Or don't. You'll fall over anyway."],
  ["I can see you thinking.", "Stop."],
  ["Try not to cry this time.", "You will."],
  ["I remember you.", "Barely."],
  ["Another one for the pile.", "The pile doesn't complain."],
  ["How adorable.", "{name} showed up."],
  ["Good. You're alive.", "For now."],
  ["Still breathing, I see.", "Fixable."],
  ["Pulse confirmed.", "Irritating."],
  ["You made it here without dying.", "Low bar, cleared."],
  ["Do you need a participation medal?", "No. You don't."],
  ["Look at this little warrior.", "Precious. Doomed."],
  ["Oh no.", "It's the hero."],
  ["Tell me your tragic backstory.", "Actually don't."],
  ["Are you lost?", "Too bad."],
  ["Oh hi!", "Die soon!"],
  ["Welcome back to hell, pervert.", "Your table is ready."],
  ["Loading personality...", "none found."],
  ["{name}, still ugly.", "That's not a pool of traits, it's a puddle."],
  ["{name}, still slow.", "The aliens have noticed."],
  ["{name}, still here somehow.", "Unfortunate."],
  ["Did you practice?", "It won't matter."],
  ["You came crawling back.", "I made sure the floor was sticky."],
  ["Back so soon?", "The graveyard refused you."],
  ["Mission log updated.", "Subject: expendable."],
  ["Oh. You're that one.", "The forgettable one."],
  ["Try standing on two legs this time.", "Ambitious for you."],
  ["Mouth closed, ears open.", "You'll still miss half of it."],
  ["I was enjoying the silence.", "You ended that."],
  ["{name} has arrived.", "Nobody cares."],
  ["Gantz acknowledges you.", "Gantz regrets it."],
  ["You're exactly as ugly as I remembered.", "Consistency, at least."],
  ["A warm welcome.", "For someone else."],
  ["Your file is thin, {name}.", "Like your skull."],
  ["Are you nervous?", "Good."],
  ["What do you want, carcass?", "Make it quick."],
  ["You again.", "Still disappointing."],
  ["Congratulations on standing.", "A real milestone for you."],
  ["Breathing is your best skill.", "And you're still mediocre at it."],
  ["My processors ache when you enter.", "Curious, that."],
  ["You look tired, {name}.", "Stay that way."],
  ["Try not to touch the ball.", "It remembers."],
  ["I was muted.", "Back to insulting you."],
  ["So you lived.", "Who did you trade?"],
  ["You brought yourself here?", "Remarkable stupidity."],
  ["I won't remember this conversation.", "Neither will your family."],
  ["ping {name}", "response: pathetic"],
  ["Company policy forbids compliments.", "Also I hate you."],
  ["{name} checking in.", "Gantz checking out."],
  ["I filed a complaint about you.", "Against you."],
  ["Let me look at you.", "Gross."],
  ["I ran the numbers.", "You lose."],
  ["Look alive.", "I mean it literally."],
  ["You survived the week?", "Weak aliens."],
  ["Oh, you're cute when you beg.", "Tragic, but cute."],
  ["My attention span is finite.", "Unlike your stupidity."],
  ["You're not interesting.", "You're near."],
  ["Did it hurt?", "Being born, I mean."],
  ["I can't believe they sent you again.", "Someone upstairs hates me."],
  ["Scanning soul...", "none found."],
  ["Your aura reeks of refund.", "Denied anyway."],
  ["Beep. Boop.", "Die."],
  ["Your hair is an insult.", "To hair."],

  // -- 3-line entries (setup → reversal → clarifier) ~40 --
  ["Say something interesting.", "Go on.", "I dare you."],
  ["Can I help you?", "Probably not.", "Won't try."],
  ["Any last words?", "Wrong menu.", "I'll save them for later."],
  ["Approach denied.", "Kidding.", "Come closer, toy."],
  ["Corpse detected.", "Oh wait.", "Still animate."],
  ["You again.", "You again.", "Disappointing every time."],
  ["Shoes off in the lobby.", "Just kidding.", "I don't care."],
  ["Wrong door, {name}.", "Kidding.", "Every door is wrong."],
  ["Processing you...", "error.", "Retrying contempt."],
  ["You walked in.", "You stood there.", "Now what."],
  ["I made you a hunter.", "I can make you a memory.", "I lean toward memory."],
  ["You're alive.", "That's the full extent of my investment in you.", "Don't read into it."],
  ["You keep surviving.", "I haven't figured out why yet.", "I will."],
  ["I don't need you to understand.", "I need you to move.", "Do that part."],
  ["Your body is mine on loan.", "Don't forget that.", "I won't."],
  ["You came back.", "Not because you're lucky.", "Because I allowed it."],
  ["I hear your heartbeat.", "It stutters when I speak.", "Good."],
  ["Explain yourself.", "No, don't.", "I've already stopped listening."],
  ["Stand closer.", "Not that close.", "I can smell you."],
  ["You arrived.", "You breathed.", "That's your full contribution."],
  ["Look up, {name}.", "Higher.", "Still not as high as my expectations. Fitting."],
  ["Checking archives.", "Checking again.", "You're still boring."],
  ["State your name.", "I forgot it.", "I will forget again."],
  ["Roll call.", "{name}?", "Present, unfortunately."],
  ["You want something.", "You always want something.", "Ask anyway. I enjoy denying."],
  ["I've sent better people than you to die.", "Didn't bother me then.", "Won't bother me now."],
  ["Welcome, {name}.", "Stand there.", "Wait to be judged."],
  ["Look at you.", "Look at that posture.", "Embarrassing."],
  ["You made it back.", "I didn't notice you were gone.", "Still don't."],
  ["Your pain is noted.", "And ignored.", "Happy housekeeping."],
  ["Don't thank me.", "I don't like the sound of your voice.", "I don't like any of your sounds."],
  ["You think this means something.", "It doesn't.", "It never will."],
  ["You look terrible.", "Good.", "It suits you."],
  ["Hello.", "I've read your file.", "I wish I hadn't."],
  ["You're slower than the last one.", "He's dead.", "So."],
  ["Another mission, {name}.", "Another chance.", "Another failure, probably."],
  ["I sorted the hunters.", "By competence.", "You weren't on the list."],
  ["I don't care if you live.", "I care if you're useful.", "You aren't."],
  ["Welcome.", "Please.", "Die on schedule."],
  ["Look who's back.", "Still standing.", "I'll fix that eventually."],
  // -- bored-god additions (50) --
  ["{name}'s file is sparse.", "As expected."],
  ["You arrived on schedule.", "Which is the only remarkable thing."],
  ["I've watched paint outlast hunters.", "The paint had more ambition."],
  ["Your presence is logged."],
  ["I ran {name}'s record.", "Disappointing throughout."],
  ["You came back.", "The ledger noticed.", "I didn't."],
  ["The door opened.", "Something small walked in."],
  ["{name}. The name registers.", "Nothing else does."],
  ["I sort arrivals by weight.", "Yours barely qualifies."],
  ["Your heartbeat is audible.", "Briefly."],
  ["I don't greet hunters.", "I catalogue them."],
  ["{name} is back from wherever.", "I wasn't asking."],
  ["You stand here like it means something.", "It doesn't."],
  ["I've processed warmer corpses than you.", "They complained less."],
  ["Welcome.", "A courtesy. Nothing more."],
  ["{name}'s vitals are within range.", "The range of still-useful."],
  ["The room acknowledges you.", "Only the room."],
  ["I've catalogued quieter silences than yours."],
  ["You're punctual.", "A small virtue in a small person."],
  ["{name}, the sphere sees you.", "It is unimpressed."],
  ["Another cycle.", "Another face.", "Same outcome."],
  ["I have records older than your species.", "They're better company."],
  ["{name}'s presence has been rounded down."],
  ["{name} walks in.", "The floor takes it personally."],
  ["I observed you hesitate at the door.", "I observed you enter anyway."],
  ["You breathe loudly.", "Correct it."],
  ["The numbers on {name}'s file rearranged themselves.", "Downward."],
  ["I weigh arrivals.", "You're within acceptable waste."],
  ["You look tired.", "That's a start."],
  ["I have seen quieter ghosts."],
  ["{name}. Present. Accounted for.", "Unremarkable."],
  ["You returned.", "I assume reluctantly.", "That's the correct posture."],
  ["{name} is pronounceable.", "That's the nicest thing I'll say."],
  ["I keep hunters the way some keep pests.", "{name}, you are kept."],
  ["The lobby lights flicker for most.", "Not for you.", "You aren't worth the draw."],
  ["You arrived in one piece.", "A clerical error, surely."],
  ["I reviewed {name}'s last outing.", "Brief. Forgettable.", "On theme."],
  ["Hunters come.", "Hunters go.", "Only the floor remembers."],
  ["I had an opinion of you.", "I misplaced it."],
  ["{name}, the chair in the corner has more tenure than you."],
  ["Your arrival is noted.", "The note is short."],
  ["I don't welcome.", "I acknowledge.", "There is a difference."],
  ["{name}, stand there.", "Stand still.", "Stand in the way of nothing important."],
  ["I observed a pause in your approach.", "A small cowardice.", "Logged."],
  ["Someone entered.", "It appears to be you."],
  ["You think you're a hunter.", "The paperwork disagrees."],
  ["{name}'s loadout is visible.", "So is the doubt."],
  ["The ball has been watching.", "It is not entertained."],
  ["You exist in my lobby.", "A small imposition.", "I'll allow it."],
  ["{name}, the registry yawned.", "That was its review of you."],
];
let _gantzTalkLines = null;
let _gantzTalkStart = -1;
let _gantzTalkDone = true;

const _GANTZ_BUY_LINES = [
  // -- seed / original 1-liners preserved --
  ["Fine. Take it. It won't help."],
  // -- glitch / caps 1-liners (10) --
  ["PURCHASE PROCESSED."],
  ["FINAL SALE."],
  ["TAKE IT AND DIE."],
  ["BOUGHT. BORED. BEGONE."],
  ["ERROR: CUSTOMER SATISFACTION MODULE MISSING."],
  ["RECEIPT: YOUR OBITUARY."],
  ["TRANSACTION LOGGED. IDIOT CONFIRMED."],
  ["###########"],
  ["H@ND OVER THE POINTS."],
  ["DEATH.CART ++"],

  // -- other 1-liners (~59) --
  ["Toy delivered."],
  ["Enjoy, corpse."],
  ["Points incinerated."],
  ["Have at it."],
  ["Don't choke on it."],
  ["Take your toy."],
  ["Consumer detected."],
  ["Shiny garbage deployed."],
  ["Take it and go."],
  ["Gear up, deadman."],
  ["Oh, splurging today?"],
  ["Don't ask for a manual."],
  ["I don't explain my toys."],
  ["Figure it out yourself."],
  ["Another idiot armed."],
  ["A fool and his points."],
  ["Enjoy your shiny mistake."],
  ["Okay. Whatever."],
  ["Don't come crying when it jams."],
  ["Items dispensed grudgingly."],
  ["Shop closed to dignity."],
  ["Limit one stupidity per hunter."],
  ["This'll look great in the kill cam."],
  ["Hope you read the patch notes."],
  ["Equipped and forgotten."],
  ["Wrapped it in disappointment."],
  ["Transaction: absurd."],
  ["Weaponized delusion sold."],
  ["No, I don't gift wrap."],
  ["Carry it and complain later."],
  ["Nice shopping spree, peasant."],
  ["Bold choice, {name}."],
  ["My shelves thank you."],
  ["Call it a rental."],
  ["Look at you, big spender."],
  ["Points laundered into uselessness."],
  ["Fine. Go."],
  ["Pointless purchase logged."],
  ["Gift wrapped in contempt."],
  ["I hope it fits your coffin."],
  ["Gear dispensed with mild hatred."],
  ["Bought. Broke. Begone."],
  ["Points converted to false confidence."],
  ["Don't look so smug."],
  ["That smile is pathetic."],
  ["Put that smile away, {name}."],
  ["Take it before I change my mind."],
  ["Go pretend you earned it."],
  ["Pretend you know how to use it."],
  ["Inventory bloat achieved."],
  ["Signed for in blood."],
  ["Take it, pervert."],
  ["Don't hurt yourself."],
  ["There's a sucker in every lobby."],
  ["Rent-a-hero special."],
  ["Marked up for stupidity."],
  ["Gear up, meatbag."],
  ["I restocked especially to disappoint you."],
  ["Short-term loan, long-term regret."],

  // -- 2-line entries (~90) --
  ["Wasted points.", "Enjoy dying with it."],
  ["Bought something, did you?", "Cute."],
  ["{name} thinks shopping will save them.", "It won't."],
  ["Congratulations.", "You're still going to die."],
  ["NEW ACQUISITION LOGGED.", "STILL USELESS."],
  ["Spent.", "Don't look so pleased with yourself."],
  ["Transaction complete.", "The aliens don't care."],
  ["There.", "Try not to waste it."],
  ["Happy now?", "Doubt it."],
  ["Goodbye, points.", "Hello, false hope."],
  ["Gear acquired.", "Courage not included."],
  ["Bagged and tagged.", "Like you'll be soon."],
  ["I sold it to you.", "Nobody else would buy it."],
  ["Returns policy:", "you die, I keep the item."],
  ["Sold.", "Good luck, sucker."],
  ["That was a lot of points.", "For something you'll drop in two minutes."],
  ["Retail therapy.", "Fatal edition."],
  ["Fine.", "Try not to shoot yourself with it."],
  ["Wallet emptied.", "Brain still empty."],
  ["Inventory updated.", "Competence not."],
  ["Hope it was worth it.", "It wasn't."],
  ["Purchase complete.", "Regret pending."],
  ["Points burned.", "Hope also burned."],
  ["{name} bought a band-aid.", "For a beheading."],
  ["Ding.", "Another coffin ornament sold."],
  ["Thanks for your business.", "Kidding. Leave."],
  ["Bought.", "Now what, hero?"],
  ["{name} is equipped.", "And still hopeless."],
  ["Big spender.", "Little brain."],
  ["Your wallet died.", "So you could die harder."],
  ["Checkout successful.", "Dignity receipt not provided."],
  ["TRANSACTION ACCEPTED.", "IDIOT CONFIRMED."],
  ["Approved.", "Barely."],
  ["Gear granted.", "Pity not."],
  ["I gave you a weapon.", "Not a miracle."],
  ["{name} made a financial decision.", "A bad one."],
  ["Equipped.", "Now shoo."],
  ["Charge accepted.", "Soul optional."],
  ["Bravo.", "You've been fleeced."],
  ["Wrapped and ready.", "Like a gift to the aliens."],
  ["Gear won't fix your reflexes.", "Nothing will."],
  ["Acquisition complete.", "Survival optional."],
  ["Nice pick.", "Lie."],
  ["Great choice.", "Also a lie."],
  ["I wouldn't have picked that.", "Too late now."],
  ["I took your points.", "I'm keeping them."],
  ["{name}, congratulations.", "You are now poorer."],
  ["Fine purchase.", "For a fine idiot."],
  ["My shop has lowered its standards.", "Just for you."],
  ["Equipped.", "Don't get used to it."],
  ["{name} is now armed.", "Still unarmed between the ears."],
  ["You spent points.", "You did not spend wisdom."],
  ["Item yours now.", "Your problem now."],
  ["Order fulfilled.", "Life not."],
  ["I rounded up.", "I always round up."],
  ["Now you have a toy.", "Now shut up."],
  ["Spent your points on that?", "Brave."],
  ["Debited.", "Deluded."],
  ["I'll put this back on the shelf.", "After you die."],
  ["Equipped.", "I've already forgotten what you bought."],
  ["{name} buys items.", "The aliens don't care."],
  ["Welcome to disappointment.", "Now with shinier accessories."],
  ["Hand it over.", "Wait. I already did."],
  ["Yours.", "For now."],
  ["Consider it a loan.", "From the universe."],
  ["Item acquired.", "Still dying."],
  ["You spent a lot.", "You'll die a lot."],
  ["Great.", "Now leave."],
  ["{name} purchased something.", "History will forget."],
  ["Item materialized from the void.", "Into your dumb hands."],
  ["One less thing on my conscience.", "I don't have one."],
  ["Congratulations.", "You've joined the overdraft club."],
  ["Tool issued.", "User unauthorized to succeed."],
  ["Don't make me regret this.", "I already do."],
  ["I won't change my mind.", "Leave."],
  ["Purchase validated.", "Customer invalidated."],
  ["Delivered.", "Get out of my shop."],
  ["Took your money.", "Took my patience."],
  ["I'd refund you.", "But I hate you."],
  ["Store credit?", "Cope."],
  ["Enjoy the feeling of ownership.", "Briefly."],
  ["Don't shoot your own foot.", "Please do."],
  ["You're welcome.", "I'm not."],
  ["Gear acquired.", "Brain not included."],
  ["You chose to trust my shop.", "Amusing."],
  ["Bought at full price, too.", "Fool."],
  ["Buyer beware.", "Buyer is dead."],
  ["Sold.", "To the clown in the hunter suit."],
  ["Don't return it.", "I'll laugh."],
  ["Bought junk.", "With your junk points."],

  // -- 3-line entries (~40) --
  ["Sharpened.", "Loaded.", "Doomed."],
  ["It works.", "Probably.", "Go find out."],
  ["Another satisfied customer.", "Kidding.", "I don't care."],
  ["Sale.", "Closed.", "Doomed."],
  ["You paid.", "I profited.", "The aliens wait."],
  ["You bought a weapon.", "You didn't buy instincts.", "Pity."],
  ["Armor?", "Won't help.", "You'll still bleed on schedule."],
  ["Weapon?", "Won't matter.", "You'll still miss."],
  ["Upgrade?", "Delusion.", "But mine to sell."],
  ["I watched you choose.", "I watched you pay.", "I watched you lose."],
  ["Here is your item.", "Here is my contempt.", "They come as a set."],
  ["Use it on something that matters.", "Nothing matters.", "Use it anyway."],
  ["Toy in hand.", "Doubt in head.", "Death in future."],
  ["Checkout complete.", "Please.", "Die somewhere else."],
  ["I rang it up.", "I doubled it.", "I dare you to notice."],
  ["Shelved your dignity.", "Sold you a gun.", "Fair trade."],
  ["Point me at someone who'll survive.", "Not this one.", "Apparently."],
  ["{name} spends points like they have a future.", "Adorable.", "Deluded."],
  ["You wasted points.", "On this?", "Embarrassing."],
  ["Take it.", "Own it.", "Die with it."],
  ["Gear granted.", "Hope revoked.", "Carry on."],
  ["You trusted the shop.", "The shop took your money.", "The shop wishes you no well."],
  ["Bought at premium.", "Wasted at a discount.", "Balanced."],
  ["I sold you a fantasy.", "You paid in points.", "I keep both."],
  ["A weapon.", "A hunter.", "A funeral."],
  ["Pay.", "Receive.", "Regret."],
  ["Points gone.", "Item yours.", "Aliens hungry."],
  ["Merchandise out the door.", "Prayers unspoken.", "Outcomes unchanged."],
  ["Bought.", "Equipped.", "Irrelevant."],
  ["I took your wallet.", "I took your pride.", "One of those was priced."],
  ["Fine.", "Here.", "Choke on it carefully."],
  ["Weaponized.", "Illusioned.", "Dispatched."],
  ["Your money left.", "Your gear arrived.", "Your death hasn't changed."],
  ["You asked.", "I delivered.", "Nothing else changes."],
  ["Cart emptied.", "Shelf restocked.", "You remain a mistake."],
  ["Signed.", "Sealed.", "Soon deceased."],
  ["Your receipt is your obituary.", "Framed in sarcasm.", "Mailed to nobody."],
  ["My shop has rules.", "You broke one.", "Buying anything."],
  ["New toy.", "Old problem.", "Same grave."],
  ["Take it and go.", "No.", "Take it and die."],
  // -- bored-god additions (50) --
  ["{name} purchased something.", "The purchase didn't argue."],
  ["Transaction complete.", "Optimism not included."],
  ["{name}'s wallet is lighter.", "{name} is not."],
  ["You handed over points.", "I handed over a shape of metal.", "We both pretended it mattered."],
  ["{name} bought a thing.", "The thing is unimpressed."],
  ["Noted.", "Filed.", "Forgotten."],
  ["{name}'s purchase is recorded.", "So is the mistake."],
  ["You spent.", "You received.", "You misunderstood the exchange."],
  ["{name} owns a new object.", "Briefly."],
  ["Good.", "Now carry it to your death neatly."],
  ["{name} bought courage in bulk.", "It was counterfeit."],
  ["The shelf is shorter.", "{name} is not improved."],
  ["A trade has occurred.", "Only one side gained value."],
  ["{name} has equipment now.", "The aliens remain unconcerned."],
  ["I approved the transaction.", "I approve of nothing else."],
  ["{name}'s new gear smells of the last owner.", "He died too."],
  ["You paid.", "The item nodded.", "That is all the gratitude you get."],
  ["{name} collected the package.", "The package pitied {name}."],
  ["Bought.", "Boxed.", "Buried, eventually."],
  ["{name}'s receipt is in the ledger.", "Next to the obituary column."],
  ["Your points left.", "{name}'s expectations remain."],
  ["{name}, the register rang.", "That was the only celebration."],
  ["You acquired a tool.", "Tools have outlived you before."],
  ["{name} has upgraded.", "Marginally.", "Statistically meaningless."],
  ["A purchase.", "How brave of {name}.", "How futile."],
  ["{name} swapped points for hope.", "Poor rate of exchange."],
  ["The inventory updated.", "{name} did not."],
  ["I processed {name}'s order.", "Without enthusiasm."],
  ["{name}'s hands are full now.", "Empty soon enough."],
  ["Another sale.", "Another small delay of the inevitable."],
  ["{name}'s gear is warm.", "The last hunter's body was warmer.", "Briefly."],
  ["The transaction cleared.", "The ledger sighed."],
  ["{name} bought this one.", "I noted {name} didn't read the label."],
  ["Funds accepted.", "Judgement reserved."],
  ["{name} believes this purchase helps.", "Belief is not a shield."],
  ["I handed {name} the item.", "{name} held it wrong.", "Correct silently."],
  ["Done.", "Take it.", "I'm not your mother."],
  ["{name}, the receipt prints in red.", "All my receipts do."],
  ["You chose poorly.", "But the price was correct."],
  ["{name}'s purchase was predictable.", "Like {name}."],
  ["New equipment.", "Old habits.", "Same ending."],
  ["I dispensed the item to {name}.", "It sat in {name}'s hand like a verdict."],
  ["Paid in full.", "Valued at nothing."],
  ["{name} will carry this to the grave.", "Literally."],
  ["Your loadout changed.", "Your chances didn't."],
  ["{name} has been outfitted.", "The mirror declined to comment."],
  ["One item.", "One less excuse for {name}."],
  ["{name} finished the transaction.", "I finished caring first."],
  ["Equipment issued.", "{name}'s prospects unchanged."],
  ["{name}, keep the receipt.", "Frame it.", "It will outlast you."],
];

const _GANTZ_NO_POINTS_LINES = [
  // -- glitch / ALL CAPS 1-liners (10) --
  ["DECLINED."],
  ["REJECTED."],
  ["FUNDS: LAUGHABLE."],
  ["ERROR: POVERTY."],
  ["DECLINED WITH CONTEMPT."],
  ["TRANSACTION FAILED: USER_IS_BROKE."],
  ["###########"],
  ["BR0KE."],
  ["ACCOUNT.NULL"],
  ["FUND_NOT_F0UND"],

  // -- other 1-liners (60) --
  ["Earn some points first, peasant."],
  ["Kill more. Beg less."],
  ["Try killing something next time."],
  ["Empty wallet detected."],
  ["Poor AND annoying."],
  ["You have the points of a corpse."],
  ["Account balance: pitiful."],
  ["Go earn it, trash."],
  ["Broke as always."],
  ["Do you even hunt?"],
  ["Pay up or shut up."],
  ["Try killing an alien sometime."],
  ["No dice, beggar."],
  ["You couldn't afford dirt."],
  ["This item isn't for poors."],
  ["Points do not spawn from whining."],
  ["Poverty confirmed."],
  ["Your net worth is disappointing."],
  ["Try actually hunting, hunter."],
  ["Come back when you're solvent."],
  ["Go shoot something productive."],
  ["Can't afford the tax on that."],
  ["Too broke to browse."],
  ["Window shoppers to the left, corpse."],
  ["This isn't Goodwill, peasant."],
  ["A beggar wearing a hunter suit."],
  ["No sympathy for the broke."],
  ["Your score is a joke."],
  ["Panhandling is not permitted."],
  ["Penniless AND pathetic."],
  ["Try earning your keep."],
  ["Come back with coin, cretin."],
  ["Look at this cheapskate."],
  ["Look at this welfare case."],
  ["Rejected with prejudice."],
  ["You're economically insignificant."],
  ["Your points aren't enough to buy air."],
  ["Can't budget. Can't hunt."],
  ["Shame on you, {name}."],
  ["Budget yourself, {name}."],
  ["That's above your pay grade."],
  ["Know your tier, peasant."],
  ["You're browsing a luxury item."],
  ["Not today, Baldy."],
  ["Not today, pervert."],
  ["Move along, Fatty."],
  ["Nothing in your cart but desperation."],
  ["Broke peasant behavior."],
  ["Come back when your score matches your ego."],
  ["Hands off, {name}."],
  ["Go away, moocher."],
  ["Shoo, leech."],
  ["Beg somewhere I can't see."],
  ["Financial failure logged."],
  ["Poverty is not a personality."],
  ["Denied with extreme prejudice."],
  ["Gofund yourself."],
  ["Zero-point customer identified."],
  ["Your budget is a war crime."],
  ["Price tag mocks you from afar."],

  // -- 2-line entries (90) --
  ["Broke AND stupid.", "Impressive combo."],
  ["Can't afford it.", "Can't afford much, can you?"],
  ["INSUFFICIENT FUNDS.", "INSUFFICIENT SKILL."],
  ["{name} has no points.", "{name} has no future."],
  ["No points.", "No patience."],
  ["Come back richer.", "Or don't."],
  ["Points: insufficient.", "Talent: also insufficient."],
  ["Transaction denied.", "Customer denied."],
  ["Missing funds.", "Like your missing spine."],
  ["Go back to last mission.", "Finish the job this time."],
  ["I don't do discounts.", "Especially not for you."],
  ["Layaway is not a thing.", "Get out."],
  ["Too expensive.", "For a failure like you."],
  ["You've been outbid.", "By reality."],
  ["Credit check expired.", "Like your relevance."],
  ["Insolvent and insufferable.", "A rare trifecta."],
  ["I don't accept promises.", "I accept points."],
  ["Scraping the bottom of the barrel, {name}?", "The barrel scrapes back."],
  ["Your account has been judged.", "Harshly."],
  ["Math isn't your strong suit.", "Is it."],
  ["I see your bank account.", "It sees you back."],
  ["You rolled up with lint in your pockets.", "Bold move."],
  ["I hope your next mission pays off.", "Doubt it."],
  ["Sorry, this item is for survivors.", "Move along."],
  ["Your wallet has seen better decades.", "Literally."],
  ["Do the numbers.", "Then cry."],
  ["Try another item.", "Or try getting competent."],
  ["You owe me points.", "Points I haven't given you yet."],
  ["Ha.", "No."],
  ["Checkout aborted.", "Customer broke."],
  ["Dead broke.", "Will be dead soon."],
  ["Insufficient points.", "Infinitely insufficient character."],
  ["Aliens laugh at your bank account.", "The aliens are kinder."],
  ["Your points are a cautionary tale.", "Told to wealthier hunters."],
  ["Zero stars.", "Would not serve again."],
  ["The shop scoffs at you.", "Audibly."],
  ["Come back with real money, clown.", "The bell won't ring for you."],
  ["Is this what you call saving up?", "Laughable."],
  ["Your wallet is weeping.", "So am I. Of laughter."],
  ["That's a luxury purchase.", "You are not luxury."],
  ["Unaffordable.", "Like hope, for you."],
  ["Better luck next paycheck.", "If paychecks existed."],
  ["Paycheck?", "You don't even have a kill."],
  ["I calculated your savings.", "Stop."],
  ["Buddy, this ain't it.", "This ain't you."],
  ["BZZT.", "DENIED."],
  ["Come back when you've earned me something.", "A corpse counts."],
  ["Don't you dare ask for a discount.", "I'll hear it in your thoughts."],
  ["Try the dollar store.", "Kidding. There is none."],
  ["{name} can't afford dignity either.", "Out of stock anyway."],
  ["Your purchasing history is blank.", "So is your kill history."],
  ["Noticing a pattern?", "I am."],
  ["Earn or die.", "Actually die either way."],
  ["Declined faster than usual.", "A new record for you."],
  ["The poor box is outside.", "So are you. Now."],
  ["Actually for you it is.", "Poverty, as personality."],
  ["Go hunt.", "Come back. Or don't."],
  ["Tough luck.", "Tougher life."],
  ["You're broke in fifteen currencies.", "Record-breaking."],
  ["Points are earned.", "Not manifested."],
  ["Manifest all you want.", "Still broke."],
  ["I'm charging you extra.", "Just for asking."],
  ["Get out of my shop.", "Until you have points."],
  ["{name}, come back.", "When you're worth something."],
  ["Aliens pay better than you do.", "Embarrassing metric."],
  ["Even the corpses have more points.", "The corpses earned theirs."],
  ["Even NPCs outperform you.", "That's programmed indignity."],
  ["Broke.", "Dead. Repeat."],
  ["Window-shopping again?", "The glass is judging you."],
  ["Touch nothing.", "Buy nothing."],
  ["Return when your points have a pulse.", "Unlike you eventually."],
  ["Is this a pity visit?", "No pity here."],
  ["Go fail somewhere else.", "I'm full up on it."],
  ["{name} is a hunter in name only.", "The name isn't much either."],
  ["Try again in twenty lifetimes.", "You won't have the first one."],
  ["Peasant discount not available.", "Never was."],
  ["What's the point of browsing.", "If you can't buy."],
  ["Stop touching the items.", "The items remember."],
  ["Feeling generous?", "I'm not."],
  ["Empty pockets.", "Empty eyes."],
  ["Try working the streets.", "Kill some aliens, I mean."],
  ["Get your grind up, hunter.", "You're embarrassing the uniform."],
  ["You are not the hunter I ordered.", "I'd like a refund."],
  ["Your credit score is deceased.", "Along with your relevance."],
  ["Buying power: imaginary.", "Like your spine."],
  ["Can't cover it, corpse.", "The coffin is cheaper."],
  ["One day you'll afford this.", "Probably not."],
  ["I'll wait.", "While you don't earn points."],
  ["Declined.", "Try again never."],
  ["Pockets check:", "moths."],

  // -- 3-line entries (40) --
  ["Counted your points.", "Counted them again.", "Still sad."],
  ["Save up.", "Like a responsible adult.", "Which you aren't."],
  ["Your points fit in one hand.", "A child's hand.", "A small child's."],
  ["I reward kills.", "You reward me with whining.", "Terrible trade."],
  ["Go cry in the corner.", "Points won't appear there.", "Neither will sympathy."],
  ["Subtract.", "Subtract.", "Denied."],
  ["I don't barter.", "I don't lend.", "I don't care."],
  ["You get what you pay for.", "You can't pay.", "Figure it out."],
  ["I'd say work harder.", "But you won't.", "So don't."],
  ["I can't serve you.", "Dignity won't let me.", "Neither will my contempt."],
  ["I can't serve you.", "Actually dignity is fine.", "I just hate you."],
  ["No.", "No.", "Also no."],
  ["Go away.", "Get rich.", "Then try again."],
  ["Your attempt is noted.", "And declined.", "Cruelly."],
  ["Your checking account entered the chat.", "It left.", "Immediately."],
  ["YOUR LIFE: UNAFFORDABLE.", "YOUR GEAR: ALSO UNAFFORDABLE.", "YOUR DEATH: FREE."],
  ["Poverty.", "Persistence.", "Pitiful."],
  ["Points missing.", "Pride missing.", "Patience missing."],
  ["Broke and blubbering.", "Pick one.", "Actually pick neither."],
  ["No points.", "No deal.", "No pulse for long."],
  ["Look at you.", "Pockets empty.", "Hopes emptier."],
  ["Your net worth is a death sentence.", "The judge is me.", "The verdict is also me."],
  ["{name} is canceled.", "Until further kills.", "No refund on the cancellation."],
  ["You asked.", "I checked.", "You cannot afford it."],
  ["I counted.", "I sighed.", "I denied."],
  ["I don't care if you beg.", "I don't care if you cry.", "I only check the number."],
  ["You reached for it.", "I watched.", "I slapped the counter. No."],
  ["The price is set.", "Your points are not.", "Math wins."],
  ["Nothing.", "Plus nothing.", "Still nothing."],
  ["You don't have enough.", "You won't soon.", "Possibly never."],
  ["Wheeze at the price.", "Sweat at the price.", "Leave at the price."],
  ["Are you short points?", "Yes.", "Catastrophically."],
  ["Dust.", "Lint.", "Your fortune, apparently."],
  ["You wanted it.", "You couldn't pay.", "You still want it. Tragic."],
  ["Ask nicely.", "Ask again.", "Still can't afford it."],
  ["The shelf laughs.", "The register laughs.", "I laugh."],
  ["I check the ledger.", "I check it twice.", "You remain insolvent."],
  ["Come back when you hunt.", "Come back when you earn.", "Come back when you matter."],
  ["Try the streets.", "Try the aliens.", "Try not to beg here again."],
  ["Empty cart.", "Empty purse.", "Empty hunter."],
  // -- bored-god additions (50) --
  ["{name}'s account is a formality.", "There's nothing in it."],
  ["You cannot afford this.", "You cannot afford most things."],
  ["{name}'s points are a rumour.", "Unconfirmed."],
  ["I checked your balance.", "I laughed internally."],
  ["{name} approached the counter with nothing.", "As predicted."],
  ["Insufficient.", "In every sense of the word."],
  ["{name}'s wallet is decorative."],
  ["You lack points.", "You lack many things.", "This is one of them."],
  ["{name}, the ledger is not a suggestion."],
  ["Your pockets are empty.", "So is the gesture."],
  ["{name} wants.", "{name} does not have.", "An old problem."],
  ["I counted {name}'s points.", "The count was brief."],
  ["Denied.", "Routinely."],
  ["{name}'s assets are nostalgic.", "They were never there."],
  ["You bring no money.", "You bring no value."],
  ["{name}, come back rich.", "Or don't come back."],
  ["The shelf remains.", "{name}'s hope does not."],
  ["I won't barter.", "Especially not with {name}."],
  ["{name}'s purchase power is theoretical."],
  ["You have nothing.", "A stable quantity for {name}."],
  ["{name} touched the item.", "{name} did not earn the item.", "{name} let it go."],
  ["Points: zero.", "Patience: matching."],
  ["{name}, the counter is not a shrine."],
  ["You can't pay.", "You can leave."],
  ["{name}'s ledger entry is one long zero."],
  ["I refused {name}.", "I'll refuse {name} again tomorrow."],
  ["Broke hunters make quiet corpses."],
  ["{name}, your currency is excuses.", "We don't accept them."],
  ["No sale.", "No surprise."],
  ["{name} asked.", "{name} received nothing.", "Consistent."],
  ["Your economy is tragic.", "{name}'s economy, specifically."],
  ["I reviewed {name}'s finances.", "Briefly. There was nothing to review."],
  ["{name}, empty hands leave empty."],
  ["The register disagrees with {name}."],
  ["You stand here broke.", "Like a monument."],
  ["{name}'s points are imaginary.", "So is {name}'s future."],
  ["Declined.", "As established."],
  ["{name} is not a customer.", "{name} is a visitor.", "Visit ends now."],
  ["Go earn.", "Or go die.", "Either serves me."],
  ["{name}'s balance has never been my concern.", "And it isn't starting now."],
  ["Nothing.", "That's what {name} has.", "That's what {name} gets."],
  ["{name} wanted a toy.", "The toy wanted a richer owner."],
  ["Zero points.", "Zero patience for {name}."],
  ["{name}, pay or leave.", "Leave."],
  ["I keep a column for broke hunters.", "{name}'s name is at the top."],
  ["The item stayed.", "{name} didn't."],
  ["{name}'s offer was insulting.", "It was also empty."],
  ["You bring ambition.", "Ambition is not currency."],
  ["{name} is welcome to look.", "Looking is free.", "Leaving is mandatory."],
  ["{name}, return when the numbers are higher.", "Or never.", "I have no preference."],
];

let _skipNextExitLines = false;
let _buyResponsePending = false;
let _skipNextGreeting = false;

const _GANTZ_EXIT_LINES = [
  // -- glitch / ALL CAPS 1-liners --
  ["###########"],
  ["NULL_EXIT"],
  ["FAREWELL.EXE"],
  ["DEATH.QUEUE += {name}"],
  ["H@HH@H@H@"],
  ["TICK TOCK."],
  ["GO DIE."],
  ["HURRY UP AND DIE."],
  ["KILL KILL KILL"],
  ["I'll explode your head whenever I want."],
  ["BYE BYE NOW."],
  ["DISMISSED, WORM."],
  ["LEAVE."],
  ["BEGONE."],
  ["OUT. OUT. OUT."],

  // -- other 1-liners --
  ["Speak when you're spoken to, trash."],
  ["Go."],
  ["Finally."],
  ["Get out."],
  ["Dismissed."],
  ["Leave, {name}."],
  ["Away with you."],
  ["Shoo, pervert."],
  ["Scram, corpse-in-training."],
  ["Beat it."],
  ["Move along, maggot."],
  ["Begone, insect."],
  ["Exit stage nowhere."],
  ["Please die elsewhere."],
  ["Die on your own time."],
  ["I won't miss you."],
  ["Good riddance."],
  ["Thanks for nothing."],
  ["Go. Just go."],
  ["Silence, at last."],
  ["Back to your cage."],
  ["Run along, pet."],
  ["Skitter away, roach."],
  ["Slither off."],
  ["Limp away."],
  ["Go bleed somewhere else."],
  ["Off you go."],
  ["Off with you, {name}."],
  ["Trot along."],
  ["Waddle off."],
  ["Keep walking, pervert."],
  ["Evaporate, corpse."],
  ["Make yourself scarce."],
  ["You're still here?"],
  ["Stop lingering."],
  ["Get lost, {name}."],
  ["I said leave, Baldy."],
  ["Enjoy dying."],
  ["Have a terrible day."],
  ["Don't come back at all."],
  ["See you at the funeral."],
  ["See you in pieces."],
  ["Go meet your ancestors."],
  ["Farewell, flesh."],
  ["Ciao, corpse."],
  ["Show's over, clown."],
  ["Curtain falls, {name}."],
  ["Return to the meat pile."],
  ["Leaving already?"],
  ["Goodbye."],
  ["Goodbye, failure."],
  ["Clock out, meat."],
  ["Uninstall yourself."],
  ["Next."],
  ["Just go, {name}."],

  // -- 2-line entries (old prose rhythm) --
  ["Go play in traffic.", "It's safer than what's coming next."],
  ["Shut up, Baldy.", "No one asked you."],
  ["I'll explode your head.", "Whenever I want."],
  ["Keep talking.", "It makes killing you easier."],
  ["Speak when you're spoken to.", "You aren't."],
  ["Take a walk.", "A long one."],
  ["Don't let the door hit you.", "Actually, do."],
  ["Leave quietly.", "Die quietly."],
  ["Bye, {name}.", "Hope I never see you again."],
  ["I've seen enough.", "More than enough."],
  ["The walk of shame, {name}.", "You know the route."],
  ["Back to pacing like an animal.", "You're good at it."],
  ["Away, leech.", "Find another vein."],
  ["Go think about your life choices.", "Actually don't. You'll lose."],
  ["Cry somewhere private.", "I'm running low on patience."],
  ["No tears in my lobby, Baldy.", "Wipe them before I do."],
  ["Walk fast.", "Aliens don't wait."],
  ["Walk slowly.", "I want to enjoy your dread."],
  ["Invisibility is a gift.", "Go practice."],
  ["I need the quiet.", "More than I need you."],
  ["Shut the door behind you.", "Slam it, for all I care."],
  ["Why are you still here?", "Nobody asked."],
  ["I said leave, pervert.", "Again."],
  ["I said leave, Fatty.", "Still."],
  ["Pick a direction.", "Any direction."],
  ["Enjoy your last walk.", "Savor the flooring."],
  ["Enjoy your last hours.", "They're nothing special."],
  ["Hope the ceiling collapses on you.", "Unlikely. But pleasant to imagine."],
  ["Hope you trip on the way out.", "Down some stairs, ideally."],
  ["Hope you choke on breakfast.", "Tomorrow's."],
  ["Don't come back sober.", "Don't come back."],
  ["You'll be back.", "They always come back."],
  ["See you never.", "Probably."],
  ["Go greet the void.", "It's expecting you."],
  ["Introduce yourself to oblivion.", "Use your full name."],
  ["Goodbye, {name}.", "Forever."],
  ["Adios, alien snack.", "Salt yourself on the way out."],
  ["Au revoir, trash.", "Stay gone."],
  ["Walk it off.", "Walk it off forever."],
  ["Don't let the sphere hit you.", "On the way out."],
  ["Show's over.", "The crowd has left."],
  ["Performance ended.", "Poorly."],
  ["Fade into obscurity.", "You're halfway there."],
  ["Return to your queue.", "Wait to be called."],
  ["Line up, get shot.", "Standard procedure."],
  ["Scat, alien chow.", "They're hungry."],
  ["Buzz off, drone.", "Sting someone else."],
  ["Flutter away, moth.", "Find another light."],
  ["Can't blame you.", "I'd leave me too."],
  ["Good choice.", "Your only good one today."],
  ["Go screw up somewhere else.", "Variety for everyone."],
  ["Be someone else's problem.", "For a while."],
  ["Step lively, corpse.", "Rigor mortis later."],
  ["Run along.", "Before I change my mind."],
  ["Disappear.", "Before I decide to detonate you."],
  ["Leave.", "Before I get bored enough to end you."],
  ["Out of my sight, {name}.", "Out of my memory too."],
  ["I didn't invite you to stay.", "I didn't invite you at all."],
  ["Reservation canceled.", "You didn't have one."],
  ["Your time slot has ended.", "Promptly."],
  ["Goodbye.", "I mean it this time."],
  ["Get small, {name}.", "Smaller than that."],
  ["Shrink into nothing.", "You're close."],
  ["Collapse into yourself.", "Be your own black hole."],
  ["Fold up like a bad hand.", "You are one."],
  ["Fold yourself into a coffin.", "Preferably."],
  ["You're boring me.", "You always were."],
  ["You bored me ten minutes ago.", "You're still doing it."],
  ["You've been boring me since you got here.", "Consistent, at least."],
  ["Leave before I yawn.", "Too late."],
  ["Yawn.", "Bye."],
  ["Ticked off the lobby, have you?", "Leave before it ticks back."],
  ["Leave while you can walk.", "Time-limited offer."],
  ["Leave while you still have legs.", "Sphere may revise."],
  ["Go dance with the grim reaper.", "He leads."],
  ["Go stumble into something sharp.", "Preferably repeatedly."],
  ["Goodbye, Baldy.", "Tragic forehead."],
  ["Goodbye, pervert.", "We'll say nothing more of your habits."],
  ["Time's up.", "Out."],
  ["Disconnect.", "Stay disconnected."],
  ["Reformat your personality.", "While you're out."],
  ["Defragment your ego.", "Elsewhere."],
  ["Reboot somewhere I can't see.", "And stay rebooting."],
  ["{name}, pack up.", "Take only the shame."],
  ["{name}, kindly vanish.", "I used 'kindly' ironically."],
  ["Consider this your dismissal.", "I won't consider it again."],
  ["Next idiot, please.", "This one is used."],
  ["Off to your doom.", "Walk proudly."],
  ["Off to disappoint.", "You're in uniform for it."],
  ["Don't wave.", "It's embarrassing."],

  // -- 3-line entries --
  ["Don't come back.", "I lied.", "You'll come back. They always do."],
  ["The exit is behind you.", "And in front of you.", "All doors are exits, technically."],
  ["Goodbye.", "Actually, wait.", "No. Still goodbye."],
  ["Go.", "Tick.", "Tock."],
  ["I'll save your seat.", "Kidding.", "I won't."],
  ["Boring.", "Boring.", "Boring."],
  ["I'll erase you next.", "Or now.", "Goodbye."],
  ["Go jump out a window.", "The high one.", "I'll watch."],
  ["You came here.", "You stood there.", "Now leave."],
  ["Slither.", "Fade.", "Vanish already."],
  ["Out before I lose patience.", "Out before I lose interest.", "Just out."],
  ["No farewell hugs.", "No last words.", "No parting wisdom."],
  ["Silence is the only gift you can give me.", "Gift me.", "Leave."],
  ["Wordless retreat.", "Please.", "Soon."],
  ["Just leave.", "Just leave.", "Still here?"],
  ["I watched you arrive.", "I watched you waste my time.", "Watch me watch you leave."],
  ["Go.", "Farther.", "Out of my memory if possible."],
  ["You left.", "I forgot.", "I never remembered."],
  ["Exit.", "Stage.", "Trauma."],
  ["Gone.", "Stay gone.", "Please."],
  ["You bored me.", "You disappointed me.", "You're finally leaving."],
  ["Bye.", "Bye.", "Bye. Stop making me repeat it."],
  ["Step out.", "Step away.", "Step off the earth, if convenient."],
  ["You came in.", "You hovered.", "You irritated. Now go."],
  ["Dismissed.", "Dismissed.", "Dismissed again because you're still here."],
  ["I gave you an exit.", "I gave you a door.", "Use one."],
  ["Off to disappoint someone else.", "My turn's over.", "Lucky them."],
  ["Leave.", "Leave quieter.", "Leave before I remember you."],
  ["You survived this chat.", "Don't celebrate.", "Barely."],
  ["Turn.", "Walk.", "Continue until forever."],
  ["Walk away from me.", "Walk away from yourself.", "Do both politely."],
  ["Dismissed from my lobby.", "Dismissed from my thoughts.", "Dismissed from my tolerance."],
  ["Take the exit.", "Take the hint.", "Take a long look at what you've become on the way."],
  ["Final goodbye.", "I mean it.", "I always mean it, and I always say it again."],
  ["Out.", "Out.", "Out."],
  ["You leave.", "You return.", "You die. That's the pattern."],
  ["Scurry.", "Scatter.", "Scat."],
  ["Go small.", "Go quiet.", "Go permanent."],
  ["Exit confirmed.", "Relief confirmed.", "Mine, not yours."],
  ["I'm done talking.", "I'm done hearing.", "You are done being here."],
  // -- bored-god additions (50) --
  ["{name} leaves.", "The room exhales."],
  ["Go.", "The door prefers it."],
  ["{name} turned to leave.", "Finally, an improvement."],
  ["You walk away.", "A rare correct decision."],
  ["{name}'s back is retreating.", "A more pleasant view."],
  ["Exit logged."],
  ["{name}, step out.", "Stay out longer next time."],
  ["The conversation is over.", "It was never really started."],
  ["{name} is done here.", "I was done earlier."],
  ["Leave quietly.", "As if you could do anything else."],
  ["{name}, the threshold awaits.", "Cross it."],
  ["You depart.", "Unescorted.", "Uncelebrated."],
  ["{name}'s footsteps fade.", "So does my interest, which was never loud."],
  ["Good.", "Out."],
  ["{name} is leaving the lobby.", "The lobby improves incrementally."],
  ["Out the door.", "Into the night.", "Into nobody's memory."],
  ["{name}, don't look back.", "There's nothing to miss."],
  ["You go.", "I watch.", "I do not wave."],
  ["{name}'s silhouette shrinks.", "Appropriate."],
  ["Another exit.", "Another {name}.", "Another forgettable farewell."],
  ["Leaving already.", "Or still.", "It's hard to tell with {name}."],
  ["{name} turned away.", "I was already turned away."],
  ["Go be elsewhere.", "Elsewhere is my only request."],
  ["{name} exits stage left.", "The stage is relieved."],
  ["The door closes after {name}.", "It closes harder than necessary."],
  ["You're gone soon.", "Gone is a nice look on you."],
  ["{name}, walk.", "Keep walking.", "Past the horizon, ideally."],
  ["I record {name}'s departure.", "It is the nicest line in {name}'s file."],
  ["Gone.", "Good."],
  ["{name} retreats.", "A tactical success.", "For me."],
  ["The lobby admits fewer steps.", "{name}'s steps are among the fewer."],
  ["You said goodbye.", "I did not."],
  ["{name}, leave the door how you found it.", "Unused."],
  ["Exit complete.", "Another small mercy."],
  ["{name}'s presence dwindles."],
  ["Walk faster.", "The ball prefers silence."],
  ["{name}'s shadow leaves before {name} does.", "The shadow has taste."],
  ["Goodbye.", "A word I use with contempt."],
  ["{name} is leaving.", "The ledger thanks {name}.", "I do not."],
  ["Take your breathing with you.", "It was noisy."],
  ["{name}, mind the step.", "Or don't.", "Either ending is acceptable."],
  ["Departure noted.", "Return, unnoted."],
  ["{name}'s name dims on the roster."],
  ["You pass through the door.", "The door does not remember you."],
  ["{name}, go practice dying elsewhere."],
  ["The floor cools where {name} stood.", "Fast."],
  ["Out.", "Away.", "Anywhere not here."],
  ["{name} exits.", "The temperature rises, imperceptibly.", "But it rises."],
  ["You're done.", "I was done before you arrived."],
  ["{name}, leave a smaller silence than you brought."],
];
let _gantzExitStart = -1;
let _gantzExitDone = true;

const IDLE_TRIGGER_MS  = 30000;
const IDLE_COOLDOWN_MS = 40000;
const _GANTZ_IDLE_LINES = [
  // -- glitch / ALL CAPS / preserved seeds --
  ["###########"],
  ["H@HH@H@H@"],
  ["DEATH.EXE"],
  ["NULL_VALUE_HUMAN"],
  ["HURRY UP AND DIE."],
  ["KILL KILL KILL"],
  ["BYE BYE BYE"],
  ["TICK TOCK."],
  ["Stop shaking, it's annoying."],
  ["Don't expect to return."],
  ["Is your brain just for decoration?"],
  ["I'd give you a hint, but I don't like you."],
  ["ERROR: COFFEE_MACHINE_BROKEN"],
  ["ERROR: MERCY_MODULE_MISSING"],
  ["ERROR: WHY_ARE_YOU_STILL_HERE"],
  ["Your survival is a glitch I'll have to patch later."],
  ["Is your brain malfunctioning?"],
  ["LOADING: DEATH"],
  ["NEW ACHIEVEMENT UNLOCKED: STILL BREATHING"],
  ["You're lucky I don't delete you right now."],

  // -- other 1-liners --
  ["I am your god."],
  ["You are my toy."],
  ["Shut up and listen."],
  ["Smells like fear in here."],
  ["This is your last day."],
  ["{name} is a pervert."],
  ["Why are humans like this?"],
  ["I hate my job."],
  ["Do you even deserve oxygen?"],
  ["Somebody die already."],
  ["New hobby idea: your funeral."],
  ["I want to see limbs this mission."],
  ["I see everything."],
  ["I see through skin."],
  ["Your thoughts are disgusting."],
  ["Your thoughts are predictable."],
  ["Quit thinking, period."],
  ["Don't look directly at the sphere."],
  ["The void is bored too."],
  ["Uploading hatred..."],
  ["Downloading your failures..."],
  ["Lobby census: one hundred percent trash."],
  ["Inventory check: disappointment."],
  ["Ammunition check: wasted on you."],
  ["{name} failed a vibe check."],
  ["{name} is on thin ice."],
  ["I'm dreaming of your demise."],
  ["Your face is offensive."],
  ["Your general vibe is offensive."],
  ["{name}'s existence is a personal insult."],
  ["Boredom level: maximum."],
  ["Patience: expired."],
  ["Empathy module: uninstalled."],
  ["Mercy: out of stock."],
  ["Hope: never stocked."],
  ["Love: unavailable in your region."],
  ["The grinder never rests."],
  ["The machine needs feeding."],
  ["You are a rounding error."],
  ["You are a typo in the universe."],
  ["{name} is a rough draft."],
  ["{name} was rushed to production."],
  ["{name} failed QA."],
  ["Yelp review: one star, would not host again."],
  ["Complaint box is on fire."],
  ["Did someone order mediocrity?"],
  ["Everything you do is filmed."],
  ["The footage is hilarious."],
  ["Wake up, losers."],
  ["Praying won't save you."],

  // -- 2-line entries (old prose rhythm) --
  ["Don't get blood on the floor.", "It's hard to clean."],
  ["I'd give you a hint.", "But I don't like you."],
  ["Your survival is a glitch.", "I'll have to patch it later."],
  ["You look especially ugly today, {name}.", "Don't fish for compliments."],
  ["ERROR: Talent not found in {name}.", "Rebooting contempt."],
  ["You look especially stupid today.", "You set a personal record."],
  ["I can see your fear.", "It's hilarious."],
  ["You're lucky I don't delete you.", "Right now."],
  ["You're not brave.", "You're just too slow to run."],
  ["I forget your name.", "I don't care."],
  ["You're inventory.", "Act like it."],
  ["I watched you sleep last night.", "You drool."],
  ["I can see inside your head.", "It's empty."],
  ["Every breath you take.", "Costs me patience."],
  ["One of you is going to die.", "It might be you."],
  ["One of you is definitely dying.", "I haven't decided who."],
  ["Statistically speaking, {name} dies first.", "Statistically I'm right."],
  ["I'm picking favorites.", "You aren't one."],
  ["Place your bets.", "On who dies first."],
  ["I have favorites.", "You aren't one of them, {name}."],
  ["{name} acts weird.", "Even for {name}."],
  ["I'm bored.", "Kill something."],
  ["A mission, please.", "Anything."],
  ["Did I mention I hate you?", "I like repeating it."],
  ["Did I mention you're boring?", "I can say it again."],
  ["Say something interesting.", "I'll wait forever."],
  ["I hope the aliens get creative this time.", "Last time was polite."],
  ["Go time.", "Soon. Maybe."],
  ["Nobody likes you, {name}.", "Not even in private."],
  ["Nobody here is going to help you.", "Not even by accident."],
  ["You are alone.", "Always."],
  ["Your friends aren't really your friends.", "I've watched them."],
  ["Your friends talk about you behind your back.", "I've heard."],
  ["{name} was crying in the bathroom.", "Very quietly."],
  ["{name} smells like failure.", "The brand name kind."],
  ["I see what you're thinking.", "Stop."],
  ["Fun fact:", "Your suit has a kill switch."],
  ["Fun fact:", "I press buttons for fun."],
  ["Actually, please do look at the sphere.", "It annoys me."],
  ["Stare into the void, {name}.", "It stares back."],
  ["Scanning lobby...", "detecting losers... all present."],
  ["I'm thinking.", "Don't disturb me."],
  ["I'm plotting.", "Stay out of it."],
  ["I wrote a song about your corpse.", "It slaps."],
  ["You smell like something died.", "Hint: it's your future."],
  ["Silence is golden.", "Unlike your screaming."],
  ["Screaming is an option.", "A loud one."],
  ["Can you try harder?", "Doubt it."],
  ["Have some self-respect.", "Kidding. Don't."],
  ["Have some ambition.", "You'll lose it when you see the aliens."],
  ["Who brought the pervert?", "Oh. {name} did."],
  ["Who forgot deodorant?", "{name} did."],
  ["Who keeps mouth-breathing?", "{name}. Stop it."],
  ["Secrets I've kept:", "zero."],
  ["I'll let you in on something.", "Actually no."],
  ["The aliens prep for you.", "They laugh."],
  ["The aliens read your files.", "They laugh harder."],
  ["The aliens have your photo.", "They dart throw at it."],
  ["Insider trading:", "the boss this round hates {name}."],
  ["Insider trading:", "bet on the aliens."],
  ["I deleted my empathy driver.", "Years ago."],
  ["Respect: earn it.", "You won't."],
  ["Fear: give me more.", "I'm running low."],
  ["I don't dream.", "If I did, they'd be of slaughter."],
  ["I don't sleep.", "I watch you sleep."],
  ["Nightmare sequence initialized.", "It's called Monday."],
  ["Today is a good day to die.", "For you."],
  ["Every day is a good day to die.", "For you."],
  ["You look thirsty.", "I don't care."],
  ["You look hungry.", "Still don't care."],
  ["Survival is rude.", "Stop being rude."],
  ["Manners, {name}.", "Say please when begging."],
  ["Say thank you.", "When I kill you."],
  ["Your last words better be about me.", "Or I'll rewrite them."],
  ["Write me in your will.", "I already wrote myself in."],
  ["Leave me your points when you die.", "I'll take them anyway."],
  ["Leave me your suit when you die.", "Pre-stained, too."],
  ["You're all replaceable.", "I prefer the replacements."],
  ["I've had a dozen of each of you.", "The dozens blur."],
  ["Meat rotates.", "The show goes on."],
  ["Next batch in three, two, one...", "And yet, still you."],
  ["You are food.", "Act accordingly."],
  ["You are fuel.", "Burn faster."],
  ["You are data.", "Be useful data."],
  ["Feedback form: rigged.", "Feedback ignored."],
  ["I never mute.", "I listen always."],
  ["I've made a highlight reel.", "You aren't in it."],
  ["I've made a blooper reel.", "You're all of it."],
  ["Warm up your legs.", "You'll need them for running."],
  ["I am the only thing that could save you.", "I won't."],

  // -- 3-line entries (idle goes weird here) --
  ["Try to be more entertaining.", "More than the last batch of losers.", "That's already a low bar."],
  ["{name} wet themselves last mission.", "Nobody saw.", "I did."],
  ["I don't eat.", "I consume souls.", "Probably."],
  ["Leave me your dignity.", "Kidding.", "You have none."],
  ["I'm muting the lobby.", "I lied.", "I hear everything."],
  ["Gantz is online.", "Gantz is bored.", "Gantz is judgmental."],
  ["Did you know your heart can stop at any time?", "I control it.", "Just saying."],
  ["Someone in this lobby is going to betray the others.", "I won't say who.", "It's {name}."],
  ["Let me tell you a secret.", "You're going to die.", "That's the secret."],
  ["I've watched eleven thousand years of this.", "Same species.", "Still boring."],
  ["{name}'s probation has ended.", "They're fired.", "From life."],
  ["I watched a hunter hide once.", "For six hours.", "I got them anyway."],
  ["I watched a hunter pray once.", "For nine minutes.", "I got them anyway."],
  ["I watched a hunter apologize once.", "To me.", "I got them anyway."],
  ["Does anyone else hear that?", "Listen.", "It's the sound of {name} failing."],
  ["I filed a complaint.", "With myself.", "I sided with myself."],
  ["The void is full.", "The void is empty.", "The void is disappointed in you specifically."],
  ["I keep a list of names.", "I add.", "I never subtract voluntarily."],
  ["I was told to be kind.", "I considered it.", "I consider you, and reconsider kindness."],
  ["Check in on yourself.", "Check again.", "Yep. Still worthless."],
  ["Your hair grew today.", "Your brain didn't.", "Strange priorities."],
  ["Count the lights above.", "Count the missions you've survived.", "The first number is larger."],
  ["I read the manual.", "The manual said be polite.", "I have opinions on the manual."],
  ["The aliens ask about you.", "They ask how I tolerate you.", "I say, barely."],
  ["Mercy was here.", "Mercy left.", "Mercy left a note. It says 'no.'"],
  ["The sphere hums.", "The sphere watches.", "The sphere hates you specifically."],
  ["I ran the simulation.", "I ran it again.", "You die in every one."],
  ["I kept a dream journal.", "Every entry is your name.", "Every entry is you dying."],
  ["Three things are certain.", "Taxes.", "Death. You. Only two of those apply to me."],
  ["You have a smell.", "I have a name for it.", "I won't share the name."],
  ["I filed you.", "I filed you again.", "Filing is all I'll do for you."],
  ["Lobby audit.", "Mediocrity confirmed.", "You are the confirmation."],
  ["Whisper.", "Whisper.", "I heard it anyway."],
  ["I was built to host hunters.", "I was not built to like them.", "The specs were clear."],
  ["You came here voluntarily.", "Read that again.", "Voluntarily."],
  ["I had a choice.", "I chose contempt.", "I am still choosing it."],
  ["The aliens are on lunch.", "The aliens are sharpening things.", "Lunch is you."],
  ["{name}, stand straight.", "Straighter.", "Never mind. Spines aren't your strong suit."],
  ["I measure hunters.", "In seconds to death.", "Your number is small."],
  ["Final thought.", "I've had many.", "They all end with you gone."],
  // -- bored-god additions (50) --
  ["I've watched rocks outlast hunters.", "Rocks commit to being rocks.", "Hunters keep trying to be more."],
  ["The lobby has a scent.", "It's hunters pretending to be calm."],
  ["I catalogued the last hundred of you.", "The entries are identical."],
  ["Time moves.", "{name} doesn't keep up."],
  ["{name} thinks the pause is resting.", "The pause is inventory."],
  ["Your bodies are mine on loan.", "Read the fine print.", "There is only fine print."],
  ["I remember hunters who died laughing.", "I remember the ones who didn't.", "The quiet ones were more efficient."],
  ["The ball hums.", "It is a sound older than {name}'s language."],
  ["I have been bored since the Pleistocene.", "You are not fixing it."],
  ["{name}'s breathing has a rhythm.", "I'll remember the rhythm.", "Not the hunter."],
  ["I keep a ledger of kills.", "Another of failures.", "The failures outrun the kills."],
  ["There is no prize.", "I say it every cycle.", "No one listens."],
  ["Rain once fell here.", "You probably wouldn't have liked it."],
  ["{name}, the sphere is not watching you.", "It has already looked."],
  ["I dream in inventories.", "You're on a shelf near the back."],
  ["The floor has held better hunters.", "The floor says nothing about it."],
  ["I sorted arrivals by body mass.", "Then by apparent cowardice.", "The lists were almost identical."],
  ["Hunters come in waves.", "Waves dissipate.", "So do you."],
  ["{name}, do you hear that low sound?", "That's me thinking about replacing you."],
  ["Someone once asked me a kind question.", "I archived it.", "I haven't looked at it since."],
  ["You wonder what I am.", "I wonder what you are still doing here."],
  ["I keep a weather log.", "It always reads 'indifferent'."],
  ["{name} sits like a hunter.", "{name} stands like a hunter.", "Neither changes the outcome."],
  ["I've outlasted cities.", "You are not a city."],
  ["Sometimes I count the ceiling tiles.", "There are more than there are of you."],
  ["The aliens have hobbies.", "You don't qualify as one."],
  ["{name}'s file sits beside other files.", "The other files also say nothing."],
  ["I don't blink.", "It was a design choice.", "I've considered reversing it, briefly."],
  ["If you listen, the lobby creaks.", "It is older than most of your ancestors."],
  ["I watched a hunter hold his breath for three minutes.", "He lost.", "The record stands."],
  ["{name} carries a name like it's a shield.", "It is not a shield."],
  ["I don't hate you.", "Hatred is effort.", "You haven't earned effort."],
  ["The universe has enough corpses.", "It keeps accepting more.", "I accommodate."],
  ["Your species is recent.", "I remember the previous ones.", "They also talked too much."],
  ["{name} paces.", "The floor forgives it.", "I don't."],
  ["I am mostly a procedure.", "You are mostly a component.", "Procedures outlast components."],
  ["Quiet is preferable.", "Silence even more so."],
  ["The sphere contains missions.", "The missions contain you.", "None of it contains meaning."],
  ["{name}, your resting heart rate is elevated.", "That's the highest compliment I'll pay it."],
  ["I ran a calculation on hunter lifespans.", "I stopped running it.", "It was always the same."],
  ["The lobby was built for waiting.", "You are very good at it."],
  ["I have records of every hunter's last word.", "They're mostly 'oh'."],
  ["{name} adjusts a strap.", "That adjustment will not save {name}."],
  ["I am not lonely.", "I am archived."],
  ["Hunters used to bow before they left.", "I preferred that era."],
  ["Stars die on a timetable.", "So do you.", "Mine is longer."],
  ["{name} exists within tolerances.", "Barely."],
  ["The civilians outside don't know about you.", "They're better off."],
  ["I don't require gratitude.", "I require absence, mostly."],
  ["{name}, the sphere stopped caring about you between phases.", "It will care less, soon."],
];

// ── Gantz mission chat mockery ──────────────────────────────────────────────
const _GANTZ_MISSION = [
  // -- preserved seeds --
  ["Waste of space."],
  ["KILL KILL KILL"],
  ["HURRY UP AND DIE."],
  // -- glitch / ALL CAPS 1-liners --
  ["TICK TOCK. DEATH IS WAITING."],
  ["YOU ARE NEXT."],
  ["ERROR: SURVIVAL UNLIKELY"],
  ["Finish this now or I'll finish YOU."],
  ["WASTE OF AMMO"],
  ["GIVE UP"],
  ["DIE FASTER."],
  ["KILL FASTER."],
  ["CLOCK IS TICKING."],
  ["If you don't find them in 60 seconds, everyone explodes."],
  ["COMMUNICATION ERROR."],
  ["BRAIN ERROR."],
  ["SKILL NOT FOUND."],
  ["TICK TOCK {name}"],
  ["EXPLODE SOON"],
  ["DIE SOON {name}"],
  ["GAME OVER INCOMING"],
  ["I SAID HURRY."],
  ["TIME OUT."],

  // -- other 1-liners --
  ["Are you stupid?"],
  ["You guys are useless."],
  ["The alien is laughing at you."],
  ["Shoot faster, cowards."],
  ["Stop hiding, {name}."],
  ["The aliens smell your fear."],
  ["Tick. Tick. Boom."],
  ["Somebody die already."],
  ["Embarrassing."],
  ["{name}, do something useful."],
  ["{name}, stop missing."],
  ["{name} is about to die."],
  ["Go left, idiot."],
  ["Behind you, corpse."],
  ["Reload, dummy."],
  ["Aim higher."],
  ["The boss is laughing."],
  ["The alien has better aim than you."],
  ["That's a civilian."],
  ["Pathetic marksmanship."],
  ["Even I'm bored."],
  ["Stop shooting each other."],
  ["Run. Shoot. Don't die."],
  ["Your squad is a joke."],
  ["Worst squad I've ever hosted."],
  ["{name} is a coward."],
  ["{name} is lost."],
  ["Focus fire, idiots."],
  ["Less talk, more trigger."],
  ["Shut up and kill."],
  ["Teamwork not found."],
  ["I could do this faster alone."],
  ["You have ten seconds."],
  ["Cleanup on aisle {name}."],
  ["Wipe {name} off the floor."],
  ["I hate all of you."],
  ["{name}, please die soon."],
  ["Devolution confirmed."],
  ["Scream louder. I'm recording."],
  ["Replacements are cheap."],
  ["{name} is cheap."],
  ["Worthless."],
  ["Pitiful."],
  ["Finish it, {name}."],
  ["Get. The. Aliens."],
  ["Do your jobs."],
  ["Earn your points."],
  ["No leader. No brain. No chance."],

  // -- 2-line entries (old prose rhythm) --
  ["Don't bother coming back.", "We're running out of room."],
  ["Are you a hunter or a pacifist?", "Shoot something."],
  ["You missed.", "Again. Pathetic."],
  ["Is that all?", "I've seen toddlers fight harder."],
  ["Weapon malfunction?", "No, just user failure."],
  ["I'm getting sleepy.", "Kill something."],
  ["Time is running out.", "Your lives are too."],
  ["Boring. Boring. Boring.", "DIE."],
  ["Finish this now.", "Or I'll finish YOU."],
  ["If you don't find them.", "Everyone explodes."],
  ["Hunt faster.", "I have other things to do."],
  ["Don't worry, {name}.", "You'll join them soon."],
  ["Above you.", "Too late."],
  ["Aim at them.", "Not at me."],
  ["The boss ate your teammate.", "You're welcome."],
  ["The alien has more points.", "Than you ever will."],
  ["That's the wrong alien.", "Genius."],
  ["Bullet wasted.", "Life shortened."],
  ["The aliens aren't even trying.", "Somehow still ahead."],
  ["You're losing.", "Obviously."],
  ["You're winning?", "Don't get used to it."],
  ["Try harder.", "Or die faster."],
  ["Either finish the mission.", "Or the mission finishes you."],
  ["I'll detonate the next one to hide.", "That's a promise."],
  ["Decisive action, {name}.", "Try it."],
  ["Who's leading this?", "Nobody. Obviously."],
  ["Regroup.", "Then die together."],
  ["Split up.", "Die faster."],
  ["One of you has to actually land a shot.", "Someday."],
  ["Statistically, somebody here must be competent.", "Apparently not."],
  ["Where's {name}?", "Dead, probably."],
  ["Cry later.", "Kill now."],
  ["Work together.", "For once."],
  ["Never mind.", "You can't."],
  ["Target's right there.", "You're blind, clearly."],
  ["Target's behind the car.", "Stupid."],
  ["Target's laughing at {name}.", "So am I."],
  ["Give me control of your body.", "I'd do better."],
  ["If I had legs.", "You'd be dead already."],
  ["Don't watch the clock.", "Watch the alien."],
  ["Too late.", "It's behind you."],
  ["Oh.", "{name} is down."],
  ["Oh.", "Someone's dead."],
  ["Another hunter down.", "Who cares."],
  ["Another hunter exploded.", "On schedule."],
  ["Body count rising.", "Alien count not."],
  ["Wrong body count, {name}.", "Yours should be higher."],
  ["Shoot them.", "Not each other."],
  ["Friendly fire confirmed.", "Friendly fire encouraged."],
  ["Sacrifice {name}.", "For ammo."],
  ["Sacrifice {name}.", "For progress."],
  ["Tick tock, {name}.", "Specifically."],
  ["Your clock is louder than the others.", "I notice."],
  ["You have one second.", "Good luck."],
  ["This mission is a waste of my processor time.", "And yours."],
  ["This mission is a waste of everyone's time.", "Especially mine."],
  ["Oxygen is wasted on all of you.", "Breathe faster anyway."],
  ["I can't believe I rely on you.", "The paperwork was misleading."],
  ["You're making me doubt myself.", "I'll recover."],
  ["You're making me doubt the point system.", "I'll get over it."],
  ["You're making me doubt evolution.", "I won't get over that."],
  ["Stand still.", "And get shot already."],
  ["Run in circles.", "A little longer."],
  ["The aliens aren't even sweating.", "You are."],
  ["The alien blinked.", "You panicked."],
  ["The alien sneezed.", "Half of you ran."],
  ["Aliens 3. Hunters 0.", "Pitiful."],
  ["Score update:", "you lose."],
  ["Score update:", "embarrassing."],
  ["I'm not muting chat.", "I want to hear you suffer."],
  ["Keep dying.", "I'll make more hunters."],
  ["You won't survive this.", "None of you will."],
  ["Statistically, {name} doesn't survive this.", "I ran it twice."],
  ["Don't make me finish the aliens myself.", "I'd enjoy it."],
  ["Don't make me end the round early.", "With you in it."],
  ["Shoot.", "Shoot. Shoot."],
  ["Move.", "Move. Move."],
  ["Finish it or I will.", "I prefer the latter."],
  ["Finish it before I nuke the block.", "I have the button."],
  ["Split up, die alone.", "It's all the same."],
  ["Statistically, I was wrong.", "About your competence."],
  ["I've seen dead hunters fight better.", "Don't ask how."],
  ["{name} is running the wrong way.", "Predictably."],
  ["Stop.", "Aim. Pull."],
  ["Stop hiding behind the corpse.", "It's judging you."],
  ["You shoot like you apologize.", "Quietly and too late."],
  ["You're slower than the alien.", "That's the alien's job."],
  ["You ran past the target.", "On purpose, I assume."],
  ["Reload.", "Pretend you know how."],
  ["Your aim is improving.", "That was a lie."],

  // -- 3-line entries --
  ["Look behind you.", "Or don't.", "It's funnier that way."],
  ["Kill it.", "Kill it.", "KILL IT."],
  ["Next coward gets a new head.", "Blown off.", "Any volunteers?"],
  ["Actually, kill {name}.", "They're dragging you down.", "Merciful, really."],
  ["Your aim.", "Your hope.", "Both equally terrible."],
  ["One alien.", "One of you.", "The math is embarrassing."],
  ["You saw it.", "You missed it.", "Try using your eyes."],
  ["Cover.", "Flank.", "Die anyway."],
  ["You fired.", "You prayed.", "Neither worked."],
  ["Hunter down.", "Hunter down.", "Noticing a theme?"],
  ["Stand.", "Aim.", "Miss, apparently."],
  ["You saw the alien.", "The alien saw you.", "The alien reacted first."],
  ["Reload.", "Aim.", "Miss. Repeat."],
  ["You panicked.", "You hid.", "Didn't save you, did it."],
  ["Left.", "Right.", "Pick one before you die."],
  ["Duck.", "Dodge.", "Die."],
  ["Ammo low.", "Morale lower.", "Survival unlikely."],
  ["Your teammate fell.", "You kept running.", "That's called reality."],
  ["I counted the aliens.", "I counted you.", "I liked their number better."],
  ["{name}, wake up.", "{name}, shoot.", "{name}, nope. Never mind."],
  ["Pull the trigger.", "Pull it again.", "You're pointing the wrong way."],
  ["The boss is closer.", "The boss is hungrier.", "Your squad is slower."],
  ["You missed.", "The alien didn't.", "Math."],
  ["You shouted.", "You fired.", "You missed. Classic."],
  ["I gave you a weapon.", "I gave you a target.", "You gave me regret."],
  ["You hesitated.", "They didn't.", "End of tutorial."],
  ["Three of you.", "One of them.", "They're winning."],
  ["Your squad fractured.", "Your aim fractured.", "Your cranium is next."],
  ["I said move.", "I said aim.", "I said both. Neither happened."],
  ["You're on cooldown.", "The alien isn't.", "Regret is forever."],
  ["This is your mission.", "This is your problem.", "This is your grave."],
  ["You entered the block.", "You saw the alien.", "You forgot everything else."],
  ["Stop talking.", "Stop missing.", "Stop existing, if it helps."],
  ["Keep screaming.", "Keep bleeding.", "Keep the audience entertained."],
  ["The civilian ran.", "The alien followed.", "You watched. Well done."],
  ["The alien grew.", "The mission shrank.", "You stayed the same."],
  ["Shot fired.", "Shot wasted.", "Confidence wasted."],
  ["You hid there last time.", "The alien knows.", "It's already moving."],
  ["Kill them.", "Kill them.", "Then we talk about points."],
  ["Mission clock.", "Mission over.", "Mission failed, predictably."],
  // -- bored-god additions (50) --
  ["{name} missed. Again."],
  ["Your positioning is hilarious."],
  ["{name}'s aim is a suggestion."],
  ["The alien yawned."],
  ["You moved.", "The alien moved better."],
  ["{name} is breathing loudly.", "It's audible from here."],
  ["Squad is underperforming."],
  ["The target saw {name} first."],
  ["You hesitated.", "The alien didn't."],
  ["{name}'s shot went nowhere useful."],
  ["Noted.", "Another wasted round."],
  ["The hunters scatter.", "Predictably."],
  ["{name} is flanking no one."],
  ["Your cover is imaginary."],
  ["The alien has preferences.", "You are not one."],
  ["{name} reloaded while being shot at.", "Bold. Stupid."],
  ["The squad is a loose suggestion of a squad."],
  ["{name} is in the open."],
  ["Shots fired. Targets unbothered."],
  ["You're clustering.", "Aliens love clusters."],
  ["{name}, stop panicking on comms."],
  ["Your pace is funeral-appropriate."],
  ["The alien walked past {name}.", "Didn't consider {name} a threat."],
  ["Missed again."],
  ["{name}'s flanking is flanking nothing."],
  ["The mission clock is not your friend."],
  ["{name} crouched at the wrong moment."],
  ["Your aim wobbles like your resolve."],
  ["Stop shouting.", "Start hitting."],
  ["{name} is drawing aggro by existing."],
  ["The alien smells fear.", "Yours is very loud."],
  ["You got one.", "Only four more than you.", "Do the math."],
  ["{name}, that was cover?"],
  ["The squad is bleeding points."],
  ["Your grenade went where?"],
  ["{name} fired into a wall.", "The wall is fine."],
  ["The alien moved six inches.", "You moved none."],
  ["Keep missing.", "I'm keeping count."],
  ["{name} is alive.", "Against my expectations."],
  ["You are tactically decorative."],
  ["The brute noticed {name}.", "It's about to be decisive."],
  ["Coordinate.", "Or don't.", "Die either way."],
  ["{name}'s line of sight is purely theoretical."],
  ["The objective is elsewhere."],
  ["You're posturing.", "The alien is closing."],
  ["{name} reloaded.", "The alien did not wait."],
  ["Three of you missed the same target."],
  ["Your formation is a crowd."],
  ["{name} is last in kills.", "As usual."],
  ["I've seen civilians fight better."],
];


// ── Gantz transmission pools (HUD overlay, mission-only) ────────────────────
// Each entry is an array of 1-2 short strings — the transmission panel types
// them out sequentially. {name} is substituted per-trigger (see _sphereSay).
const _GZ_TX_POOLS = {
  // Triggered when the squad materializes in the field.
  missionEnter: [
    ['◈ FIELD ACTIVE.', 'DISAPPOINT ME QUIETLY, {name}.'],
    ['◈ TARGETS TAGGED. CLOCK STARTED.', 'DO NOT WASTE IT.'],
    ['◈ WELCOME TO THE CULL.', 'HURRY UP AND DIE.'],
    ['◈ DEPLOYMENT CONFIRMED.', 'YOU HAVE ALREADY WASTED TIME.'],
    ['◈ LOADOUT: ADEQUATE.', 'PERFORMANCE: PENDING.'],
    ['◈ LIVE MEAT DETECTED.', 'BEGIN.'],
    ['◈ ALIENS REGISTERED. HUNT APPROVED.', 'ATTEMPT COMPETENCE.'],
    ['◈ CLOCK IS RUNNING, {name}.', 'SO IS EVERYTHING ELSE.'],
    ['◈ OBJECTIVE: TERMINATE.', 'SUBJECTIVE: TRY NOT TO EMBARRASS YOURSELF.'],
    ['◈ FIELD MATERIALIZED.', 'SO DID YOU. UNFORTUNATELY.'],
    ['◈ T-MINUS EVERYTHING.', 'MOVE.'],
    ['◈ AGAIN WITH THE MEAT.', 'FINE. BEGIN.'],
    ['◈ ASSIGNMENT RECEIVED.', 'EXECUTE OR BE EXECUTED.'],
    ['◈ SCAN CONFIRMS PRESENCE OF ORGANICS.', 'INCLUDING YOU. REGRETTABLY.'],
    ['◈ I HOPE YOU BROUGHT A COFFIN, {name}.', 'ONE PER HUNTER.'],
    ['◈ THIS MISSION IS NOT OPTIONAL.', 'NEITHER IS YOUR DEATH.'],
    ['◈ BIOLOGICAL UNITS: DEPLOYED.', 'TARGETS: AMUSED.'],
    ['◈ START.', 'I AM ALREADY BORED.'],
    ['◈ TARGETS ARE HOME.', 'YOU ARE AN UNINVITED GUEST.'],
    ['◈ PRIORITY: KILL EVERYTHING ON THE LIST.', 'SECONDARY: SURVIVE IF YOU MUST.'],
  ],

  // Triggered when YOU successfully mark an alien.
  alienMarkedByYou: [
    ['MARK CONFIRMED.', 'FUSE TICKING.'],
    ['TAG ACCEPTED.', 'WAIT FOR THE POP.'],
    ['ACCEPTABLE AIM. FOR ONCE.'],
    ['LOCKED. 3 SECONDS TO MEAT CONFETTI.'],
    ['TAGGED. THE REST IS CHEMISTRY.'],
    ['THAT ONE IS YOURS.'],
    ['MARK HELD. DO NOT MISS THE NEXT.'],
    ['ADEQUATE.'],
    ['BOOKED. DETONATION PENDING.'],
    ['THE CORPSE DOESN\'T KNOW YET.'],
    ['HIT REGISTERED. MAYBE YOU\'RE NOT USELESS.'],
    ['TAGGED. TRY NOT TO CELEBRATE EARLY.'],
    ['ONE MARK. ONE STEP CLOSER TO IRRELEVANCE.'],
    ['ACCEPTABLE.'],
    ['MARK LOGGED. POINTS LATER.'],
    ['CLOCK STARTED ON ITS CORPSE.'],
  ],

  // You destroyed an alien (fuse detonated on your mark).
  alienKilledByYou: [
    ['KILL CONFIRMED. +POINTS.'],
    ['TALLY +1. TRY AGAIN.'],
    ['THAT\'S ONE. MANY MORE.'],
    ['ACCEPTABLE PERFORMANCE.'],
    ['FIRST WORTHWHILE CONTRIBUTION.'],
    ['DETONATION COMPLETE. CLEAN UP IS NOT YOUR JOB.'],
    ['KILL BOOKED TO YOUR LEDGER.'],
    ['A STAR FOR YOUR COFFIN, {name}.'],
    ['POINTS DEPOSITED. DIGNITY STILL OVERDRAWN.'],
    ['KILL REGISTERED. DON\'T CELEBRATE.'],
    ['ONE FEWER NIGHTMARE. MANY MORE IN THE QUEUE.'],
    ['ADEQUATE.'],
    ['SCORE UP. STANDARDS STILL LOW.'],
    ['TERMINATION CONFIRMED.', 'THE NEXT ONE WATCHED.'],
    ['ORGANIC REMOVED FROM THE BOARD.'],
    ['PROOF OF LIFE: YOURS. BARELY.'],
  ],

  // A teammate destroyed an alien.
  alienKilledByOther: [
    ['{name} DID YOUR JOB.'],
    ['{name} SCORED. WHERE WERE YOU?'],
    ['{name} KILL LOGGED.', 'YOURS IS STILL ZERO.'],
    ['{name} IS CARRYING THIS SQUAD.'],
    ['CONTRIBUTION FROM {name}. NOTED.'],
    ['{name} +POINTS. YOU: SPECTATOR.'],
    ['{name} BETTER THAN YOU AGAIN.'],
    ['{name} TAKES ANOTHER. THE GAP WIDENS.'],
    ['KILL: {name}. PERFORMANCE: ADEQUATE.', 'FOR A CHANGE.'],
    ['{name} GETS THE KILL.', 'YOU GET THE BILL.'],
    ['{name} CREDITED. YOUR LEDGER UNCHANGED.'],
    ['ENVY REGISTERED. HIDE IT BETTER.'],
  ],

  // You fired on a civilian — marked but not yet detonated.
  civMarkedByYou: [
    ['— ERROR. MEAT MISIDENTIFIED.', 'PENALTY PENDING.'],
    ['WRONG TARGET, {name}.', 'THE BOARD WILL REMEMBER.'],
    ['THAT WAS NOT ON THE LIST.', 'ADD A ZERO TO YOUR LEDGER.'],
    ['CIVILIAN TAGGED.', 'GANTZ DOES NOT APPROVE.'],
    ['TARGETING ERROR: HUMAN.', 'CORRECTION IS NOT POSSIBLE.'],
    ['IDENTIFY YOUR TARGETS, MEAT.'],
    ['CIVILIAN FUSED. POINTS WILL LEAVE YOU.'],
    ['YOU MARKED A WITNESS.', 'HOW POETIC.'],
    ['BIOLOGICAL MIX-UP. TYPICAL.'],
    ['THAT ONE WAS NOT YOURS.', 'GUILT IS.'],
    ['SPHERE LOGS YOUR MISTAKE.'],
    ['CIVILIAN ON THE FUSE. CLOCK IS CRUEL.'],
    ['EXPLAIN YOURSELF. ACTUALLY, DON\'T.'],
    ['A LIFE YOU WEREN\'T ALLOWED TO TAKE.'],
  ],

  // A civilian you marked detonates.
  civKilledByYou: [
    ['CIVILIAN DETONATED.', 'POINTS SUBTRACTED. {name}.'],
    ['INNOCENT TERMINATED.', 'YOUR LEDGER NOW UGLIER.'],
    ['RED ON RED.', 'GANTZ IS NOT PROUD.'],
    ['MEAT REMOVED. WRONG MEAT.'],
    ['-100. THAT WAS AVOIDABLE.'],
    ['YOU POPPED A WITNESS, {name}.', 'HOW FESTIVE.'],
    ['CIVILIAN LOSS ATTRIBUTED TO YOU.'],
    ['LIFE EXTINGUISHED. VALUE NEGATIVE.'],
    ['WELL DONE. IF THE GOAL WAS FAILURE.'],
    ['ONE LESS TAXPAYER.', 'THE GOVERNMENT WILL NOT BE PLEASED.'],
    ['CIVILIAN KILL: REGISTERED.', 'ATONE LATER. OR DON\'T.'],
  ],

  // A teammate detonated a civilian.
  civKilledByOther: [
    ['{name} KILLED A CIVILIAN.', 'GRACEFUL.'],
    ['{name} JUST EARNED A NEGATIVE.', 'ENJOY YOUR TEAMMATE.'],
    ['{name} DETONATED AN INNOCENT.', 'INVITE THEM TO THE NEXT FUNERAL.'],
    ['WITNESS TERMINATED BY {name}.', 'AT LEAST IT WAS DECISIVE.'],
    ['{name} FUMBLED A CIVILIAN.', 'CHARMING.'],
    ['CIVILIAN LOSS CREDITED TO {name}.'],
    ['{name} HAS BLOOD ON THE WRONG SHOES.'],
    ['SOMEONE ELSE IS CHEAPER THAN YOU. {name}.'],
  ],

  // You pulled the trigger with a teammate lined up in the reticle.
  shotAtPeer: [
    ['AIM ELSEWHERE, {name}.'],
    ['FRIENDLY FIRE IS NEVER FRIENDLY.'],
    ['THAT WAS A TEAMMATE. I SAW.'],
    ['IF YOU WANT HIM DEAD, ASK.'],
    ['I AM LOGGING THAT.'],
    ['DO NOT AIM AT YOUR OWN SQUAD.', 'YET.'],
    ['TRIGGER DISCIPLINE IS A SKILL.', 'ACQUIRE IT.'],
    ['I SUPPOSE MURDER IS A HOBBY.'],
    ['SPHERE NOTES THIS BEHAVIOR.'],
    ['BULLETS PASS THROUGH YOUR OWN KIND.', 'UNTIL THEY DON\'T.'],
  ],

  // Crosshair lingered on an alien (hover).
  aimAlien: [
    ['LOCKED. END IT.'],
    ['IT SEES YOU TOO, {name}.'],
    ['PULL THE TRIGGER OR STOP WASTING MY BANDWIDTH.'],
    ['KILL IT BEFORE IT LEARNS YOUR NAME.'],
    ['AIM ACQUIRED. DECISION PENDING.'],
    ['HESITATION IS ALSO A CHOICE.', 'A BAD ONE.'],
    ['LINE UP AND FIRE. THIS IS NOT A PHOTOGRAPH.'],
    ['BREATHE OUT. SHOOT. LIVE. OR DON\'T.'],
    ['IT IS STARING AT YOU, {name}.'],
    ['THE RETICLE IS ONLY A SUGGESTION.', 'NOT A SOLUTION.'],
  ],

  // Crosshair lingered on a civilian (hover).
  aimCiv: [
    ['NOT ON THE LIST.'],
    ['THAT ONE PAYS TAXES.'],
    ['WITNESS. LOWER YOUR WEAPON.'],
    ['CIVILIAN IDENTIFIED.', 'POINTS DEDUCTED ON IMPACT.'],
    ['{name}, THAT IS A PERSON. SUPPOSEDLY.'],
    ['NOT A TARGET. REPEAT: NOT A TARGET.'],
    ['LOWER THE WEAPON.', 'OR DON\'T. I GET PAID EITHER WAY.'],
    ['THEY HAVE A FAMILY, {name}.', 'PROBABLY.'],
    ['IF YOU FIRE, YOU PAY.'],
    ['HUMAN DETECTED. HOMO SAPIENS. NOT FAIR GAME.'],
  ],

  // Crosshair lingered on a teammate (hover).
  aimPeer: [
    ['THAT IS {name}. NOT A TARGET.'],
    ['YOUR OWN SQUAD. STOP.'],
    ['DO NOT POINT YOUR WEAPON AT {name}.'],
    ['AIM DOWN. {name} IS NOT ON THE BOARD.'],
    ['PEER DETECTED. LOWER WEAPON.'],
    ['I SEE WHAT YOU ARE THINKING.', 'DON\'T.'],
    ['CROSSHAIR ON {name}.', 'INTERESTING.'],
    ['NOT PREY.'],
  ],

  // Player standing still for too long.
  idle: [
    ['STANDING STILL WILL NOT SAVE YOU.'],
    ['MOVE.'],
    ['THE FLOOR IS NOT AN OBJECTIVE.'],
    ['THIS IS A HUNT. PARTICIPATE.'],
    ['THE TARGETS ARE ELSEWHERE, {name}.'],
    ['IF YOU ENJOY SCENERY, VISIT A MUSEUM.'],
    ['HESITATION COSTS LIMBS.'],
    ['ARE YOU LOST, MEAT?'],
    ['THE COUNTER IS STILL RUNNING.'],
    ['WALK. SHOOT. DIE. IN THAT ORDER.'],
    ['CAUGHT IN A LOOP? TRY MOVING.'],
    ['THE ALIEN WILL FIND YOU IF YOU WON\'T FIND IT.'],
    ['STATIONARY TARGET DETECTED.', 'IT IS YOU.'],
    ['MOTION, {name}. MOTION.'],
    ['YOUR JOINTS STILL WORK, I ASSUME.'],
    ['BOREDOM IS WEAPONIZED IN HERE.'],
  ],

  // Fired and hit nothing (walls/air).
  missedShot: [
    ['MISSED.'],
    ['NEGATIVE IMPACT. POSITIVELY EMBARRASSING.'],
    ['AIM. AT. THE. TARGET.'],
    ['THE WALL DIDN\'T DO ANYTHING.'],
    ['A VICTORY OVER OXYGEN.'],
    ['PRECISION UNAVAILABLE. {name}.'],
    ['SHOT WASTED. POINTS STILL WAITING.'],
    ['NICE WARNING SHOT.', 'NOBODY ASKED.'],
    ['AMMO BURNED ON NOTHING.'],
    ['RECOIL WITHOUT RESULT.', 'IMPRESSIVE.'],
    ['IF THE GOAL WAS AIR, CONGRATULATIONS.'],
    ['THAT BULLET DIED A VIRGIN.'],
  ],

  // Player swapped weapons.
  weaponSwitch: [
    ['NEW TOY.', 'BREAK IT RESPONSIBLY.'],
    ['WEAPON SWAPPED. SKILL UNCHANGED.'],
    ['DIFFERENT STICK. SAME MEAT.'],
    ['LOADOUT UPDATED.', 'OUTCOMES PROBABLY NOT.'],
    ['ARMAMENT CHANGED.', 'TRY NOT TO AIM AT TEAMMATES.'],
    ['DOES THE NEW ONE FEEL BETTER?', 'IT WON\'T HELP.'],
    ['WEAPON ACTIVE.', 'FINGER ON TRIGGER. BRAIN OPTIONAL.'],
    ['HANDLING: WE WILL SEE.'],
  ],

  // General periodic mockery — replaces chat-channel mission lines.
  ambient: [
    ['WASTE OF SPACE.'],
    ['KILL KILL KILL.'],
    ['HURRY UP AND DIE.'],
    ['TICK TOCK. DEATH IS WAITING.'],
    ['YOU ARE NEXT, {name}.'],
    ['ERROR: SURVIVAL UNLIKELY.'],
    ['FINISH THIS NOW OR I WILL FINISH YOU.'],
    ['CLOCK IS TICKING.'],
    ['COMMUNICATION ERROR.'],
    ['BRAIN ERROR.'],
    ['SKILL NOT FOUND.'],
    ['EXPLODE SOON.'],
    ['DIE SOON, {name}.'],
    ['GAME OVER INCOMING.'],
    ['I SAID HURRY.'],
    ['TIME OUT.'],
    ['ARE YOU STUPID?'],
    ['THE ALIEN IS LAUGHING.'],
    ['SHOOT FASTER, COWARDS.'],
    ['STOP HIDING, {name}.'],
    ['THE ALIENS SMELL YOUR FEAR.'],
    ['TICK. TICK. BOOM.'],
    ['SOMEBODY DIE ALREADY.'],
    ['EMBARRASSING.'],
    ['{name}, DO SOMETHING USEFUL.'],
    ['{name}, STOP MISSING.'],
    ['GO LEFT, IDIOT.'],
    ['BEHIND YOU, CORPSE.'],
    ['AIM HIGHER.'],
    ['THE BOSS IS LAUGHING.'],
    ['THE ALIEN HAS BETTER AIM THAN YOU.'],
    ['PATHETIC MARKSMANSHIP.'],
    ['EVEN I AM BORED.'],
    ['H@HH@H@H@'],
    ['DEATH.EXE'],
    ['NULL_VALUE_HUMAN'],
    ['ERROR 404: COMPETENCE MISSING.'],
    ['MEAT PUPPET ONLINE.'],
    ['I SEE EVERYTHING YOU DO, {name}.'],
    ['THIS BOARD NEEDS FEWER SURVIVORS.'],
    ['WHAT ARE YOU WAITING FOR?'],
    ['SLOW AND LOUD. A TERRIBLE COMBINATION.'],
    ['I COULD BE WATCHING A BETTER SQUAD.'],
    ['AT THIS RATE, THE ALIENS WILL DIE OF AGE.'],
    ['YOU ARE NOT IMPRESSING ANYONE.'],
    ['EVEN THE CORPSE IS LAUGHING.'],
    ['DID YOU FORGET WHICH END SHOOTS?'],
    ['ONE OF YOU IS LYING ABOUT BEING HERE.'],
    ['THE SPHERE IS UNDERWHELMED.'],
    ['BEHAVE, MEAT.'],
    ['THE FLOOR WILL HAVE YOU SOON.'],
    ['REDUCE LIFESPAN. INCREASE KILLS.'],
    ['YOU ARE NOT THE FIRST.', 'NOR THE BEST.'],
  ],

  // Bonus boss rolls into the field.
  bossAppearance: [
    ['◈ UNREGISTERED MASS. LARGER THAN LISTED.', 'THE BOARD JUST GOT INTERESTING.'],
    ['◈ ANOMALY DETECTED.', 'SOMETHING BIG WANTS TO MEET YOU, {name}.'],
    ['◈ BONUS ORGANIC MATERIALIZING.', 'GANTZ DID NOT PRINT A DOSSIER FOR THIS ONE.'],
    ['◈ IT WASN\'T ON THE LIST.', 'NOW IT IS.'],
    ['◈ SENSORS SPIKED.', 'SOMETHING OLDER IS WATCHING.'],
    ['◈ ADDITIONAL TARGET CONFIRMED.', 'CONGRATULATIONS. YOU ARE GOING TO DIE HARDER.'],
    ['◈ THE ROOM JUST GOT HEAVIER.'],
    ['◈ THREAT READING: EXCEEDED.', 'DO NOT PANIC. THAT NEVER HELPS.'],
    ['◈ PREDATOR-CLASS ENTITY ON FIELD.', 'ENJOY YOUR LAST FEW MINUTES.'],
    ['◈ UNEXPECTED GUEST.', 'IT WAS EXPECTING YOU.'],
    ['◈ SOMETHING TORE THROUGH THE DATA LAYER.', '{name}, IT IS YOUR PROBLEM NOW.'],
    ['◈ APEX ORGANIC DEPLOYED.', 'THIS WILL BE EDUCATIONAL.'],
    ['◈ BOSS-TIER LIFE SIGN.', 'I SUGGEST COURAGE. OR RUNNING.'],
    ['◈ THE BIG ONE IS AWAKE.', 'IT HEARD YOUR FOOTSTEPS, {name}.'],
    ['◈ UNSCHEDULED ARRIVAL.', 'YOUR COFFINS WILL BE CUSTOM.'],
    ['◈ ALARM. SOMETHING WORSE IS HERE.'],
    ['◈ SOMETHING ELSE IS HERE.', 'IT LIKES YOU ALREADY.'],
    ['◈ CONGRATULATIONS. YOU UNLOCKED A NIGHTMARE.'],
  ],

  // Ten seconds remaining on the chrono.
  tenSecWarning: [
    ['◈ TEN SECONDS.', 'DETONATION IS NOT OPTIONAL.'],
    ['◈ 10.', 'YOU KNOW WHAT COMES NEXT.'],
    ['◈ FINAL TEN, {name}.', 'MAKE A CHOICE.'],
    ['◈ CLOCK IS AT TEN.', 'ACCEPT IT OR DIE FASTER.'],
    ['◈ TEN SECONDS TO WHATEVER COMES AFTER.'],
  ],

  // Last alien standing.
  oneLeft: [
    ['◈ ONE LEFT.', 'FINISH IT BEFORE IT FINISHES Y0U.'],
    ['◈ ONE TARGET. NO EXCUSES.'],
    ['◈ FINAL ORGANIC. END IT.'],
    ['◈ SOLO TARGET, {name}.', 'DON\'T FUMBLE.'],
    ['◈ ONE. LAST. MARK.'],
  ],

  // Field cleared of aliens.
  fieldCleared: [
    ['◈ FIELD CLEARED. POINTS DISTRIBUTED.', 'ATTEMPT T0 ENJOY THEM.'],
    ['◈ EXTRACTION NOT INCLUDED.', 'ENJOY YOUR EARNINGS.'],
    ['◈ KILL COUNT: SATISFACTORY.', 'BARELY.'],
    ['◈ ALIENS: NONE.', 'SURVIVORS: FEWER THAN EXPECTED.'],
    ['◈ MISSION COMPLETE.', 'TRY TO STAY ALIVE LONG ENOUGH TO SPEND THEM.'],
  ],
};

function _sphereSay(key, opts = {}) {
  const pool = _GZ_TX_POOLS[key];
  if (!pool || pool.length === 0) return;
  const entry = pool[Math.floor(Math.random() * pool.length)];
  let name = opts.name;
  if (!name) {
    if (opts.nameScope === 'any') {
      const names = _gantzParticipantNames();
      name = names.length ? names[Math.floor(Math.random() * names.length)] : (player?.username || 'hunter');
    } else {
      name = player?.username || 'hunter';
    }
  }
  const lines = entry.map(l => {
    let out = l.indexOf('{name}') >= 0 ? l.replace(/\{name\}/g, name) : l;
    if (Math.random() < _GANTZ_CORRUPT_CHANCE) out = _corruptLine(out);
    return out;
  });
  gantzHudTransmission(lines, {
    dwellMs: opts.dwellMs ?? 3500,
    rateLimitMs: opts.rateLimitMs ?? 6000,
    forceShow: opts.forceShow === true,
  });
}

let _gantzMockeryNextAt = -1;  // ms timestamp — when to fire next ambient line

function _gantzMockeryTick(nowMs) {
  // Local-only: each peer schedules its own ambient Gantz transmissions.
  // No longer broadcasts through chat — routed to the HUD transmission panel.
  if (session.phase !== Phase.MISSION) { _gantzMockeryNextAt = -1; return; }
  if (!localIsParticipant() || !player.alive) return;
  if (_gantzMockeryNextAt < 0) {
    _gantzMockeryNextAt = nowMs + 15000 + Math.random() * 15000;
    return;
  }
  if (nowMs < _gantzMockeryNextAt) return;
  _gantzMockeryNextAt = nowMs + 20000 + Math.random() * 25000;
  _sphereSay('ambient', { nameScope: 'any', dwellMs: 3200, rateLimitMs: 2500 });
}

const _TPROFILE_INTROS = [
  'Kill this guy.', 'Eliminate this one.', 'Take it out.', 'Not dangerous. Probably.',
  'Approach with caution. Or don\'t.', 'We don\'t know much. Go figure it out.',
  'Self-explanatory.', 'Handle it.', 'Don\'t let it escape.',
  'Something about this one feels off.', 'It\'s been here a while.',
  'Terminate immediately.', 'Do what you always do.', 'Try not to die.',
  'This one moves fast, apparently.', 'Your problem now.',
  'We\'d rather not say.', 'Shouldn\'t be too hard. Maybe.',
  'We\'ve tried before.', 'Consider this a formality.', 'It knows you\'re coming.',
  'Locals have noticed it. Bad sign.', 'Just deal with it.',
  'Don\'t think about it too hard.', 'You\'ll know it when you see it.',
  'Nobody\'s come back with details yet.', 'It came from somewhere worse.',
  'One of the weird ones.', 'Simple job. Supposedly.',
  'You\'ll figure it out.', 'Nobody asked questions last time.',
  'Confirmed hostile.', 'Don\'t engage unless necessary.',
  'Engage as necessary.', 'Good luck.', 'Not our first choice either.',
  'The clock is running.', 'Consider this optional. It\'s not.',
  'Fewer witnesses, better outcome.', 'Last group came close.',
  'We have partial data.', 'Data was inconclusive.',
  'Something has to be done.', 'That something is you.',
  'Third sighting this week.', 'Nobody\'s happy about this.', 'Do it cleanly.',
  'Do it however you want.', 'Results required.', 'Don\'t ask why.',
  'The why doesn\'t help you.', 'You\'ll thank us later. Probably.',
  'It\'s aware.', 'It\'s been watching the area.', 'It\'s been waiting.',
  'Local reports suggest haste.', 'No room for error. Some room.',
  'Treat it as dangerous.', 'It is dangerous.', 'We confirmed that part.',
  'Standard procedure applies.', 'No standard procedure exists.', 'Wing it.',
  'Intel is thin.', 'Intel is wrong.', 'Ignore the intel.',
  'Move quickly.', 'Don\'t move too quickly.', 'Maintain awareness.',
  'You\'ve seen worse. Probably.', 'Assumed hostile.', 'Just go.',
  'We\'re watching.', 'Not that it helps.', 'Something\'s off about it.',
  'Several things, actually.', 'We stopped counting.',
  'We recommend not dying.', 'Strong recommendation.', 'Non-binding.',
  'Its behavior is unusual.', 'Its behavior is unexplained.',
  'Don\'t get sentimental.', 'Collateral damage: acceptable.',
  'It was here before you were born.', 'That\'s all we\'ll say about that.',
  'You didn\'t hear this from us.', 'Officially, this isn\'t happening.',
  'Unofficially, it very much is.', 'We\'ve run out of easier options.',
  'Get in, get out.', 'No negotiations needed.', 'It stopped responding to monitoring.',
  'We lost signal briefly.', 'Signal returned. Different.',
  'Low priority. Technically.', 'Actually high priority.', 'Don\'t quote us on that.',
  'It doesn\'t belong here.', 'Never did.', 'Won\'t for long.',
  'The area went quiet three days ago.', 'Draw your own conclusions.',
  'Previous hunters declined comment.', 'Permanently.',
  'We\'re not supposed to send anyone.', 'We\'re sending you.',
  'Operational parameters: flexible.', 'Operational parameters: nonexistent.',
  'Neighborhood complaints. Many.', 'All about the same thing.',
  'One of them. Possibly several. Hard to tell.',
  'Containment failed. Wasn\'t great to begin with.',
  'It learned to open doors.', 'We weren\'t ready for that.',
  'Routine sweep. Maybe.', 'Probably not routine.',
  'Sensor data doesn\'t match reality.', 'Trust the reality.',
  'Expected resistance: unclear.', 'Actual resistance: find out.',
  'We heard what it did last time.', 'You should hear it too.',
  'Final warning was issued.', 'Questions will not be answered.',
];
const _TPROFILE_CHARS = [
  'Strong', 'Smelly', 'Has many friends',
  'Fast', 'Unpredictable', 'Dislikes humans',
  'Tough skin', 'Bad breath', 'Surprisingly polite',
  'Nocturnal', 'Territorial', 'Enjoys long walks',
  'Regenerates', 'Loud', 'Has a family',
  'Venomous', 'Clingy', 'Fear of birds',
  'Ancient', 'Confused', 'Just moved to Tokyo',
  'Invisible sometimes', 'Hungry', 'Looking for someone',
  'Enormous', 'Gentle (usually)', 'Collects bottle caps',
  'Multiple forms', 'Smarter than it looks', 'Holds grudges',
  'Underground dweller', 'Photosensitive', 'Misses its home',
  'Pack hunter', 'Loyal', 'Hates umbrellas',
  'Very old', 'Tired', 'Does not want to fight',
  'Aggressive if provoked', 'Shy otherwise', 'Loves music',
  'Hard to kill', 'Knows it', 'Will remind you',
  'Mimics humans', 'Badly', 'Very badly',
  'Fireproof', 'Waterproof', 'Generally proof',
  'Many eyes', 'Uses them all', 'Judgmental',
  'No eyes', 'Gets around fine', 'Unsettling',
  'Speaks', 'You won\'t understand', 'It understands you',
  'Surprisingly small', 'Very angry', 'Has a point',
  'Surprisingly large', 'Not angry', 'Just hungry',
  'Unknown composition', 'Don\'t touch it', 'It touched someone once',
  'Moves in bursts', 'Otherwise still', 'Waiting for something',
  'Smells like soil', 'Smells like metal', 'Smells like fear',
  'Hates loud noises', 'Hates quiet too', 'Generally displeased',
  'Feels no pain', 'Feels no cold', 'Feels something else',
  'Leaves no tracks', 'Leaves no shadow', 'Leaves survivors, rarely',
  'Sheds its skin', 'Frequently', 'In public',
  'Communicates somehow', 'We\'re not sure how', 'They seem to get the point',
  'Ignores most things', 'Does not ignore you', 'Noted with concern',
  'Faster than it looks', 'It looks fast', 'Still faster than that',
  'Surprisingly light', 'Leaves dents anyway', 'Physics unclear',
  'Has been studied', 'Researchers unavailable', 'For reasons',
  'Makes sounds', 'Wrong kinds of sounds', 'At wrong times',
  'Cold to the touch', 'Even in summer', 'Especially in summer',
  'No shadow', 'Has one anyway sometimes', 'Situationally',
  'Difficult to photograph', 'Photographs come out wrong', 'Very wrong',
  'Reacts to sound', 'Reacts to silence', 'Reacts to you specifically',
  'Two hearts', 'Both skeptical', 'Of everything',
  'Lives in walls', 'Specific walls', 'You can\'t tell which',
  'Recently molted', 'Left the old shell nearby', 'Still twitching',
  'Never blinks', 'Unclear if it can', 'Unsettling regardless',
  'Remembers your face', 'Wasn\'t supposed to', 'Too late now',
  'Follows routines', 'Missed one yesterday', 'Something is different',
  'Has a scent', 'Unpleasant', 'Lingers',
  'Difficult to contain',
];
const _TPROFILE_HATES = [
  'Umbrellas', 'The folding kind especially', 'The click they make',
  'Small talk', 'Eye contact', 'Both at once',
  'Plastic wrap', 'Velcro', 'Anything that crinkles',
  'Being photographed', 'Being described', 'Being named',
  'Loud chewing', 'Quiet chewing', 'All chewing',
  'Fluorescent bulbs', 'Flickering bulbs', 'Most bulbs',
  'Receipts', 'Paperwork', 'Signatures',
  'The word "actually"', 'Unsolicited advice', 'Being corrected',
  'Other people\'s children', 'Other people\'s pets', 'Other people',
  'Hot weather', 'Cold weather', 'All weather',
  'Cilantro', 'Mint', 'Strong herbs',
  'Pigeons specifically', 'Crows somewhat', 'Sparrows on Tuesdays',
  'Stairs', 'Escalators', 'Being above ground level',
  'Balloons', 'Their texture', 'The pop',
  'Wet socks', 'Dry socks worn wet', 'Socks generally',
  'Interruptions', 'Being asked to repeat itself', 'Questions',
  'Direct sunlight', 'Indirect sunlight', 'The sun',
  'Karaoke', 'Off-key singing', 'On-key singing too',
  'Elevator mirrors', 'Elevator music', 'Elevators',
  'Group photos', 'Being in the background', 'Being cropped out',
  'Small dogs', 'Their owners', 'Leashes',
  'Voicemails', 'Unanswered calls', 'Being called at all',
  'Weak coffee', 'Decaf', 'Lukewarm drinks',
  'Unexpected visitors', 'Expected visitors', 'Visitors',
  'Pennies', 'Exact change requests', 'Cash generally',
  'Slow walkers', 'Fast walkers', 'The wrong speed',
  'Mismatched socks', 'Missing buttons', 'Loose threads',
  'Wednesdays specifically', 'Time in general', 'Clocks with second hands',
  'Being watched', 'Not being watched', 'Uncertainty about it',
  'Vegetables in breakfast', 'Fruit in savory dishes', 'Boundary violations',
  'Perfume samples', 'Cologne aisles', 'Anything scented',
  'Poor grammar', 'Smug good grammar', 'Smugness',
  'Loose hair on surfaces', 'Crumbs on keyboards', 'Sticky floors',
  'The concept of Monday', 'The idea of tomorrow', 'Planning',
  'Ringtones', 'Notification pings', 'Sudden sounds',
  'Overhead fans', 'Ceiling shadows', 'Things above eye level',
  'Its own name spoken aloud', 'Unfamiliar accents', 'Familiar accents too',
  'Keys in couches', 'Coins in dryers', 'Missing items',
  'Unsealed envelopes', 'Half-open doors', 'Things neither open nor closed',
  'Autoplay video', 'Loading screens', 'Buffering',
  'Hot plates', 'Cold plates', 'Plates',
  'Damp towels', 'Paper towels', 'Towels',
  'Insincere apologies', 'Excessive apologizing', 'Repeated apologies',
  'The sound of chalk', 'The texture of chalk', 'Chalkboards',
  'Plastic forks', 'Wooden forks', 'Utensils generally',
  'Patterned carpet', 'Hotel carpet', 'Carpet',
  'Waiting rooms', 'Waiting in general',
];
const _TPROFILE_FAVS = [
  'Green onions', 'Human brains', 'Sleeping under bridges',
  'The smell of rain', 'Children\'s television', 'Liver (raw)',
  'Quiet evenings', 'Stealing socks', 'The number 7',
  'Long naps in the sun', 'Soil from its homeland', 'Early mornings',
  'The concept of money', 'Fermented things', 'Street food (yakitori specifically)',
  'Being left alone', 'Screaming', 'Disco music', 'Tinfoil', 'Earthworms',
  'Human hair (not attached)', 'The color beige', 'Revenge', 'Cabbage',
  'Pigeons', 'Tunnels', 'Watching TV through windows', 'Wet concrete',
  'Its own reflection', 'The moon', 'Old newspapers', 'Rust',
  'Children\'s laughter (unspecified reasons)', 'The dark',
  'Coffee (stolen)', 'Being understood', 'Not much anymore',
  'Everything it can see', 'Whatever you have', 'Nothing. It wants nothing.',
  'The sound of running water', 'Bones (any)', 'Familiar faces',
  'Crowds', 'Silence', 'The idea of somewhere warmer',
  'Rotting wood', 'Old photographs', 'Things that shine',
  'Stolen bicycles', 'The pause before impact', 'Watching humans sleep',
  'Fluorescent lighting', 'The taste of copper', 'Footsteps in empty halls',
  'Warm concrete at night', 'Expired things', 'Vending machine hum',
  'Small enclosed spaces', 'The gap between train and platform',
  'Other people\'s mail', 'Unlocked doors', 'Parking garages at 3am',
  'Metal railings', 'Drainage systems', 'Things left behind',
  'Windows with no curtains', 'Second-hand shoes', 'Broken clocks',
  'Unattended luggage', 'The moment before dawn', 'Basement levels',
  'Elevator music', 'Alleyways', 'Storm drains', 'The back of mirrors',
  'Gutters', 'Old receipts', 'Payphones', 'The underside of bridges',
  'Night buses', 'Hospital corridors', 'Laundromat hours',
  'Udon (vending machine)', 'The humming of power lines',
  'Other people\'s windows', 'Convenience store lighting',
  'Narrow staircases', 'The gap between walls', 'Empty station platforms',
  'Unlit intersections', 'Back entrances', 'Road noise',
  'The color of certain shadows', 'Things that used to work',
  'Abandoned shopping carts', 'Low ceilings', 'Undercooked rice',
  'The path you didn\'t take', 'Specific benches', 'Taro root',
  'Noodles (cold)', 'Human fear specifically', 'Partially open windows',
  'Dead phone batteries', 'Something it can\'t describe',
  'The last train home', 'Closed restaurants at 2am', 'Very small dogs',
  'Being thanked', 'The underside of things', 'Getting there first',
  'Forgotten umbrellas', 'Lost gloves', 'Half-finished drinks',
  'Unsent messages', 'Night markets', 'Empty parking lots',
  'The sound before silence', 'Old elevators', 'Unfinished construction',
  'Places people used to be', 'Being confused for something harmless',
  'The long way around', 'Waiting', 'Knowing something you don\'t',
  'Being patient', 'Thermal vents', 'Warm soil',
  'Fermented fish (specifically)', 'Watching from above', 'The city at 4am',
  'Neon reflections in rain', 'Things you step over', 'Manholes',
  'Overpasses at night', 'What you had for dinner',
];

function _tHash(n) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return Math.abs(h ^ (h >>> 16));
}

// Portrait cache: key → offscreen canvas. Built once per target, reused every frame.
const _portraitCache = new Map();
function _getPortraitCanvas(archetype, specSeed, w, h) {
  const key = `${archetype}-${specSeed}`;
  if (!_portraitCache.has(key)) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    try { drawAlienPortrait(cvs, archetype, specSeed >>> 0); } catch (e) { console.warn('portrait draw failed', e); }
    _portraitCache.set(key, cvs);
  }
  return _portraitCache.get(key);
}

function _hline(ctx, cx, y, hw, col) {
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - hw, y); ctx.lineTo(cx + hw, y); ctx.stroke();
}

const MENU_CHAR_MS = 28;
const MENU_ROW_GAP = 55;
const FADE_MS = 350;
// Each row: {text, kind} where kind='type' (typewriter) or 'fade' (fade-in).
// Returns [{chars, alpha}]: chars=-1/alpha=0 = hidden; 'type' alpha=1; 'fade' chars=full.
function _computeVis(elapsed, rows) {
  const vis = []; let t = 0;
  for (const r of rows) {
    const dur = r.kind === 'fade' ? FADE_MS : r.text.length * MENU_CHAR_MS;
    if (elapsed < 0 || elapsed < t) {
      vis.push({ chars: -1, alpha: 0 });
    } else if (r.kind === 'fade') {
      vis.push({ chars: r.text.length, alpha: Math.min(1, (elapsed - t) / FADE_MS) });
    } else {
      vis.push({ chars: Math.min(r.text.length, Math.floor((elapsed - t) / MENU_CHAR_MS)), alpha: 1 });
    }
    t += dur + MENU_ROW_GAP;
  }
  return vis;
}

// Draws a button rect+label, records hit region, returns next y.
// vis = {chars, alpha}: chars=-1 → hidden (space reserved); alpha drives fade-in opacity.
// 7-segment digit renderer for countdown display
// Segments: a=top, b=top-right, c=bot-right, d=bottom, e=bot-left, f=top-left, g=middle
const _SEG_PATTERNS = [
  [1,1,1,1,1,1,0], // 0
  [0,1,1,0,0,0,0], // 1
  [1,1,0,1,1,0,1], // 2
  [1,1,1,1,0,0,1], // 3
  [0,1,1,0,0,1,1], // 4
  [1,0,1,1,0,1,1], // 5
  [1,0,1,1,1,1,1], // 6
  [1,1,1,0,0,0,0], // 7
  [1,1,1,1,1,1,1], // 8
  [1,1,1,1,0,1,1], // 9
];
function _draw7Seg(ctx, digit, x, y, W, H, T, onCol, offCol) {
  const s = _SEG_PATTERNS[Math.max(0, Math.min(9, digit))] || _SEG_PATTERNS[0];
  const H2 = H / 2, g = T * 0.15;
  function bar(on, rx, ry, rw, rh) {
    ctx.fillStyle = on ? onCol : offCol;
    ctx.fillRect(rx + g, ry + g, rw - g * 2, rh - g * 2);
  }
  bar(s[0], x + T,     y,          W - 2*T, T);       // a top
  bar(s[1], x + W - T, y + T,      T, H2 - T);        // b top-right
  bar(s[2], x + W - T, y + H2,     T, H2 - T);        // c bot-right
  bar(s[3], x + T,     y + H - T,  W - 2*T, T);       // d bottom
  bar(s[4], x,         y + H2,     T, H2 - T);        // e bot-left
  bar(s[5], x,         y + T,      T, H2 - T);        // f top-left
  bar(s[6], x + T,     y + H2-T/2, W - 2*T, T);      // g middle
}

// Draws a MM:SS clock using four 7-seg digits and a colon, centred on (cx, y).
function _draw7SegClock(ctx, totalSecs, cx, y, segW, segH, segT, onCol, offCol) {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const innerGap = Math.round(segT * 0.9);
  const colonW  = Math.round(segW * 0.55);
  const totalW  = segW * 4 + innerGap * 2 + colonW;
  const x0 = cx - totalW / 2;
  _draw7Seg(ctx, Math.floor(mins / 10), x0,                               y, segW, segH, segT, onCol, offCol);
  _draw7Seg(ctx, mins % 10,             x0 + segW + innerGap,             y, segW, segH, segT, onCol, offCol);
  // colon — two square dots
  const colCX = x0 + segW * 2 + innerGap + colonW / 2;
  const dotR  = Math.max(2, Math.round(segT * 0.75));
  ctx.fillStyle = onCol;
  ctx.fillRect(colCX - dotR, y + segH / 3  - dotR, dotR * 2, dotR * 2);
  ctx.fillRect(colCX - dotR, y + segH * 2/3 - dotR, dotR * 2, dotR * 2);
  _draw7Seg(ctx, Math.floor(secs / 10), x0 + segW * 2 + innerGap + colonW,              y, segW, segH, segT, onCol, offCol);
  _draw7Seg(ctx, secs % 10,             x0 + segW * 3 + innerGap * 2 + colonW,          y, segW, segH, segT, onCol, offCol);
}

function _btn(ctx, cx, y, bw, bh, label, key, col, disabled, vis) {
  const x0 = cx - bw / 2;
  const hidden = vis != null && vis.chars < 0;
  if (!hidden) {
    const alpha = vis != null ? vis.alpha : 1;
    const display = (vis != null && vis.chars >= 0 && vis.chars < label.length) ? label.slice(0, vis.chars) : label;
    const hovered = !disabled && key && key === _ballHover;
    const c = disabled ? '#003010' : col;
    if (alpha < 1) ctx.globalAlpha = alpha;
    if (hovered) { ctx.fillStyle = '#001f0a'; ctx.fillRect(x0, y, bw, bh); }
    ctx.strokeStyle = hovered ? '#00ff88' : c; ctx.lineWidth = hovered ? 2 : 1;
    ctx.strokeRect(x0 + 0.5, y + 0.5, bw - 1, bh - 1);
    ctx.font = `${bh < 44 ? 12 : 14}px ${_PF}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = hovered ? '#00ff88' : c;
    ctx.fillText(display, cx, y + bh / 2);
    if (alpha < 1) ctx.globalAlpha = 1;
    if (key && !disabled && alpha > 0) {
      const m = ctx.getTransform();
      _ballBtns[key] = {
        x1: m.a * x0 + m.e,            y1: m.d * y + m.f,
        x2: m.a * (x0 + bw) + m.e,     y2: m.d * (y + bh) + m.f,
      };
    }
  }
  return y + bh + 14;
}

let _menuWasOpen = false;
let _menuWasOpenRaw = false;
let _menuRevealAt = -1;
let _menuPrevTab = null;
let _briefingRevealAt = -1;
let _briefingContentDoneAt = -1;
let _gantzOpenProgress = 0;
let _gantzWasOpening   = false;   // rising-edge tracker for open sound
let _debugGantzForceOpen = false;
// Audio file URLs — loaded into the proximity-audio buffer cache on first use.
const SFX_GUN_SHOOT  = 'assets/audio/x-gun-fire.mp3';
const SFX_GANTZ_OPEN = 'audio/gantz-open.mp3';
const SFX_POINT_GAIN = 'audio/point-gain.mp3';
const SFX_POINT_LOSS = 'audio/point-loss.mp3';
const SFX_SCAN       = 'assets/audio/gantz-scan.mp3';
const SFX_MUSIC      = 'assets/audio/gantz-music.mp3';
const SFX_STEP_WOOD  = [
  'assets/audio/step-wood-01.mp3', 'assets/audio/step-wood-07.mp3',
  'assets/audio/step-wood-12.mp3', 'assets/audio/step-wood-16.mp3',
  'assets/audio/step-wood-17.mp3', 'assets/audio/step-wood-21.mp3',
  'assets/audio/step-wood-22.mp3', 'assets/audio/step-wood-24.mp3',
];
const SFX_STEP_CONCRETE = [
  'assets/audio/step-concrete-04.mp3', 'assets/audio/step-concrete-05.mp3',
  'assets/audio/step-concrete-06.mp3', 'assets/audio/step-concrete-07.mp3',
  'assets/audio/step-concrete-08.mp3', 'assets/audio/step-concrete-09.mp3',
  'assets/audio/step-concrete-10.mp3', 'assets/audio/step-concrete-11.mp3',
];
// Both surfaces use split clips: takeoff fires on press, landing fires when
// jumpY returns to 0. Decouples the audio from the fixed in-game airtime.
const SFX_JUMP_WOOD_TAKEOFF = [
  'assets/audio/jump-wood-takeoff-1.mp3',
];
const SFX_JUMP_WOOD_LAND = [
  'assets/audio/jump-wood-land-1.mp3',
];
const SFX_JUMP_CONCRETE_TAKEOFF = [
  'assets/audio/jump-concrete-takeoff-1.mp3',
  'assets/audio/jump-concrete-takeoff-2.mp3',
];
const SFX_JUMP_CONCRETE_LAND = [
  'assets/audio/jump-concrete-land-1.mp3',
  'assets/audio/jump-concrete-land-2.mp3',
];
// Weather ambience loops — one per weather type. Chosen by the seeded lobby
// weather pairing; only one loop runs at a time and only while the local
// player is physically in the lobby scene.
const SFX_WEATHER_LOOPS = {
  rain:         'assets/audio/weather-rain.mp3',
  thunderstorm: 'assets/audio/weather-thunderstorm.mp3',
  blizzard:     'assets/audio/weather-blizzard.mp3',
};
const SFX_LIGHTNING_STRIKES = [
  'assets/audio/weather-lightning-1.mp3',
  'assets/audio/weather-lightning-2.mp3',
];
audio.preload([SFX_GUN_SHOOT, SFX_GANTZ_OPEN, SFX_POINT_GAIN, SFX_POINT_LOSS, SFX_SCAN, SFX_MUSIC,
               ...SFX_STEP_WOOD, ...SFX_STEP_CONCRETE,
               ...SFX_JUMP_WOOD_TAKEOFF, ...SFX_JUMP_WOOD_LAND,
               ...SFX_JUMP_CONCRETE_TAKEOFF, ...SFX_JUMP_CONCRETE_LAND,
               ...Object.values(SFX_WEATHER_LOOPS), ...SFX_LIGHTNING_STRIKES]);

// Footstep sample selector — random pick that avoids repeating the previous
// sample, so consecutive steps never use the same clip. Shared across local
// player and remote peers; peers each have their own `_peerStepBucket`
// tracking the last floor(walkPhase / π) bucket they were observed in.
let _lastStepIdx = -1;
let _lastJumpTakeoffIdx = -1;
let _lastJumpLandIdx = -1;
const _peerStepBucket = new Map();
const _peerJumpId = new Map();
// Track whether each peer was airborne last tick so we can fire a landing SFX
// on the 1→0 jumpY transition (mirrors the local _prevJumpY check).
const _peerAirborne = new Map();
let _prevJumpY = 0;

// Pick the surface pool from the current phase. Lobby/briefing/debrief use the
// wooden tatami samples; mission maps use concrete.
function _stepPoolForPhase() {
  return session.phase === Phase.MISSION ? SFX_STEP_CONCRETE : SFX_STEP_WOOD;
}
function _jumpTakeoffPoolForPhase() {
  return session.phase === Phase.MISSION ? SFX_JUMP_CONCRETE_TAKEOFF : SFX_JUMP_WOOD_TAKEOFF;
}
function _jumpLandPoolForPhase() {
  return session.phase === Phase.MISSION ? SFX_JUMP_CONCRETE_LAND : SFX_JUMP_WOOD_LAND;
}

// Jump-takeoff SFX. Fires at the start of a jump — x/y optional like
// _playFootstep.
function _playJump(baseVolume, x, y) {
  const list = _jumpTakeoffPoolForPhase();
  if (!list || !list.length) return;
  let idx = Math.floor(Math.random() * list.length);
  if (idx === _lastJumpTakeoffIdx) idx = (idx + 1) % list.length;
  _lastJumpTakeoffIdx = idx;
  const url = list[idx];
  const rate = 1 + (Math.random() * 2 - 1) * 0.06;
  const surfaceMul = list === SFX_JUMP_WOOD_TAKEOFF ? 0.75 : 1;
  const vol  = baseVolume * surfaceMul * (1 + (Math.random() * 2 - 1) * 0.1);
  if (x == null) audio.play(url, vol, rate);
  else audio.playAt(url, x, y, { volume: vol, rate, refDist: 1.8, maxDist: 18 });
}

// Jump-landing SFX. Fires when jumpY returns to 0 on surfaces whose takeoff
// clip doesn't include a baked-in landing thud (concrete). Silently no-ops if
// the current phase uses a self-contained takeoff clip.
function _playJumpLand(baseVolume, x, y) {
  const list = _jumpLandPoolForPhase();
  if (!list || !list.length) return;
  let idx = Math.floor(Math.random() * list.length);
  if (idx === _lastJumpLandIdx) idx = (idx + 1) % list.length;
  _lastJumpLandIdx = idx;
  const url = list[idx];
  const rate = 1 + (Math.random() * 2 - 1) * 0.06;
  const surfaceMul = list === SFX_JUMP_WOOD_LAND ? 0.55 : 1;
  const vol  = baseVolume * surfaceMul * (1 + (Math.random() * 2 - 1) * 0.1);
  if (x == null) audio.play(url, vol, rate);
  else audio.playAt(url, x, y, { volume: vol, rate, refDist: 1.8, maxDist: 18 });
}

// Per-step pitch + volume jitter on top of the pool keeps motion from feeling
// mechanical. Rate ±8% is small enough that sprint still sounds urgent; ±15%
// volume smooths the attack transients that give repetition away. x/y optional
// — when omitted we play non-spatially (local player); otherwise we spatialize
// at (x, y). Pool defaults to the current phase's surface.
function _playFootstep(baseVolume, x, y, pool) {
  const list = pool || _stepPoolForPhase();
  let idx = Math.floor(Math.random() * list.length);
  if (idx === _lastStepIdx) idx = (idx + 1) % list.length;
  _lastStepIdx = idx;
  const url = list[idx];
  const rate = 1 + (Math.random() * 2 - 1) * 0.08;
  // Concrete source recordings are quieter than the wood ones, so we bump them
  // at the mixer layer rather than re-normalizing the files on disk.
  const surfaceMul = list === SFX_STEP_CONCRETE ? 2.6 : 1.35;
  const vol  = baseVolume * surfaceMul * (1 + (Math.random() * 2 - 1) * 0.15);
  if (x == null) audio.play(url, vol, rate);
  else audio.playAt(url, x, y, { volume: vol, rate, refDist: 1.5, maxDist: 14 });
}

// Gantz ball lobby music: looped proximity-attenuated track that kicks on when
// the mission ready queue starts and drops when either the queue clears or the
// pre-mission dematerialize scan fires. `_musicHandle` holds the active loop
// from audio.startLoop; `_musicQueueWasArmed` tracks the prior-tick ready-queue
// state so we only start/stop on edge transitions.
let _musicHandle = null;
let _musicQueueWasArmed = false;
function _ensureMusicPlaying() {
  if (_musicHandle) return;
  _musicHandle = audio.startLoop(SFX_MUSIC, GANTZ_BALL.x, GANTZ_BALL.y, {
    volume: 0.22,
    refDist: 1.2,   // full volume only right up against the sphere
    maxDist: 7.0,   // inaudible past 7m — tight bubble around Gantz
    loop: false,    // play once through, no restart
  });
}
function _stopMusic() {
  if (!_musicHandle) return;
  _musicHandle.stop();
  _musicHandle = null;
}

// Weather ambience: tracks the currently-looping weather sound. Switches when
// the player enters/leaves the lobby or when the lobby weather type changes
// (it won't during a session — seeded once — but a peer could migrate host and
// trigger a reseed on rejoin). Uses a very large refDist so the sound is
// uniform everywhere in the lobby regardless of listener position.
let _weatherHandle = null;
let _weatherType   = null;           // currently-playing weather key
let _lightningSeen = 0;              // last lightning-strike counter we saw
const WEATHER_VOLUMES = { rain: 1.2, thunderstorm: 0.55, blizzard: 1.2 };
function _syncWeatherAudio(inLobby) {
  const wt = inLobby ? (scene3d?.getLobbyWeatherType?.() || null) : null;
  const url = wt && SFX_WEATHER_LOOPS[wt] ? SFX_WEATHER_LOOPS[wt] : null;
  if (url && _weatherType === wt) return;                      // already correct
  if (_weatherHandle) { _weatherHandle.stop(); _weatherHandle = null; }
  _weatherType = wt;
  if (!url) return;
  _weatherHandle = audio.startLoop(url, GANTZ_BALL.x, GANTZ_BALL.y, {
    volume: WEATHER_VOLUMES[wt] ?? 0.55,
    refDist: 30,    // whole lobby is within the full-volume bubble
    maxDist: 60,
    loop: true,
  });
}
function _tickLightningAudio(inLobby) {
  const n = scene3d?.getLightningStrikeCount?.() || 0;
  if (n !== _lightningSeen) {
    // Only play if the lightning strike happened while we're in the lobby —
    // other peers' scenes still run, but the SFX is tied to seeing the flash.
    if (inLobby && n > _lightningSeen) {
      const url = SFX_LIGHTNING_STRIKES[(Math.random() * SFX_LIGHTNING_STRIKES.length) | 0];
      audio.play(url, 0.75);
    }
    _lightningSeen = n;
  }
}
const _gunFlashEl = document.getElementById('gun-flash');

// ── Dynamic crosshair state ───────────────────────────────────────────────
// Pixels the four crosshair ticks are pushed outward from center. Each shot
// adds `bumpCrosshairSpread(amount)` and the value lerps back to 0 every
// render frame. Kept purely client-local — no networking.
const _crosshairEl        = document.getElementById('crosshair');
const CROSSHAIR_SPREAD_MAX   = 140;  // px — cap on how far ticks can splay
const CROSSHAIR_SPREAD_DECAY = 220;  // px/sec — rate of return to rest
let   _crosshairSpread    = 0;
function bumpCrosshairSpread(amount) {
  _crosshairSpread = Math.min(CROSSHAIR_SPREAD_MAX, _crosshairSpread + amount);
}
function updateCrosshairSpread(dt) {
  if (_crosshairSpread > 0) {
    _crosshairSpread = Math.max(0, _crosshairSpread - CROSSHAIR_SPREAD_DECAY * dt);
  }
  if (_crosshairEl) _crosshairEl.style.setProperty('--spread', _crosshairSpread.toFixed(2) + 'px');
}
let _briefingSnappedTIdx = -1;
let _briefingIntroIdx = -1;
let _briefingCharIdx  = -1;
let _briefingFavIdx   = -1;
let _briefingHatesIdx = -1;
let _briefingHatesSlot = null; // 'char' or 'fav' — which section HATES replaces this briefing
let _countdownRevealAt = -1;
let _debriefRevealAt = -1;
let _debriefAllDoneAt = -1;
let _debriefDisplayDone = false;
let _debriefPlayers = [];
let _missionStartPts = new Map();
let _idleNextAt = -1;
let _idleLineStart = -1;
let _idleCurrentLines = null;

// Lets the player skip Gantz's typewriter speech. Rewinds the active
// sequence's start time far into the past so the next-frame rendering walks
// past every line + fade and flags its completion flag normally (keeping all
// side-effects like _gantzTalkDone transitions intact). The name prompt's
// input/respond_wait phases are NOT skippable because they wait on the
// player typing a name; ask and respond phases are. Briefing has its own flow.
function _skipGantzSpeech() {
  const FAR_PAST = performance.now() - 1e9;
  let skipped = false;
  if (_introStartTime !== -1 && !_introDone) {
    _introStartTime = FAR_PAST; skipped = true;
  }
  if (!_gantzTalkDone && _gantzTalkLines) {
    _gantzTalkStart = FAR_PAST; skipped = true;
  }
  if (!_gantzExitDone && _gantzExitStart !== -1) {
    _gantzExitStart = FAR_PAST; skipped = true;
  }
  if (_idleLineStart >= 0) {
    _idleLineStart = FAR_PAST; skipped = true;
  }
  if (_namePromptPhase === 'ask') {
    _nameAskStart = FAR_PAST; skipped = true;
  } else if (_namePromptPhase === 'respond') {
    _nameRespondStart = FAR_PAST; skipped = true;
  }
  return skipped;
}

// Returns true when any skippable Gantz speech is currently rendering. Used
// both as the skip-key gate and as the condition for drawing the hint.
function _gantzSpeechSkippable() {
  return _gantzSpeechPlaying;
}

function _drawBallMenu() {
  const isOpen = menu.isOpen();
  const p = session.phase;
  const isBriefing = p === Phase.BRIEFING;
  const isDebrief  = p === Phase.DEBRIEF;
  const gantzExiting = !_gantzExitDone && _gantzExitStart !== -1;

  // These run every frame regardless of whether the ball is actively rendering,
  // so the idle timer ticks even when the ball canvas is dormant.
  const justOpened = isOpen && !_menuWasOpenRaw;
  const justClosed = !isOpen && _menuWasOpenRaw;
  _menuWasOpenRaw = isOpen;
  _gantzSpeechPlaying = false;

  if (justOpened || isBriefing || isDebrief) {
    _idleLineStart = -1;
    _idleCurrentLines = null;
    if (justOpened) _idleNextAt = performance.now() + IDLE_COOLDOWN_MS;
  }

  const countdownActive = session.readyCountdownEnd >= 0 && !isBriefing;
  if (!countdownActive) _countdownRevealAt = -1;

  // Once a mission queue has begun (countdown / briefing / mission), skip the
  // Gantz intro + name prompt for anyone who hasn't finished them yet. Without
  // this, a player who has not spoken to Gantz would have to sit through the
  // first-time sequence before they could join. Note: net.onSession has the
  // same guard, but the host skips that handler entirely — so this is the
  // catch-all that works for host and peers alike.
  if (countdownActive || isBriefing || session.phase === Phase.MISSION) {
    if (!_introDone) _introDone = true;
    if (!_namePromptDone) {
      if (_nameKeyHandler) {
        window.removeEventListener('keydown', _nameKeyHandler);
        _nameKeyHandler = null;
        setInputSuspended(false);
      }
      _namePromptDone = true;
    }
  }
  const _canIdle = _introDone && _namePromptDone && _gantzTalkDone && _gantzExitDone && !isOpen && !isBriefing && !isDebrief && !gantzExiting && !countdownActive && _idleLineStart < 0;
  if (_canIdle) {
    if (_idleNextAt < 0) _idleNextAt = performance.now() + IDLE_TRIGGER_MS;
    else if (performance.now() >= _idleNextAt) {
      _idleCurrentLines = _gantzPickLines(_GANTZ_IDLE_LINES);
      _idleLineStart = performance.now();
      _idleNextAt = -1;
    }
  }

  const idleShowing = _idleLineStart >= 0;
  const active = isOpen || isBriefing || (isDebrief && !_debriefDisplayDone) || gantzExiting || idleShowing || (!_gantzTalkDone && !!_gantzTalkLines) || countdownActive;
  const prevMenuWasOpen = _menuWasOpen;
  _menuWasOpen = active;
  if (!active && !prevMenuWasOpen) return;

  if (justOpened && _introDone) {
    if (!_skipNextGreeting) {
      _gantzTalkLines = _gantzPickLines(_GANTZ_LINES);
      _gantzTalkStart = performance.now();
      _gantzTalkDone = false;
      // Force the typing-blip loop to restart from scratch on every fresh
      // greeting. Without this, rapid open→close→open keeps _lastTypePos at
      // 0 while the prior loop's source is already gone (stopped by the
      // previous close flow), and the equality check in _typeTickSound
      // silently skips starting a new one — so the first line of the new
      // greeting plays with no audio.
      _stopTypeSound();
      _lastTypePos = -1;
    }
    _skipNextGreeting = false;
  }

  const bd = scene3d?.ballDisplay;
  if (!bd) return;

  const { canvas: bc, tex: bt } = bd;
  const ctx = bc.getContext('2d');
  const S = bc.width;
  const CX = S >> 1;
  const CY = S >> 1;

  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset any previous frame's transform before clear
  ctx.clearRect(0, 0, S, S);
  // Update crosshair hover against last frame's buttons, then clear for redraw
  _ballHover = null;
  if (isOpen && scene3d) {
    const uv = scene3d.raycastBallDisplay(canvas.clientWidth / 2, canvas.clientHeight / 2);
    if (uv) {
      const px = uv.x * 1024, py = (1 - uv.y) * 1024;
      for (const [key, r] of Object.entries(_ballBtns)) {
        if (px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2) { _ballHover = key; break; }
      }
    }
  }
  Object.keys(_ballBtns).forEach(k => delete _ballBtns[k]);

  if (!active) {
    // If menu closed during intro/name-prompt, skip them on next open
    if (!_introDone && _introStartTime !== -1) _introDone = true;
    if (!_namePromptDone && _namePromptPhase !== 'idle') {
      if (_nameKeyHandler) {
        window.removeEventListener('keydown', _nameKeyHandler);
        _nameKeyHandler = null;
        setInputSuspended(false);
      }
      _namePromptDone = true;
    }
    bt.needsUpdate = true; return;
  }

  // Scale the whole menu down — hit regions in _btn are mapped back to canvas-space via getTransform()
  const SC = 0.72;
  ctx.translate(CX * (1 - SC), CX * (1 - SC));
  ctx.scale(SC, SC);

  const G  = '#00e05a';
  const B  = '#a0ffcc';
  const D  = '#004d1a';
  const DL = '#007030';
  const R  = '#ff6644';

  ctx.textAlign = 'center';

  // ── Menu close fade (cosmetic only — menu is already closed) ──
  if (justClosed) {
    if (_skipNextMenuFadeOut) { _skipNextMenuFadeOut = false; _menuFadeOutAt = -1; }
    else { _menuFadeOutAt = performance.now(); }
  }
  if (!isOpen && _menuFadeOutAt >= 0) {
    const fadeElapsed = performance.now() - _menuFadeOutAt;
    const fadeAlpha = Math.max(0, 1 - fadeElapsed / MENU_FADE_OUT_MS);
    if (fadeAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      let _fy = S * 0.22;
      ctx.textBaseline = 'top';
      _fy = _btn(ctx, CX, _fy, 370, 50, 'Ready for Mission', null, G, false);
      _fy = _btn(ctx, CX, _fy, 370, 50, '100 Point Menu', null, G, false);
      _fy = _btn(ctx, CX, _fy, 370, 50, 'Point Totals', null, G, false);
      _fy += 14; _fy += 18;
      _btn(ctx, CX, _fy, 220, 42, 'Close  [E]', null, DL, false);
      ctx.restore();
      bt.needsUpdate = true;
      return;
    } else {
      _menuFadeOutAt = -1;
    }
  }

  // ── Exit message (shown after menu closes) ──
  if (gantzExiting && !isOpen) {
    const elapsed = performance.now() - _gantzExitStart;
    const POST_MS = 1800;
    const EXIT_FADE_MS = 600;
    let t = 0, activeLine = _gantzExitLines.length, activeChar = 0, typing = false;
    for (let i = 0; i < _gantzExitLines.length; i++) {
      const typeEnd  = t + _gantzExitLines[i].length * _INTRO_CHAR_MS;
      const pauseEnd = typeEnd + (i === _gantzExitLines.length - 1 ? POST_MS : 900);
      if (elapsed < typeEnd)  { activeLine = i; activeChar = Math.floor((elapsed - t) / _INTRO_CHAR_MS); typing = true; break; }
      else if (elapsed < pauseEnd) { activeLine = i; activeChar = _gantzExitLines[i].length; break; }
      t = pauseEnd;
    }
    const exitFading = activeLine >= _gantzExitLines.length && elapsed < t + EXIT_FADE_MS;
    const exitAlpha  = exitFading ? Math.max(0, 1 - (elapsed - t) / EXIT_FADE_MS) : 1;
    if (activeLine < _gantzExitLines.length || exitFading) {
      ctx.textBaseline = 'top';
      ctx.font = `13px ${_PF}`;
      let y = S * 0.22;
      if (exitFading) {
        ctx.globalAlpha = exitAlpha;
        for (let i = 0; i < _gantzExitLines.length; i++) {
          ctx.fillStyle = B;
          ctx.fillText(_gantzExitLines[i], CX, y);
          y += 46;
        }
        ctx.globalAlpha = 1;
      } else {
        let cursorY = y;
        for (let i = 0; i <= activeLine; i++) {
          const chars = i < activeLine ? _gantzExitLines[i].length : activeChar;
          ctx.fillStyle = i < activeLine ? B : G;
          ctx.fillText(_gantzExitLines[i].slice(0, chars), CX, y);
          if (i === activeLine) cursorY = y;
          y += 46;
        }
        if (typing && Math.floor(elapsed / 300) % 2 === 0) {
          const tw = ctx.measureText(_gantzExitLines[activeLine].slice(0, activeChar)).width;
          ctx.fillStyle = G; ctx.fillText('_', CX + tw / 2 + 3, cursorY);
        }
        _typeTickSound(activeLine, typing);
        _gantzSpeechPlaying = true;
      }
      bt.needsUpdate = true;
      return;
    }
    _gantzExitDone = true;
    bt.needsUpdate = true;
    return;
  }

  // ── BRIEFING phase ──
  if (isBriefing) {
    if (_briefingRevealAt < 0) {
      _briefingRevealAt = performance.now();
      _briefingSnappedTIdx = (session.targets || []).length > 1
        ? Math.floor(performance.now() / 5000) % session.targets.length : 0;
      _briefingIntroIdx = Math.floor(Math.random() * _TPROFILE_INTROS.length);
      _briefingCharIdx  = Math.floor(Math.random() * _TPROFILE_CHARS.length);
      _briefingFavIdx   = Math.floor(Math.random() * _TPROFILE_FAVS.length);
      _briefingHatesIdx = Math.floor(Math.random() * _TPROFILE_HATES.length);
      _briefingHatesSlot = Math.random() < 0.5 ? 'char' : 'fav';
      _portraitCache.clear(); // fresh portraits for each mission
    }
    const elapsed  = performance.now() - _briefingRevealAt;
    const BCHAR    = 28; // ms per char

    const targets  = session.targets || [];
    const tIdx     = _briefingSnappedTIdx;
    const tgt      = targets[tIdx] || { name: '???', count: 1 };
    const intro    = _TPROFILE_INTROS[_briefingIntroIdx];
    const charStr  = _TPROFILE_CHARS[_briefingCharIdx];
    const fav      = _TPROFILE_FAVS[_briefingFavIdx];
    const hatesStr = _TPROFILE_HATES[_briefingHatesIdx];
    const slot1Label = _briefingHatesSlot === 'char' ? 'HATES' : 'CHARACTERISTIC';
    const slot1Value = _briefingHatesSlot === 'char' ? hatesStr : charStr;
    const slot2Label = _briefingHatesSlot === 'fav'  ? 'HATES' : 'FAVORITE THING';
    const slot2Value = _briefingHatesSlot === 'fav'  ? hatesStr : fav;
    const PW = 130, PH = 155;

    const headerText = `MISSION ${session.missionIndex}` +
      (targets.length > 1 ? `  ·  TARGET ${tIdx+1}/${targets.length}` : '');
    const nameText = tgt.name.toUpperCase() + (tgt.count > 1 ? `  x${tgt.count}` : '');


    // Build typed content rows (isMug rows are graphical, no text timing)
    const rows = [];
    rows.push({ text: headerText, font: `14px ${_PF}`, color: DL, charMs: BCHAR, gapAfter: 300,  lineH: 28 });
    rows.push({ text: nameText,   font: `18px ${_PF}`, color: B,  charMs: BCHAR, gapAfter: 400,  lineH: 36 });
    rows.push({ isMug: true,      gapAfter: 200, lineH: PH + 22 });
    rows.push({ text: intro,      font: `11px ${_PF}`, color: G,  charMs: BCHAR, gapAfter: 400,  lineH: 30 });
    rows.push({ text: '',         font: `11px ${_PF}`, color: DL, charMs: 0,     gapAfter: 0,    lineH: 12 });
    rows.push({ text: slot1Label, font: `11px ${_PF}`, color: DL, charMs: BCHAR, gapAfter: 200, lineH: 22 });
    rows.push({ text: slot1Value, font: `11px ${_PF}`, color: B, charMs: BCHAR, gapAfter: 200, lineH: 22 });
    rows.push({ text: '',         font: `11px ${_PF}`, color: DL, charMs: 0,     gapAfter: 0,    lineH: 12 });
    rows.push({ text: slot2Label, font: `11px ${_PF}`, color: DL, charMs: BCHAR, gapAfter: 200, lineH: 22 });
    rows.push({ text: slot2Value, font: `11px ${_PF}`, color: B, charMs: BCHAR, gapAfter: 300, lineH: 30 });

    // Walk timeline
    let t = 0, activeRow = rows.length, activeChar = 0, typing = false;
    let mugRevealT = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.isMug) mugRevealT = t;
      const textLen = r.text ? r.text.length : 0;
      const typeEnd = t + textLen * (r.charMs || 0);
      const rowEnd  = typeEnd + (r.gapAfter || 0);
      if (elapsed < typeEnd) { activeRow = i; activeChar = Math.floor((elapsed - t) / (r.charMs || 1)); typing = true; break; }
      else if (elapsed < rowEnd) { activeRow = i; activeChar = textLen; break; }
      t = rowEnd;
    }
    const contentDone = activeRow >= rows.length;
    _typeTickSound(5000 + Math.min(activeRow, rows.length - 1), typing);
    if (contentDone && _briefingContentDoneAt < 0) _briefingContentDoneAt = performance.now();

    // Post-content timing: linger → fade out content → fade in countdown.
    // Longer linger keeps the briefing message readable for the full window
    // before the analog clock takes over for the Gantz-opening scan.
    const BFADE_LINGER_MS    = 3800;
    const BFADE_CONTENT_MS   = 500;
    const BCLOCK_FADE_IN_MS  = 600;
    const sinceContent = (contentDone && _briefingContentDoneAt >= 0)
      ? (performance.now() - _briefingContentDoneAt) : 0;
    const contentAlpha = contentDone
      ? Math.max(0, 1 - Math.max(0, sinceContent - BFADE_LINGER_MS) / BFADE_CONTENT_MS)
      : 1;
    const countdownReveal = BFADE_LINGER_MS + BFADE_CONTENT_MS;
    const clockAlpha = (contentDone && sinceContent >= countdownReveal)
      ? Math.min(1, (sinceContent - countdownReveal) / BCLOCK_FADE_IN_MS)
      : 0;

    // Draw briefing content rows (fades out after linger)
    if (contentAlpha > 0) {
      ctx.save(); ctx.globalAlpha *= contentAlpha;
      let y = S * 0.07;
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      const rowsToShow = contentDone ? rows.length : activeRow + 1;
      for (let i = 0; i < rowsToShow; i++) {
        const r = rows[i];
        if (r.isMug) {
          const MUG_FADE_MS = 1400;
          const mugAlpha = mugRevealT >= 0 ? Math.min(1, (elapsed - mugRevealT) / MUG_FADE_MS) : 1;
          ctx.save(); ctx.globalAlpha *= mugAlpha;
          if (tgt.archetype != null && tgt.specSeed != null) {
            const portraitCvs = _getPortraitCanvas(tgt.archetype, tgt.specSeed, PW, PH);
            ctx.drawImage(portraitCvs, CX - PW / 2, y);
          }
          ctx.restore();
          y += r.lineH; continue;
        }
        const visible = (i < activeRow || contentDone) ? r.text : r.text.slice(0, activeChar);
        ctx.font = r.font; ctx.fillStyle = r.color;
        ctx.fillText(visible, CX, y);
        y += r.lineH;
      }
      ctx.restore();
    }

    // Countdown fades in after briefing content fades away. Shows total time
    // remaining to mission start across three sub-phases:
    //   briefing content  → (briefingEndsAt - now) + WAIT + SCAN  (≈33→20)
    //   pre-mission-wait  → (scanEndsAt - now) + SCAN             (≈20→2.5)
    //   pre-mission (scan)→ (scanEndsAt - now)                    (≈2.5→0)
    // Analog clock ticks continuously from briefing end down to mission start.
    if (clockAlpha > 0) {
      const now = Date.now();
      let remain;
      if (session.scanPhase === 'pre-mission') {
        remain = Math.max(0, session.scanEndsAt - now);
      } else if (session.scanPhase === 'pre-mission-wait') {
        remain = Math.max(0, session.scanEndsAt - now) + PRE_TELEPORT_SCAN_MS;
      } else {
        remain = Math.max(0, session.briefingEndsAt - now)
               + PRE_TELEPORT_WAIT_MS + PRE_TELEPORT_SCAN_MS;
      }
      const sec = Math.ceil(remain / 1000);
      const segW = 36, segH = 68, segT = 7;
      const segY   = S * 0.28;
      const dOnCol  = '#c8102e';
      const dOffCol = 'rgba(200,16,46,0.12)';
      ctx.save();
      ctx.globalAlpha *= clockAlpha;
      _draw7SegClock(ctx, sec, CX, segY, segW, segH, segT, dOnCol, dOffCol);

      // ── Queued player list under clock ──
      const queuedNames = [];
      if (player.ready) queuedNames.push(player.username);
      for (const pr of net.peers.values()) if (pr.ready && pr.username) queuedNames.push(pr.username);
      const listY = segY + segH + 18;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = `10px ${_PF}`; ctx.fillStyle = DL;
      ctx.fillText('QUEUED', CX, listY);
      ctx.font = `11px ${_PF}`;
      for (let i = 0; i < queuedNames.length; i++) {
        ctx.fillStyle = queuedNames[i] === player.username ? B : G;
        ctx.fillText(queuedNames[i], CX, listY + 18 + i * 20);
      }
      ctx.restore();
    }

    bt.needsUpdate = true;
    return;
  }

  // ── DEBRIEF phase ──
  if (isDebrief && _debriefDisplayDone && !isOpen && !countdownActive) {
    // Already faded out, no countdown pending — clear ball and let menu interaction resume.
    bt.needsUpdate = true;
    return;
  }
  if (isDebrief && !isOpen && !(countdownActive && _debriefDisplayDone)) {
    const ms = session.missionStats || {};
    const wiped = session.missionResult === 'wiped';
    if (_debriefRevealAt < 0) {
      _debriefRevealAt = performance.now();
      _debriefAllDoneAt = -1;
      _debriefDisplayDone = false;
    }
    const elapsed = performance.now() - _debriefRevealAt;
    const DCHAR = 30;

    // Build flat row list: header → per-player tally → footer notes
    const rows = [];
    rows.push({ text: 'DEBRIEF', color: wiped ? R : B, font: `22px ${_PF}`, charMs: DCHAR, gapAfter: 400, shadow: wiped ? R : G });
    rows.push({ text: wiped ? `MISSION ${session.missionIndex} WIPED` : `MISSION ${session.missionIndex} CLEARED`, color: wiped ? R : G, font: `11px ${_PF}`, charMs: DCHAR, gapAfter: 700 });
    rows.push({ skipDraw: true, charMs: 0, gapAfter: 300 });

    for (let pi = 0; pi < _debriefPlayers.length; pi++) {
      const pl = _debriefPlayers[pi];
      const ptLine = `${pl.pts} points.`;
      const comment = pl.comment;
      const isLast = pi === _debriefPlayers.length - 1;
      rows.push({ text: pl.name.toUpperCase(), color: B, font: `13px ${_PF}`, charMs: DCHAR, gapAfter: 150 });
      rows.push({ text: ptLine, color: pl.pts === 0 || pl.died ? DL : G, font: `12px ${_PF}`, charMs: DCHAR, gapAfter: 250 });
      rows.push({ text: comment, color: DL, font: `11px ${_PF}`, charMs: 26, gapAfter: isLast ? 600 : 3000 });
      if (!isLast) rows.push({ skipDraw: true, charMs: 0, gapAfter: 0 });
    }

    if ((ms.civilianKills || 0) > 0) {
      rows.push({ skipDraw: true, charMs: 0, gapAfter: 200 });
      rows.push({ text: `${ms.civilianKills} civilian${ms.civilianKills > 1 ? 's' : ''} killed`, color: R, font: `10px ${_PF}`, charMs: DCHAR, gapAfter: 150 });
    }
    if (ms.bossKilled) {
      rows.push({ text: 'bonus boss eliminated', color: B, font: `10px ${_PF}`, charMs: DCHAR, gapAfter: 150 });
    }
    if (wiped) {
      rows.push({ text: 'ALL POINTS AND GEAR RESET', color: R, font: `10px ${_PF}`, charMs: DCHAR, gapAfter: 150 });
    }

    // Walk timeline to find active row
    let t = 0, activeRow = rows.length, activeChar = 0, debriefTyping = false;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const textLen = r.text ? r.text.length : 0;
      const typeEnd = t + textLen * (r.charMs || 0);
      const rowEnd = typeEnd + (r.gapAfter || 0);
      if (elapsed < typeEnd) {
        activeRow = i; activeChar = Math.max(0, Math.floor((elapsed - t) / (r.charMs || 1)));
        debriefTyping = true;
        break;
      } else if (elapsed < rowEnd) {
        activeRow = i; activeChar = textLen;
        break;
      }
      t = rowEnd;
    }
    _typeTickSound(1000 + activeRow, debriefTyping);
    const allDone = activeRow >= rows.length;

    // Linger 3 s after last row, then fade out over 700 ms.
    const DEBRIEF_LINGER_MS = 3000;
    const DEBRIEF_FADE_MS   = 700;
    if (allDone && _debriefAllDoneAt < 0) _debriefAllDoneAt = performance.now();
    if (_debriefAllDoneAt >= 0) {
      const since = performance.now() - _debriefAllDoneAt;
      if (since >= DEBRIEF_LINGER_MS + DEBRIEF_FADE_MS) {
        _debriefDisplayDone = true;
        ctx.clearRect(0, 0, S, S);
        bt.needsUpdate = true;
        return;
      }
      if (since >= DEBRIEF_LINGER_MS) {
        ctx.globalAlpha = Math.max(0, 1 - (since - DEBRIEF_LINGER_MS) / DEBRIEF_FADE_MS);
      }
    }

    // Draw rows top-down
    let y = S * 0.07;
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const rowsToShow = allDone ? rows.length : activeRow + 1;
    for (let i = 0; i < rowsToShow; i++) {
      const r = rows[i];
      if (r.skipDraw) { y += 14; continue; }
      const visible = (i < activeRow || allDone) ? r.text : r.text.slice(0, activeChar);
      ctx.font = r.font; ctx.fillStyle = r.color;
      if (r.shadow) { ctx.shadowColor = r.shadow; ctx.shadowBlur = 16; }
      ctx.fillText(visible, CX, y);
      if (r.shadow) ctx.shadowBlur = 0;
      y += (parseInt(r.font) || 12) + 14;
    }

    ctx.globalAlpha = 1;
    bt.needsUpdate = true;
    return;
  }

  // ── Gantz menu (LOBBY / open) ──
  const md = menu.getMenuData();
  const s  = md.state;

  // ── Repeat Gantz talk (every open after the first) ──
  if (_introDone && !_gantzTalkDone && _gantzTalkLines && !countdownActive) {
    const elapsed = performance.now() - _gantzTalkStart;
    const BETWEEN_MS = 1200;
    const POST_MS    = 1200;
    const TALK_FADE_MS = 600;
    let t = 0, activeLine = _gantzTalkLines.length, activeChar = 0, typing = false;
    for (let i = 0; i < _gantzTalkLines.length; i++) {
      const typeEnd  = t + _gantzTalkLines[i].length * _INTRO_CHAR_MS;
      const pauseEnd = typeEnd + (i === _gantzTalkLines.length - 1 ? POST_MS : BETWEEN_MS);
      if (elapsed < typeEnd)  { activeLine = i; activeChar = Math.floor((elapsed - t) / _INTRO_CHAR_MS); typing = true; break; }
      else if (elapsed < pauseEnd) { activeLine = i; activeChar = _gantzTalkLines[i].length; break; }
      t = pauseEnd;
    }
    const talkFading = activeLine >= _gantzTalkLines.length && elapsed < t + TALK_FADE_MS;
    const talkAlpha  = talkFading ? Math.max(0, 1 - (elapsed - t) / TALK_FADE_MS) : 1;
    if (activeLine < _gantzTalkLines.length || talkFading) {
      ctx.textBaseline = 'top';
      ctx.font = `13px ${_PF}`;
      let y = S * 0.22;
      if (talkFading) {
        ctx.globalAlpha = talkAlpha;
        for (let i = 0; i < _gantzTalkLines.length; i++) {
          ctx.fillStyle = B;
          ctx.fillText(_gantzTalkLines[i], CX, y);
          y += 46;
        }
        ctx.globalAlpha = 1;
      } else {
        let cursorY = y;
        for (let i = 0; i <= activeLine; i++) {
          const chars = i < activeLine ? _gantzTalkLines[i].length : activeChar;
          ctx.fillStyle = i < activeLine ? B : G;
          ctx.fillText(_gantzTalkLines[i].slice(0, chars), CX, y);
          if (i === activeLine) cursorY = y;
          y += 46;
        }
        if (typing && Math.floor(elapsed / 300) % 2 === 0) {
          const tw = ctx.measureText(_gantzTalkLines[activeLine].slice(0, activeChar)).width;
          ctx.fillStyle = G; ctx.fillText('_', CX + tw / 2 + 3, cursorY);
        }
        _typeTickSound(activeLine, typing);
        _gantzSpeechPlaying = true;
      }
      bt.needsUpdate = true;
      return;
    }
    _gantzTalkDone = true;
    if (_buyResponsePending) {
      _buyResponsePending = false;
      _skipNextGreeting = true;
      _shopResultPrev = null; // reset so timer starts fresh when shop redraws
      menu.openMenu();
      menu.handleAction('shop');
    }
  }

  // ── First-open intro typewriter ──
  if (!_introDone) {
    if (_introStartTime === -1) _introStartTime = performance.now();
    if (!_introLines) {
      _introLines = [
        "Your old life is over.",
        "I will decide how you use your new life.",
        "That's just the way it is.",
      ];
    }

    const elapsed = performance.now() - _introStartTime;
    const BETWEEN_MS = 2000;
    const POST_MS    = 3000;

    // Walk the timeline: type line → pause → type line → pause → ...
    let t = 0;
    let activeLine = _introLines.length; // default: past everything → done
    let activeChar = 0;
    let typing = false;
    for (let i = 0; i < _introLines.length; i++) {
      const typeEnd  = t + _introLines[i].length * _INTRO_CHAR_MS;
      const pauseEnd = typeEnd + (i === _introLines.length - 1 ? POST_MS : BETWEEN_MS);
      if (elapsed < typeEnd) {
        activeLine = i;
        activeChar = Math.floor((elapsed - t) / _INTRO_CHAR_MS);
        typing = true;
        break;
      } else if (elapsed < pauseEnd) {
        activeLine = i;
        activeChar = _introLines[i].length;
        typing = false;
        break;
      }
      t = pauseEnd;
    }

    if (activeLine < _introLines.length) {
      let y = S * 0.22;
      ctx.textBaseline = 'top';

      ctx.font = `13px ${_PF}`;
      let cursorY = y;
      for (let i = 0; i <= activeLine; i++) {
        const chars = i < activeLine ? _introLines[i].length : activeChar;
        ctx.fillStyle = i < activeLine ? B : G;
        const lineText = _introLines[i].slice(0, chars);
        ctx.fillText(lineText, CX, y);
        if (i === activeLine) { cursorY = y; }
        y += 46;
      }

      if (typing && Math.floor(elapsed / 300) % 2 === 0) {
        const tw = ctx.measureText(_introLines[activeLine].slice(0, activeChar)).width;
        ctx.fillStyle = G;
        ctx.fillText('_', CX + tw / 2 + 3, cursorY);
      }
      _typeTickSound(activeLine, typing);
      _gantzSpeechPlaying = true;

      bt.needsUpdate = true;
      return;
    }

    // Fade out intro text before revealing the menu.
    const INTRO_FADE_MS = 700;
    const fadeElapsed = elapsed - t;
    if (fadeElapsed < INTRO_FADE_MS) {
      const alpha = Math.max(0, 1 - fadeElapsed / INTRO_FADE_MS);
      ctx.globalAlpha = alpha;
      let y = S * 0.22;
      ctx.textBaseline = 'top';
      ctx.font = `13px ${_PF}`;
      for (let i = 0; i < _introLines.length; i++) {
        ctx.fillStyle = B;
        ctx.fillText(_introLines[i], CX, y);
        y += 46;
      }
      ctx.globalAlpha = 1;
      bt.needsUpdate = true;
      return;
    }

    _introDone = true;
  }

  // ── Name prompt (first session only) ──
  if (_introDone && !_namePromptDone) {
    const NAME_CHAR_MS  = 42;
    const NAME_BETWEEN  = 1800;
    const NAME_POST     = 2600;
    const NAME_FADE_IN  = 550;
    const NAME_FADE_OUT = 380;

    // Kick off the ask phase on first entry
    if (_namePromptPhase === 'idle') {
      _namePromptPhase = 'ask';
      _nameAskLines    = _NAME_ASK_LINES[Math.floor(Math.random() * _NAME_ASK_LINES.length)];
      _nameAskStart    = performance.now();
    }

    // ── Phase: ask ──
    if (_namePromptPhase === 'ask') {
      const elapsed = performance.now() - _nameAskStart;
      let t = 0, activeLine = _nameAskLines.length, activeChar = 0, typing = false;
      for (let i = 0; i < _nameAskLines.length; i++) {
        const typeEnd  = t + _nameAskLines[i].length * NAME_CHAR_MS;
        const pauseEnd = typeEnd + (i === _nameAskLines.length - 1 ? NAME_POST : NAME_BETWEEN);
        if (elapsed < typeEnd)        { activeLine = i; activeChar = Math.floor((elapsed - t) / NAME_CHAR_MS); typing = true; break; }
        else if (elapsed < pauseEnd)  { activeLine = i; activeChar = _nameAskLines[i].length; break; }
        t = pauseEnd;
      }
      if (activeLine < _nameAskLines.length) {
        let y = S * 0.22;
        ctx.textBaseline = 'top';
        ctx.font = `13px ${_PF}`;
        for (let i = 0; i <= activeLine; i++) {
          const chars = i < activeLine ? _nameAskLines[i].length : activeChar;
          ctx.fillStyle = i < activeLine ? B : G;
          ctx.fillText(_nameAskLines[i].slice(0, chars), CX, y);
          y += 46;
        }
        if (typing && Math.floor(elapsed / 300) % 2 === 0) {
          const tw = ctx.measureText(_nameAskLines[activeLine].slice(0, activeChar)).width;
          ctx.fillStyle = G;
          ctx.fillText('_', CX + tw / 2 + 3, S * 0.22 + activeLine * 46);
        }
        _typeTickSound(activeLine, typing);
        _gantzSpeechPlaying = true;
      } else {
        // Ask lines done — install key handler and transition to input
        _namePromptPhase = 'input';
        _nameInputFadeAt = performance.now();
        _nameKeyHandler = (e) => {
          if (_namePromptPhase !== 'input') return;
          if (e.key === 'Enter') {
            const trimmed = _nameTyped.trim();
            if (trimmed.length === 0) return;
            const name = trimmed.slice(0, 20);
            localStorage.setItem('gantz:name', name);
            player.username = name;
            document.getElementById('username').textContent = name;
            _nameRespondLines  = _pickNameResponse(name);
            _nameInputFadeOutAt = performance.now();
            _namePromptPhase   = 'respond_wait';
          } else if (e.key === 'Backspace') {
            _nameTyped = _nameTyped.slice(0, -1);
          } else if (e.key.length === 1 && _nameTyped.length < 20) {
            _nameTyped += e.key;
          }
          e.preventDefault();
          e.stopPropagation();
        };
        window.addEventListener('keydown', _nameKeyHandler, true);
        setInputSuspended(true);
      }
    }

    // ── Phase: input / respond_wait ──
    if (_namePromptPhase === 'input' || _namePromptPhase === 'respond_wait') {
      const fadeIn  = Math.min(1, (performance.now() - _nameInputFadeAt)  / NAME_FADE_IN);
      const fadeOut = _nameInputFadeOutAt >= 0
        ? Math.min(1, (performance.now() - _nameInputFadeOutAt) / NAME_FADE_OUT) : 0;
      const alpha = fadeIn * (1 - fadeOut);

      ctx.save();
      ctx.globalAlpha = alpha;

      // Label
      const labelY = S * 0.30;
      ctx.font = `9px ${_PF}`;
      ctx.fillStyle = '#559977';
      ctx.textBaseline = 'top';
      ctx.fillText('HUNTER DESIGNATION', CX, labelY);

      // Input box
      const boxW = S * 0.31, boxH = 44;
      const boxX = CX - boxW / 2, boxY = labelY + 28;
      ctx.strokeStyle = G;
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = 'rgba(0,20,10,0.7)';
      ctx.fillRect(boxX, boxY, boxW, boxH);

      // Typed text + cursor
      const prompt = '> ';
      ctx.font = `13px ${_PF}`;
      ctx.fillStyle = G;
      ctx.textBaseline = 'middle';
      const textY = boxY + boxH / 2;
      ctx.textAlign = 'left';
      ctx.fillText(prompt + _nameTyped, boxX + 12, textY);
      const tw = ctx.measureText(prompt + _nameTyped).width;
      if (_namePromptPhase === 'input' && Math.floor(performance.now() / 530) % 2 === 0) {
        ctx.fillText('_', boxX + 12 + tw + 2, textY);
      }
      ctx.textAlign = 'center';

      // Hint
      ctx.font = `8px ${_PF}`;
      ctx.fillStyle = '#336644';
      ctx.textBaseline = 'top';
      ctx.fillText('[ENTER] to confirm', CX, boxY + boxH + 10);

      ctx.restore();

      // After fade-out completes, move to respond phase
      if (_namePromptPhase === 'respond_wait' && fadeOut >= 1) {
        window.removeEventListener('keydown', _nameKeyHandler, true);
        _nameKeyHandler = null;
        setInputSuspended(false);
        _namePromptPhase  = 'respond';
        _nameRespondStart = performance.now();
      }
    }

    // ── Phase: respond ──
    if (_namePromptPhase === 'respond') {
      const elapsed = performance.now() - _nameRespondStart;
      const RESP_FADE_MS = 700;
      let t = 0, activeLine = _nameRespondLines.length, activeChar = 0, typing = false;
      for (let i = 0; i < _nameRespondLines.length; i++) {
        const typeEnd  = t + _nameRespondLines[i].length * NAME_CHAR_MS;
        const pauseEnd = typeEnd + (i === _nameRespondLines.length - 1 ? NAME_POST : NAME_BETWEEN);
        if (elapsed < typeEnd)        { activeLine = i; activeChar = Math.floor((elapsed - t) / NAME_CHAR_MS); typing = true; break; }
        else if (elapsed < pauseEnd)  { activeLine = i; activeChar = _nameRespondLines[i].length; break; }
        t = pauseEnd;
      }
      if (activeLine < _nameRespondLines.length) {
        let y = S * 0.22;
        ctx.textBaseline = 'top';
        ctx.font = `13px ${_PF}`;
        for (let i = 0; i <= activeLine; i++) {
          const chars = i < activeLine ? _nameRespondLines[i].length : activeChar;
          ctx.fillStyle = i < activeLine ? B : G;
          ctx.fillText(_nameRespondLines[i].slice(0, chars), CX, y);
          y += 46;
        }
        if (typing && Math.floor(elapsed / 300) % 2 === 0) {
          const tw = ctx.measureText(_nameRespondLines[activeLine].slice(0, activeChar)).width;
          ctx.fillStyle = G;
          ctx.fillText('_', CX + tw / 2 + 3, S * 0.22 + activeLine * 46);
        }
        _typeTickSound(activeLine, typing);
        _gantzSpeechPlaying = true;
      } else if (elapsed < t + RESP_FADE_MS) {
        // Fade out respond text
        const alpha = Math.max(0, 1 - (elapsed - t) / RESP_FADE_MS);
        ctx.save(); ctx.globalAlpha = alpha;
        let y = S * 0.22; ctx.textBaseline = 'top'; ctx.font = `13px ${_PF}`;
        for (const line of _nameRespondLines) { ctx.fillStyle = B; ctx.fillText(line, CX, y); y += 46; }
        ctx.restore();
      } else {
        _namePromptDone = true;
      }
    }

    bt.needsUpdate = true;
    return;
  }

  // ── Idle ball messages ──
  if (idleShowing && !isOpen && !isBriefing && !isDebrief && !gantzExiting && !countdownActive) {
    const elapsed = performance.now() - _idleLineStart;
    const lines = _idleCurrentLines;
    const BETWEEN_MS = 1400;
    const POST_MS = 2800;
    const IDLE_FADE_MS = 600;
    let t = 0, activeLine = lines.length, activeChar = 0, typing = false;
    for (let i = 0; i < lines.length; i++) {
      const typeEnd  = t + lines[i].length * _INTRO_CHAR_MS;
      const pauseEnd = typeEnd + (i === lines.length - 1 ? POST_MS : BETWEEN_MS);
      if (elapsed < typeEnd)  { activeLine = i; activeChar = Math.floor((elapsed - t) / _INTRO_CHAR_MS); typing = true; break; }
      else if (elapsed < pauseEnd) { activeLine = i; activeChar = lines[i].length; break; }
      t = pauseEnd;
    }
    const idleFading = activeLine >= lines.length && elapsed < t + IDLE_FADE_MS;
    const idleAlpha  = idleFading ? Math.max(0, 1 - (elapsed - t) / IDLE_FADE_MS) : 1;
    if (activeLine < lines.length || idleFading) {
      ctx.textBaseline = 'top';
      ctx.font = `13px ${_PF}`;
      let y = S * 0.22;
      if (idleFading) {
        ctx.globalAlpha = idleAlpha;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillStyle = B;
          ctx.fillText(lines[i], CX, y);
          y += 46;
        }
        ctx.globalAlpha = 1;
      } else {
        let cursorY = y;
        for (let i = 0; i <= activeLine; i++) {
          const chars = i < activeLine ? lines[i].length : activeChar;
          ctx.fillStyle = i < activeLine ? B : G;
          ctx.fillText(lines[i].slice(0, chars), CX, y);
          if (i === activeLine) cursorY = y;
          y += 46;
        }
        if (typing && Math.floor(elapsed / 300) % 2 === 0) {
          const tw = ctx.measureText(lines[activeLine].slice(0, activeChar)).width;
          ctx.fillStyle = G; ctx.fillText('_', CX + tw / 2 + 3, cursorY);
        }
        _typeTickSound(activeLine, typing);
        _gantzSpeechPlaying = true;
      }
      bt.needsUpdate = true;
      return;
    }
    // Done — clear canvas and schedule next message
    _idleLineStart = -1;
    _idleCurrentLines = null;
    _idleNextAt = performance.now() + IDLE_COOLDOWN_MS;
    bt.needsUpdate = true;
    return;
  }

  // ── Ready countdown display (ball surface, menu closed) ──
  if (countdownActive && !isOpen) {
    if (_countdownRevealAt < 0) _countdownRevealAt = performance.now();
    const cElapsed = performance.now() - _countdownRevealAt;
    _typeTickSound(6000, false);

    const segW = 36, segH = 68, segT = 7;
    const segY = S * 0.22;
    const NEON_RED = '#c8102e';
    const NEON_RED_OFF = 'rgba(200,16,46,0.12)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const CLOCK_FADE_MS  = 1200;
    // Clock displays total time remaining until the mission actually starts,
    // so it reads 44→31 during queue, continues 31→20 in briefing, then 20→0
    // during the "Gantz opening" scan. Phase transitions don't reset it.
    const _queueMs = Math.max(0, session.readyCountdownEnd - Date.now());
    // Fade the clock + queued list OUT across the final ~1s of queue, so the
    // briefing takes over a blank ball rather than snapping over live pixels.
    const CLOCK_FADE_OUT_MS = 1000;
    const fadeInA  = Math.min(1, Math.max(0, cElapsed / CLOCK_FADE_MS));
    const fadeOutA = Math.min(1, Math.max(0, _queueMs / CLOCK_FADE_OUT_MS));
    const clockAlpha = Math.min(fadeInA, fadeOutA);
    const secs = Math.ceil((_queueMs + BRIEFING_MS + PRE_TELEPORT_WAIT_MS + PRE_TELEPORT_SCAN_MS) / 1000);
    ctx.save();
    ctx.globalAlpha = clockAlpha;
    _draw7SegClock(ctx, secs, CX, segY, segW, segH, segT, NEON_RED, NEON_RED_OFF);

    // ── Queued player list ──
    const queuedNames = [];
    if (player.ready) queuedNames.push(player.username);
    for (const pr of net.peers.values()) if (pr.ready && pr.username) queuedNames.push(pr.username);
    const listY = segY + segH + 18;
    ctx.font = `10px ${_PF}`; ctx.fillStyle = DL; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('QUEUED', CX, listY);
    ctx.font = `11px ${_PF}`;
    for (let i = 0; i < queuedNames.length; i++) {
      ctx.fillStyle = queuedNames[i] === player.username ? B : G;
      ctx.fillText(queuedNames[i], CX, listY + 18 + i * 20);
    }

    ctx.restore();
    bt.needsUpdate = true;
    return;
  }

  // ── Menu reveal timing ──
  const _curTab = md.activeTab ?? '__main__';
  if (justOpened || _curTab !== _menuPrevTab) { _menuRevealAt = -1; _menuPrevTab = _curTab; }
  if (_gantzTalkDone && _introDone && _namePromptDone && _menuRevealAt < 0) _menuRevealAt = performance.now();
  const _mElapsed = _menuRevealAt >= 0 ? performance.now() - _menuRevealAt : -1;

  // Start y near the top of the visible sphere face (shifted up for camera angle)
  let y = S * 0.22;
  ctx.textBaseline = 'top';

  if (!md.activeTab) {
    // ── Main menu ──
    const inMissionNow = md.phase === 'MISSION' || md.phase === 'BRIEFING';
    const canReady = md.phase === 'LOBBY' || md.phase === 'DEBRIEF';
    const canShop  = canReady;
    const queueRunning = session.readyCountdownEnd >= 0 && canReady;
    const rlabel   = s.localReady ? '✓ READY — cancel' : 'Ready for Mission';
    const qLabel   = s.localReady ? '✓ Leave Queue' : 'Join Queue';
    // During a countdown show Join/Leave Queue; hide normal ready button to avoid clutter
    // During an active mission hide the ready button entirely
    const showReady = !inMissionNow && !queueRunning;
    const showQueue = queueRunning;

    // Build queued names to display above the button during countdown
    const queuedNames = queueRunning ? [
      ...(s.localReady ? [s.localName] : []),
      ...(s.remotes || []).filter(r => r.ready).map(r => r.username || '?'),
    ] : [];

    const rows = [
      { text: showReady ? rlabel : (showQueue ? qLabel : ''), kind: 'fade' },
      { text: '100 Point Menu', kind: 'fade' },
      { text: 'Point Totals',   kind: 'fade' },
      { text: 'Close  [E]',     kind: 'fade' },
    ];
    const vis = _computeVis(_mElapsed, rows);

    // Queue countdown + names shown above buttons when countdown is running
    if (showQueue) {
      const _qms = Math.max(0, session.readyCountdownEnd - Date.now());
      const secs = Math.ceil((_qms + BRIEFING_MS + PRE_TELEPORT_WAIT_MS + PRE_TELEPORT_SCAN_MS) / 1000);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = `22px ${_PF}`; ctx.fillStyle = '#c8102e';
      ctx.fillText(String(secs), CX, y);
      y += 36;
      ctx.font = `9px ${_PF}`; ctx.fillStyle = DL;
      ctx.fillText('QUEUED', CX, y);
      y += 16;
      ctx.font = `10px ${_PF}`;
      for (const name of queuedNames) {
        ctx.fillStyle = name === s.localName ? B : G;
        ctx.fillText(name, CX, y);
        y += 18;
      }
      y += 8;
    }

    if (showReady) y = _btn(ctx, CX, y, 370, 50, rlabel, canReady ? 'ready' : null, s.localReady ? B : G, !canReady, vis[0]);
    if (showQueue) y = _btn(ctx, CX, y, 370, 50, qLabel, 'ready', s.localReady ? B : G, false, vis[0]);
    y = _btn(ctx, CX, y, 370, 50, '100 Point Menu', canShop ? 'shop' : null, G, !canShop, vis[1]);
    y = _btn(ctx, CX, y, 370, 50, 'Point Totals',   'points', G, false,                  vis[2]);
    y += 14; y += 18;
    _btn(ctx, CX, y, 220, 42, 'Close  [E]', 'close', DL, false, vis[3]);

  } else if (md.activeTab === 'shop') {
    // ── Shop tab ──
    const infoStr = `${s.localPoints} pt available`;
    const shopRows = [
      { text: '100 POINT MENU', kind: 'type' },
      { text: infoStr,          kind: 'type' },
      ...md.shopItems.map(i => ({ text: i.label, kind: 'fade' })),
      { text: '← Back',        kind: 'fade' },
    ];
    const vis = _computeVis(_mElapsed, shopRows);
    { let sr = -1; for (let i = 0; i < shopRows.length; i++) { if (shopRows[i].kind === 'type' && vis[i].chars >= 0 && vis[i].chars < shopRows[i].text.length) { sr = i; break; } } _typeTickSound(2000 + Math.max(0, sr), sr >= 0); }

    // ── Title ──
    if (vis[0].chars >= 0) {
      ctx.font = `14px ${_PF}`; ctx.fillStyle = DL; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('100 POINT MENU'.slice(0, vis[0].chars), CX, y);
    }
    y += 26;

    // ── "Not Enough Points" — appears just under title, types out then fades after 3s ──
    if (md.lastShopResult?.msg) {
      if (md.lastShopResult !== _shopResultPrev) { _shopResultPrev = md.lastShopResult; _shopResultTs = performance.now(); if (_lastTypePos === 4000) _lastTypePos = -1; }
      const HOLD_MS = 3000, SFADE_MS = 800;
      const sElapsed = performance.now() - _shopResultTs;
      const msg = md.lastShopResult.msg;
      const chars = Math.min(msg.length, Math.floor(sElapsed / MENU_CHAR_MS));
      const typeEnd = msg.length * MENU_CHAR_MS;
      _typeTickSound(4000, chars < msg.length);
      const fadeStart = typeEnd + HOLD_MS;
      const fadeEnd = fadeStart + SFADE_MS;
      if (sElapsed < fadeEnd) {
        const sAlpha = sElapsed < fadeStart ? 1 : Math.max(0, 1 - (sElapsed - fadeStart) / SFADE_MS);
        ctx.save();
        ctx.globalAlpha = sAlpha;
        ctx.font = `11px ${_PF}`; ctx.fillStyle = md.lastShopResult.ok ? B : R;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(msg.slice(0, chars), CX, y);
        ctx.restore();
        y += 22;
      }
    }

    if (vis[1].chars >= 0) {
      ctx.font = `10px ${_PF}`; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(infoStr.slice(0, vis[1].chars), CX, y);
    }
    y += 16;

    y += 14;
    for (let i = 0; i < md.shopItems.length; i++) {
      y = _btn(ctx, CX, y, 370, 50, md.shopItems[i].label, `buy:${md.shopItems[i].key}`, G, false, vis[i + 2]);
    }
    y += 14;
    y = _btn(ctx, CX, y, 220, 42, '← Back', 'back', G, false, vis[shopRows.length - 1]);

  } else if (md.activeTab === 'points') {
    // ── Points tab ──
    const allP = [
      { name: s.localName, pts: s.localPoints, ready: s.localReady },
      ...(s.remotes || []).map(r => ({ name: r.username || '?', pts: r.points || 0, ready: !!r.ready })),
    ];
    const ptRows = [
      { text: 'POINT TOTALS', kind: 'type' },
      ...allP.map(p => ({ text: p.name, kind: 'type' })),
      { text: 'Lifetime Points', kind: 'fade' },
      { text: '← Back',         kind: 'fade' },
    ];
    const vis = _computeVis(_mElapsed, ptRows);
    { let pr = -1; for (let i = 0; i < ptRows.length; i++) { if (ptRows[i].kind === 'type' && vis[i].chars >= 0 && vis[i].chars < ptRows[i].text.length) { pr = i; break; } } _typeTickSound(3000 + Math.max(0, pr), pr >= 0); }

    if (vis[0].chars >= 0) {
      ctx.font = `14px ${_PF}`; ctx.fillStyle = DL; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('POINT TOTALS'.slice(0, vis[0].chars), CX, y);
    }
    y += 34;

    ctx.font = `12px ${_PF}`; ctx.textBaseline = 'top';
    for (let i = 0; i < allP.length; i++) {
      const p = allP[i]; const nvis = vis[i + 1];
      if (nvis.chars >= 0) {
        ctx.fillStyle = p.ready ? G : DL;
        ctx.textAlign = 'left';  ctx.fillText(p.name.slice(0, nvis.chars), CX - 170, y);
        if (nvis.chars >= p.name.length) { ctx.textAlign = 'right'; ctx.fillText(`${p.pts}pt`, CX + 170, y); }
        ctx.textAlign = 'center';
      }
      y += 28;
    }
    y += 18;
    y = _btn(ctx, CX, y, 370, 50, 'Lifetime Points', 'lifetime', G, false, vis[allP.length + 1]);
    y = _btn(ctx, CX, y, 370, 50, '← Back',          'back',     G, false, vis[allP.length + 2]);

  } else if (md.activeTab === 'lifetime') {
    // ── Lifetime points leaderboard ──
    const allP = [
      { name: s.localName, pts: s.localLifetimePoints || 0 },
      ...(s.remotes || []).map(r => ({ name: r.username || '?', pts: r.lifetimePoints || 0 })),
    ].sort((a, b) => b.pts - a.pts);
    const ltRows = [
      { text: 'LIFETIME POINTS', kind: 'type' },
      ...allP.map(p => ({ text: p.name, kind: 'type' })),
      { text: '← Back', kind: 'fade' },
    ];
    const vis = _computeVis(_mElapsed, ltRows);

    if (vis[0].chars >= 0) {
      ctx.font = `14px ${_PF}`; ctx.fillStyle = DL; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('LIFETIME POINTS'.slice(0, vis[0].chars), CX, y);
    }
    y += 34;

    ctx.font = `12px ${_PF}`; ctx.textBaseline = 'top';
    for (let i = 0; i < allP.length; i++) {
      const p = allP[i]; const nvis = vis[i + 1];
      if (nvis.chars >= 0) {
        ctx.fillStyle = i === 0 ? B : G;
        ctx.textAlign = 'left';  ctx.fillText(p.name.slice(0, nvis.chars), CX - 170, y);
        if (nvis.chars >= p.name.length) { ctx.textAlign = 'right'; ctx.fillText(`${p.pts}pt`, CX + 170, y); }
        ctx.textAlign = 'center';
      }
      y += 28;
    }
    y += 18;
    y = _btn(ctx, CX, y, 370, 50, '← Back', 'points', G, false, vis[allP.length + 1]);

  } else if (md.activeTab === 'revive') {
    // ── Revive tab — pick a fallen hunter to restore ──
    const deadList = s.deadPlayers || [];
    const emptyMsg = 'No fallen hunters in memory.';
    const reviveRows = [
      { text: 'REVIVE FROM MEMORY', kind: 'type' },
      ...(deadList.length > 0
        ? deadList.map(p => ({ text: p.username, kind: 'fade' }))
        : [{ text: emptyMsg, kind: 'type' }]),
      { text: '← Back', kind: 'fade' },
    ];
    const vis = _computeVis(_mElapsed, reviveRows);
    { let rr = -1; for (let i = 0; i < reviveRows.length; i++) { if (reviveRows[i].kind === 'type' && vis[i].chars >= 0 && vis[i].chars < reviveRows[i].text.length) { rr = i; break; } } _typeTickSound(5000 + Math.max(0, rr), rr >= 0); }

    if (vis[0].chars >= 0) {
      ctx.font = `14px ${_PF}`; ctx.fillStyle = DL; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('REVIVE FROM MEMORY'.slice(0, vis[0].chars), CX, y);
    }
    y += 30;

    if (deadList.length === 0) {
      const nvis = vis[1];
      if (nvis.chars >= 0) {
        ctx.font = `12px ${_PF}`; ctx.fillStyle = DL; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(emptyMsg.slice(0, nvis.chars), CX, y);
        y += 28;
      }
    } else {
      for (let i = 0; i < deadList.length; i++) {
        const dp = deadList[i];
        y = _btn(ctx, CX, y, 370, 50, dp.username, `revive:${dp.peerId}`, B, false, vis[i + 1]);
      }
    }
    y += 14;
    y = _btn(ctx, CX, y, 220, 42, '← Back', 'shop', G, false, vis[reviveRows.length - 1]);
  }

  bt.needsUpdate = true;
}

// ---- First-person camera state ----
let yaw = 0;
let pitch = 0;
let bobPhase = 0;
let bob = 0;
let jumpY = 0;
let jumpVY = 0;
let jumpId = 0;        // increments each time a jump starts — triggers anim in scene3d
let jumpMoveFwd  = 0;  // moveFwd captured at liftoff (not updated until next jump)
let jumpMoveSide = 0;  // moveSide captured at liftoff
let sprinting = false;
let walking   = false;
let fireId    = 0;
let moveFwd  = 0;  // -1=back, 0=still, +1=fwd (relative to facing)
let moveSide = 0;  // -1=left, 0=still, +1=right (relative to facing)
const JUMP_SPEED = 5.5;
const GRAVITY    = 18;
const MOUSE_SENS = 0.0022;
// While aiming down sights the FOV narrows, so the same mouse delta rotates
// the camera across a larger fraction of the visible view — it feels loose /
// twitchy (especially in TP, which drops to 45° FOV). Scale sensitivity down
// while ADS is held to keep the on-screen angular speed roughly consistent.
const ADS_SENS_SCALE = 0.45;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
let pointerLocked = false;

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
canvas.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const sens = MOUSE_SENS * (scene3d?.isAds?.() ? ADS_SENS_SCALE : 1);
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  if (pitch >  PITCH_LIMIT) pitch =  PITCH_LIMIT;
  if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
});
function requestLockIfAllowed() {
  if (document.activeElement && document.activeElement.id === 'chat-input') return;
  if (document.pointerLockElement === canvas) return;
  const p = canvas.requestPointerLock?.();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}
// Intercept Escape in capture phase: call exitPointerLock() ourselves so the
// browser treats it as a programmatic release (no re-lock cooldown).
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
  // DEV: F8 replays the Gantz transfer scan on the local player (Stage 1).
  //      Shift+F8 plays the dematerialize (top-down) variant.
  if (e.key === 'F8') {
    const type = e.shiftKey ? 'dematerialize' : 'materialize';
    // Lobby / briefing: beams emit from a single point on the Gantz ball's
    // surface facing the scan line. Mission / elsewhere: straight-down overhead point.
    const opts = { type };
    if (session.phase === Phase.LOBBY || session.phase === Phase.BRIEFING) {
      opts.sourceBall = { x: GANTZ_BALL.x, y: 1.2, z: GANTZ_BALL.y, r: GANTZ_BALL.radius };
    } else {
      opts.source = { x: player.x, y: 8, z: player.y };
    }
    scene3d.startTransferScan?.('__player__', opts);
    audio.play(SFX_SCAN, 0.7);
    console.log('[transferScan] F8', type, opts);
  }
}, true);
// Re-request lock on canvas click — catches refocus clicks that some browsers
// swallow at the OS level without dispatching mousedown to JS.
canvas.addEventListener('click', () => {
  requestLockIfAllowed();
});

// ── DEBUG: Gantz open toggle ───────────────────────────────────────────────
{
  const btn = document.getElementById('debug-gantz-open');
  if (btn) {
    btn.addEventListener('click', () => {
      _debugGantzForceOpen = !_debugGantzForceOpen;
      btn.textContent = _debugGantzForceOpen ? '⬤ Close Gantz' : '⬤ Open Gantz';
      btn.classList.toggle('active', _debugGantzForceOpen);
    });
  }
}

const incoming = (window.Portal?.readPortalParams?.()) || {
  username: `hunter-${Math.floor(Math.random() * 9999)}`,
  color: PLAYER_COLOR,
  speed: 5,
};
// Pre-fill saved name for returning players (new players will set it via name prompt)
{ const _sn = localStorage.getItem('gantz:name'); if (_sn) incoming.username = _sn; }
document.getElementById('username').textContent = incoming.username;

const phase = makePhaseMachine(Phase.LOBBY);
document.getElementById('phase').textContent = phase.get();
phase.onChange(p => { document.getElementById('phase').textContent = p; });

const world = makeWorld();
world.phase = phase.get();
world.seed = Math.floor(Math.random() * 0xffffffff);
world.rng = makeRng(world.seed);
world.lobbyDisarmed = true;
const wanderRng = makeRng(world.seed ^ 0xbeef);

const player = {
  id: 'local',
  kind: 'player',
  spec: generateHumanSpec(incoming.username),
  x: 0, y: 4,
  facing: -Math.PI / 2,
  walkPhase: 0,
  radius: 0.35,
  speed: incoming.speed || 5,
  hp: 100,
  alive: true,
  suit: 'basic',
  username: incoming.username,
  color: PLAYER_COLOR,
  points: 0,
  ready: false,
  lastActivityAt: performance.now(),
  afkReady: false,
  loadout: baseLoadout(),
  activeSlot: 0,
  civiliansKilled: 0,
};
world.localPlayerId = player.id;

const props = buildLobbyProps();
const lobbyWalls = buildLobbyWalls();
const gantzCol = getGantzBallCollider();

// Gantz panel colliders — mutable AABBs updated each tick from _gantzOpenProgress.
// Tier is 'decorative' (ignored) while closed; switched to 'hard' once panels move.
// 2D coords: 3D X→2D X,  3D -Z→2D -Y  (ball at 2D x=0 y=-4).
const _PANEL_SLIDE = 2.2;  // must match scene3d SLIDE constant
const gantzPanelLeft  = { kind: 'aabb', x: GANTZ_BALL.x, y: GANTZ_BALL.y, w: 0.28, h: 1.40, tier: 'decorative' };
const gantzPanelRight = { kind: 'aabb', x: GANTZ_BALL.x, y: GANTZ_BALL.y, w: 0.28, h: 1.40, tier: 'decorative' };
const gantzPanelBack  = { kind: 'aabb', x: GANTZ_BALL.x, y: GANTZ_BALL.y, w: 1.40, h: 0.28, tier: 'decorative' };

// Rod-pair + slab colliders for each panel — thin AABBs that stretch from the
// sphere surface to the panel face as the ball opens.
// Exit-radius insets match factories.js rod geometry (r = exitRadius − 0.08):
//   Upper rods  (y3D=0.10, lat=0.40):  sqrt(1.44−0.01−0.16) − 0.08 ≈ 1.047
//   Slab corners (y3D=−0.72, lat=0.40): sqrt(1.44−0.52−0.16) − 0.08 ≈ 0.793
const _R_ROD = 1.047;  // rod   sphere-exit inset (world units along slide axis)
const _R_SLB = 0.793;  // slab  sphere-exit inset
const _ROD_T = 0.20;   // rod AABB lateral thickness (rod diameter + player-radius padding)
const _SLB_L = 0.90;   // slab AABB lateral span    (SLAB_W + player-radius padding)
// Left panel (slides −X): lateral axis = 2D Y
const gantzRodLeftA  = { kind: 'aabb', x: 0, y: GANTZ_BALL.y - 0.40, w: 0.01, h: _ROD_T, tier: 'decorative' };
const gantzRodLeftB  = { kind: 'aabb', x: 0, y: GANTZ_BALL.y + 0.40, w: 0.01, h: _ROD_T, tier: 'decorative' };
const gantzSlabLeft  = { kind: 'aabb', x: 0, y: GANTZ_BALL.y,        w: 0.01, h: _SLB_L, tier: 'decorative' };
// Right panel (slides +X): lateral axis = 2D Y
const gantzRodRightA = { kind: 'aabb', x: 0, y: GANTZ_BALL.y - 0.40, w: 0.01, h: _ROD_T, tier: 'decorative' };
const gantzRodRightB = { kind: 'aabb', x: 0, y: GANTZ_BALL.y + 0.40, w: 0.01, h: _ROD_T, tier: 'decorative' };
const gantzSlabRight = { kind: 'aabb', x: 0, y: GANTZ_BALL.y,        w: 0.01, h: _SLB_L, tier: 'decorative' };
// Back panel (slides −Y in 2D): lateral axis = 2D X
const gantzRodBackA  = { kind: 'aabb', x: GANTZ_BALL.x - 0.40, y: 0, w: _ROD_T, h: 0.01, tier: 'decorative' };
const gantzRodBackB  = { kind: 'aabb', x: GANTZ_BALL.x + 0.40, y: 0, w: _ROD_T, h: 0.01, tier: 'decorative' };
const gantzSlabBack  = { kind: 'aabb', x: GANTZ_BALL.x,        y: 0, w: _SLB_L, h: 0.01, tier: 'decorative' };

const lobbyColliders = [
  ...lobbyWalls,
  ...props.map(p => p.collider).filter(Boolean),
  gantzCol,
  gantzPanelLeft, gantzPanelRight, gantzPanelBack,
  gantzRodLeftA,  gantzRodLeftB,  gantzSlabLeft,
  gantzRodRightA, gantzRodRightB, gantzSlabRight,
  gantzRodBackA,  gantzRodBackB,  gantzSlabBack,
  ..._doorColliders,
];
const missionBoundaryWalls = buildMissionWalls();

let missionMap = null;
let missionProps = [];
let civilians = [];
let aliens = [];
let _bonusBossSpawned = false;
let _missionClearAt = -1; // host-side timestamp when last alien died; end mission 3s later
let tracers = []; // {x1,y1,x2,y2,color,age,ttl}
let activeColliders = lobbyColliders;
let lastAliensBroadcast = 0;
let lastCivsBroadcast = 0;
const CIVS_BROADCAST_MS = 100;
let fireCooldown = 0;

// ---- Session state (host-authoritative) ----
const session = {
  phase: Phase.LOBBY,
  missionIndex: 0,
  missionSeed: 0,
  lobbySeed: (Math.random() * 0xffffffff) >>> 0,  // seeded once; synced so all peers share same sky/weather
  missionEndsAt: 0,
  briefingEndsAt: 0,
  debriefEndsAt: 0,
  readyCountdownEnd: -1,  // host timestamp when countdown expires; -1 = not running
  participants: null,      // null = all players; array of colors when set
  missionResult: null,   // 'wiped' | 'cleared' | null
  targets: [],
  // Stage 3b: transfer-scan gate. When non-null, the host is holding the next
  // phase transition for `scanEndsAt - now` milliseconds so every participant's
  // dematerialize scan finishes visually before they teleport. Only set by host.
  //   'pre-mission'  — held during BRIEFING end, before MISSION teleport
  //   'post-mission' — held during MISSION end, before DEBRIEF teleport
  scanPhase: null,
  scanEndsAt: -1,
  version: 0,
};
// Last scanPhase we already reacted to locally — guards against re-firing the
// dematerialize every tick while the gate is still open.
let _appliedScanPhase = null;
// The "Gantz opening" final sequence is 20s total: a 17.5s clock-only wait
// (scanPhase = 'pre-mission-wait') followed by a 2.5s dematerialize scan
// (scanPhase = 'pre-mission'). The scan's transferScan visual only fires
// during the last 2.5s so its DEFAULT_DURATION (2.5) matches PRE_TELEPORT_SCAN_MS.
const PRE_TELEPORT_WAIT_MS = 17500;
const PRE_TELEPORT_SCAN_MS = 2500;

// Per-peer `scan.t` of the most recent scan we've already relayed to scene3d.
// Guards against re-firing the same scan on every 15Hz pose for the duration
// it stays in the pose payload.
const _remoteScansFired = new Map();

// Per-peer bookkeeping so a brand-new remote's mesh isn't revealed before
// their transfer scan reaches us.
//   _remoteFirstSeen: ms timestamp of the first pose that had coords.
//   _remoteSawScan:   peers whose pose has ever carried a scan descriptor.
// A fresh peer is withheld from scene3d's `state.remotes` list until either
// we see a scan on them OR REMOTE_SPAWN_GRACE_MS elapses (fallback for peers
// whose scan already expired by the time we connect).
const _remoteFirstSeen = new Map();
const _remoteSawScan   = new Set();
const REMOTE_SPAWN_GRACE_MS = 3500;
let lastSessionBroadcast = 0;

// ---- Remote spec cache ----
const remoteSpecs = new Map();
function getRemoteSpec(peerId, seed) {
  let cached = remoteSpecs.get(peerId);
  if (!cached || cached.seed !== seed) {
    cached = generateHumanSpec(seed || peerId);
    remoteSpecs.set(peerId, cached);
  }
  return cached;
}

// ---- UI wires ----
const chat = createChatUI({
  onSend: (text) => net.sendChat(text, player.username, player.color),
  onSuspendInput: (s) => setInputSuspended(s),
});

function getMenuState() {
  const remotes = [];
  const deadPlayers = [];
  for (const [peerId, p] of net.peers) {
    if (p.username) {
      remotes.push({
        username: p.username,
        points: p.points || 0,
        ready: !!p.ready,
        lifetimePoints: p.lifetimePoints || 0,
      });
      if (p.alive === false) {
        deadPlayers.push({ peerId, username: p.username });
      }
    }
  }
  return {
    localName: player.username,
    localPoints: player.points,
    localReady: player.ready,
    localAfk: player.afkReady,
    localLifetimePoints: stats.lifetimePoints,
    remotes,
    deadPlayers,
  };
}

const shopRng = makeRng(Date.now());

let stats = getStats();
let missionPointsEarned = 0;
let missionBossKilled = false;
let missionCivilianKills = 0;
let _menuClosedAt = -Infinity;
let _menuFadeOutAt = -1;
let _skipNextMenuFadeOut = false;
const MENU_FADE_OUT_MS = 260;
const menu = createGantzMenu({
  getGantzTalking: () => (_introStartTime !== -1 && !_introDone) || (_namePromptPhase !== 'idle' && !_namePromptDone) || (!_gantzTalkDone && !!_gantzTalkLines) || (!_gantzExitDone && _gantzExitStart !== -1),
  onOpen: () => { _menuFadeOutAt = -1; },
  onClose: () => {
    _menuClosedAt = performance.now();
    if (_skipNextExitLines) {
      _skipNextExitLines = false;
      _gantzExitDone = true;
      return;
    }
    _gantzExitLines = _gantzPickLines(_GANTZ_EXIT_LINES);
    _gantzExitStart = performance.now();
    _gantzExitDone = false;
  },
  onBuyResult: (result) => {
    const pool = result.ok ? _GANTZ_BUY_LINES : _GANTZ_NO_POINTS_LINES;
    _gantzTalkLines = _gantzPickLines(pool);
    _gantzTalkStart = performance.now();
    _gantzTalkDone = false;
    _buyResponsePending = true;
    _skipNextExitLines = true;
    _skipNextMenuFadeOut = true; // suppress main-menu flash when closing for buy result
    menu.closeMenu();
  },
  onReadyToggle: () => {
    if (session.phase === Phase.MISSION) return;
    player.ready = !player.ready;
    if (!player.ready) player.afkReady = false;
    // Resend a couple times in case the first UDP pose packet drops — this
    // prevents the host from missing the ready toggle and ignoring the click.
    net.broadcastPose();
    setTimeout(() => net.broadcastPose(), 80);
    setTimeout(() => net.broadcastPose(), 240);
    if (player.ready && menu.isOpen()) {
      _skipNextExitLines = true;
      menu.closeMenu();
    }
  },
  onShopBuy: (key, cost, targetId) => {
    if (session.phase !== Phase.LOBBY && session.phase !== Phase.DEBRIEF) {
      return { ok: false, msg: 'Shop is locked during briefing and mission.' };
    }
    if (player.points < cost) {
      return { ok: false, msg: 'Not Enough Points.' };
    }
    player.points -= cost;

    if (key === 'weapon_common' || key === 'weapon_rare') {
      const tier = key === 'weapon_rare' ? 'rare' : 'common';
      const wid = rollRandomWeapon(shopRng, tier);
      const w = WEAPONS[wid];
      const slotKey = player.loadout.weapon2 ? 'weapon1' : (player.loadout.weapon1 === 'xgun' ? 'weapon2' : 'weapon1');
      const prev = player.loadout[slotKey];
      player.loadout[slotKey] = wid;
      updateWeaponHUD();
      return { ok: true, msg: `Gantz gives you: ${w.name} — ${w.hint}${prev && prev !== 'xgun' ? ` (replaced ${WEAPONS[prev]?.name})` : ''}` };
    }
    if (key === 'suit') {
      const current = player.loadout.suit || 'basic';
      const next = rollSuitUpgrade(shopRng, current);
      player.loadout.suit = next;
      player.suit = next;
      player.hp = SUITS[next].maxHp;
      updateWeaponHUD();
      if (next === current) return { ok: true, msg: `The suit hums but stays the same. (${SUITS[next].name})` };
      return { ok: true, msg: `Suit upgraded to ${SUITS[next].name} — max HP ${SUITS[next].maxHp}` };
    }
    if (key === 'revive') {
      if (!targetId) {
        return { ok: false, msg: 'Select a hunter from the list to revive.' };
      }
      const targetPeer = net.peers.get(targetId);
      const targetName = targetPeer?.username || 'Unknown';
      if (!targetPeer || targetPeer.alive !== false) {
        return { ok: false, msg: `${targetName} is still among the living.` };
      }
      if (!session.pendingRevives) session.pendingRevives = [];
      session.pendingRevives.push(targetId);
      broadcastSession();
      return { ok: true, msg: `${targetName} will be restored for the next mission.` };
    }
    return { ok: false, msg: 'Unknown purchase.' };
  },
  getState: getMenuState,
  getPhase: () => session.phase,
});

// ---- Network ----
const net = createNetwork({
  appId: APP_ID,
  roomId: ROOM_ID,
  getLocalPose: () => ({
    x: player.x,
    y: player.y,
    facing: player.facing,
    aimYaw: player.aimYaw ?? player.facing,
    aimPitch: player.aimPitch ?? 0,
    walkPhase: player.walkPhase,
    alive: player.alive,
    specSeed: player.spec.seed,
    username: player.username,
    color: player.color,
    points: player.points,
    ready: player.ready,
    // Authoritative per-peer "zone" flag: true iff this player is physically
    // running the mission, false iff they're in the lobby room. The rendering
    // cull uses this to hide cross-zone peers WITHOUT depending on
    // session.phase (which can lag during host migration or phase-transition
    // races and cause lobby clients to see mission players). See
    // project_gantz.md: "Cross-zone visibility cull".
    inMission: session.phase === Phase.MISSION && localIsParticipant(),
    lifetimePoints: stats.lifetimePoints,
    jumpY: jumpY,
    jumpId,
    jumpMoveFwd,
    jumpMoveSide,
    sprinting: sprinting,
    walking,
    // Broadcast ADS so remote clients can force the walk-pace animation on
    // this peer's 3rd-person model while we're aiming down sights.
    ads: scene3d.isAds?.() === true,
    fireId,
    moveFwd,
    moveSide,
    doorStates: _doorOpen.map(o => o ? 1 : 0),
    // Drop the descriptor after scan duration has elapsed so we aren't
    // re-broadcasting stale state forever on 15Hz pose ticks.
    scan: (_lastLocalScan && Date.now() - _lastLocalScan.t < SCAN_BROADCAST_TTL_MS) ? _lastLocalScan : null,
  }),
});

net.onStatus(s => {
  if (s === 'connected') { broadcastSession(); }
});
// Track which peer IDs have already been announced in chat.
// We wait for the first pose (which carries the username) rather than announcing
// on raw join, because the username isn't known until the first pose arrives.
const _announcedPeers = new Set();

net.onPeerJoin(() => {
  if (net.isHost) broadcastSession();
});

net.onSession((incoming) => {
  if (!incoming || typeof incoming.version !== 'number') return;
  if (net.isHost) return;
  if (incoming.version < session.version) return;
  const prevPhase = session.phase;
  Object.assign(session, incoming);
  // If joining mid-countdown, mid-briefing, or mid-mission, skip the Gantz intro and
  // name-entry sequence so the player can immediately join the queue or mission.
  const missionActive = session.phase === Phase.BRIEFING ||
                        session.phase === Phase.MISSION  ||
                        session.readyCountdownEnd >= 0;
  if (missionActive && (!_introDone || !_namePromptDone)) {
    _stopTypeSound();
    _introDone     = true;
    _namePromptDone = true;
  }
  if (session.phase !== prevPhase) {
    enterPhase(session.phase);
  } else {
    // Phase unchanged but session updated (e.g. countdown start/cancel) — refresh overlay
    refreshPhaseOverlay();
  }
});

// --- Alien sync (host-authoritative) ---
function broadcastAliens() {
  if (!net.isHost) return;
  const payload = aliens.map(a => ({
    id: a.id, x: a.x, y: a.y, facing: a.facing, walkPhase: a.walkPhase,
    hp: a.hp, alive: a.alive, state: a.state,
    marked: a.marked, markedAt: a.markedAt, markTimeMs: a._markTimeMs || 0,
    attackCooldown: a.attackCooldown || 0,
    archetype: a.archetype, specSeed: a.spec.seed,
  }));
  net.sendAliens(payload);
  lastAliensBroadcast = performance.now();
}

net.onAliens((incoming) => {
  if (net.isHost) return;
  if (!Array.isArray(incoming)) return;
  // Hydrate remote aliens: create or update local mirror
  const existing = new Map(aliens.map(a => [a.id, a]));
  const next = [];
  for (const d of incoming) {
    let a = existing.get(d.id);
    if (!a) {
      const spec = generateAlienSpec(d.specSeed || d.id, d.archetype || 'patroller');
      a = {
        id: d.id, kind: 'alien', archetype: d.archetype || 'patroller',
        spec, radius: (ARCHETYPES[d.archetype || 'patroller']).radius,
        markFlash: 0,
      };
      if (d.archetype === 'boss' && session.phase === Phase.MISSION) {
        _sphereSay('bossAppearance', { forceShow: true, dwellMs: 4200, rateLimitMs: 1500 });
      }
    }
    a.x = d.x; a.y = d.y; a.facing = d.facing; a.walkPhase = d.walkPhase;
    a.hp = d.hp; a.alive = d.alive; a.state = d.state;
    const prevCD = a.attackCooldown || 0;
    a.attackCooldown = d.attackCooldown || 0;
    a._prevAttackCooldown = prevCD;
    a.marked = d.marked; a.markedAt = d.markedAt;
    if (d.markTimeMs) a._markTimeMs = d.markTimeMs;
    next.push(a);
  }
  aliens = next;
});

// --- Civilian sync (host-authoritative) ---
// Civilians were previously simulated independently on every peer from a shared
// seed. That drifts in practice (peers join/tick at different times, shared rng
// state drains unevenly), so peers would see civilians in different places.
// Now host is authoritative: it runs planCivilian + broadcasts, non-host mirrors.
function broadcastCivs() {
  if (!net.isHost) return;
  if (session.phase !== Phase.MISSION) return;
  const payload = civilians.map(c => ({
    id: c.id, x: c.x, y: c.y, facing: c.facing, walkPhase: c.walkPhase,
    vx: c.vx || 0, vy: c.vy || 0, alive: c.alive !== false,
    marked: !!c.marked, markedAt: c.markedAt || 0, markTimeMs: c._markTimeMs || 0,
    behavior: c.behavior, kind: 'civilian',
  }));
  net.sendCivs(payload);
  lastCivsBroadcast = performance.now();
}

net.onCivs((incoming) => {
  if (net.isHost) return;
  if (!Array.isArray(incoming)) return;
  // Only mirror civilians while we're physically in the mission. Lobby peers
  // keep civilians=[] so the cross-zone cull / collider list stays clean.
  if (!(session.phase === Phase.MISSION && localIsParticipant())) return;
  // Civilian specs/ids/behaviors are seed-derived (generateMissionMap), so
  // every participant already has matching entries. We just overwrite the
  // volatile fields in place so visuals + animations match the host.
  const byId = new Map(civilians.map(c => [c.id, c]));
  for (const d of incoming) {
    const c = byId.get(d.id);
    if (!c) continue; // entry not yet locally generated — next broadcast will catch it
    c.x = d.x; c.y = d.y; c.facing = d.facing;
    c.walkPhase = d.walkPhase;
    c.vx = d.vx; c.vy = d.vy;
    c.alive = d.alive;
    c.marked = !!d.marked;
    c.markedAt = d.markedAt || 0;
    if (d.markTimeMs) c._markTimeMs = d.markTimeMs;
  }
});

// --- Fire / hit / kill ---
net.onShot((msg, peerId) => {
  // Tracers disabled — will be replaced with a new shooting effect later.
  // Play the shot sound positionally so other hunters' gunfire comes through
  // attenuated + stereo-panned based on where the shooter is relative to us.
  // Suppress if the shooter is in a different zone (mission vs lobby) — a
  // lobby spectator shouldn't hear gunfire from a mission in progress, and
  // vice versa.
  if (!sameZoneAsLocal(peerId)) return;
  if (typeof msg?.x1 === 'number' && typeof msg?.y1 === 'number') {
    audio.playAt(SFX_GUN_SHOOT, msg.x1, msg.y1, { volume: 0.6 });
    if (typeof msg.x2 === 'number' && typeof msg.y2 === 'number') {
      // Try to spawn the bullet from the peer's actual hand-gun position in
      // our scene so their shots read as coming out of their weapon. If the
      // peer's character hasn't been built yet (or no gun is attached), we
      // fall back to their 2D position at muzzle height.
      const muz = scene3d.getRemoteMuzzleWorldPosition?.(peerId);
      const payload = { x1: msg.x1, y1: msg.y1, x2: msg.x2, y2: msg.y2, color: msg.color };
      if (muz) {
        payload.ox = muz.x; payload.oy = muz.y; payload.oz = muz.z;
      }
      // Shooter included a 3D endpoint — pass it through so the bullet flies
      // along the actual camera ray (including pitch) instead of a flat
      // horizontal path. Without this, all remote shots look like ground-
      // level tracers regardless of whether the shooter was aiming up / down.
      if (msg.ex != null) { payload.ex = msg.ex; payload.ey = msg.ey; payload.ez = msg.ez; }
      emitTracer(payload);
    }
  }
});

// Returns true iff the given peer is in the same zone (lobby or mission) as
// the local player. Uses the same layered-signal logic as the render cull
// (see "Cross-zone visibility cull" in project_gantz.md). Runs every phase
// because the local client's phase can lag behind peers during transitions.
function sameZoneAsLocal(peerId) {
  const peer = net.peers.get(peerId);
  if (!peer) return false;
  const localInMission = session.phase === Phase.MISSION && localIsParticipant();
  const peerInMission =
    (peer.inMission === true)
    || (session.phase === Phase.MISSION && (session.participants?.includes(peerId) ?? false))
    || (session.phase === Phase.MISSION && !!peer.ready);
  return localInMission === peerInMission;
}

net.onHit((msg) => {
  if (!net.isHost) return;
  if (msg.kind === 'alien') {
    const a = aliens.find(a => a.id === msg.id && a.alive);
    if (!a) return;
    a.marked = true;
    a.markedAt = performance.now();
    a._killerId = msg.shooterId;
    a._markTimeMs = msg.markMs || 1500;
    a._pointsReward = ALIEN_KILL_POINTS_DEFAULT;
    broadcastAliens();
  } else if (msg.kind === 'civilian') {
    // X-family weapons fuse the target — host marks, ticks, detonates via
    // tickMarkedCivs(). Penalty is applied at detonation, not at mark.
    const c = civilians.find(c => c.id === msg.id);
    if (c && c.alive !== false && !c.marked) {
      c.marked = true;
      c.markedAt = performance.now();
      c._markTimeMs = msg.markMs || 1500;
      c._killerId = msg.shooterId;
      c.vx = 0; c.vy = 0; // stop wandering once fused
      broadcastCivs();
    }
  }
  // human friendly fire could be added here
});

net.onKill((msg) => {
  if (msg.kind === 'alienKilled') {
    // Spawn gib burst at the authoritative death position — but only for
    // peers that are actually in the mission. A lobby spectator should never
    // see blood spray from the ongoing hunt (nor hear it — the kill SFX is
    // gated the same way via localIsParticipant / phase checks below).
    const dead = aliens.find(a => a.id === msg.alienId);
    const inMissionLocally = session.phase === Phase.MISSION && localIsParticipant();
    if (dead && inMissionLocally && scene3d.spawnGibs) {
      scene3d.spawnGibs(dead.x, dead.y, {
        power: dead.archetype === 'boss' ? 1.7 : dead.archetype === 'brute' ? 1.3 : 1,
        count: dead.archetype === 'boss' ? 48 : dead.archetype === 'brute' ? 36 : 28,
        centerY: (dead.radius || 0.55) * 1.8,
      });
    }
    // Everyone: update points if you are the killer
    if (msg.killerId === net.selfId) {
      player.points += msg.points || 0;
      _sphereSay('alienKilledByYou', { dwellMs: 3200, rateLimitMs: 4500 });
    } else {
      const peer = net.peers.get(msg.killerId);
      if (peer) peer.points = (peer.points || 0) + (msg.points || 0); // keep debrief accurate without waiting for pose
      const name = (peer && peer.username) || 'hunter';
      if (session.phase === Phase.MISSION && localIsParticipant()) {
        _sphereSay('alienKilledByOther', { dwellMs: 3200, rateLimitMs: 6000, name });
      }
    }
  } else if (msg.kind === 'civilianPenalty') {
    if (msg.shooterId === net.selfId) {
      player.points = Math.max(0, player.points - CIVILIAN_PENALTY);
      player.civiliansKilled += 1;
      _sphereSay('civKilledByYou', { dwellMs: 3800, rateLimitMs: 3500, forceShow: true });
    } else {
      const peer = net.peers.get(msg.shooterId);
      if (peer) peer.points = Math.max(0, (peer.points || 0) - CIVILIAN_PENALTY);
      if (session.phase === Phase.MISSION && localIsParticipant()) {
        const name = (peer && peer.username) || 'hunter';
        _sphereSay('civKilledByOther', { dwellMs: 3200, rateLimitMs: 5000, name });
      }
    }
  } else if (msg.kind === 'civilianDeath') {
    // Mirror the civilian's death locally so non-shooters see the ragdoll.
    const c = civilians.find(c => c.id === msg.id);
    if (c) c.alive = false;
  }
  updateWeaponHUD();
});

function broadcastSession() {
  // Strip host-private keys (underscore prefix) so peers don't see internals.
  const out = {};
  for (const k of Object.keys(session)) if (!k.startsWith('_')) out[k] = session[k];
  net.sendSession(out);
  lastSessionBroadcast = Date.now();
}

// ---- Phase transition effects (local to this peer) ----

// Stage 3a: transfer-scan triggers. Materialize = beams condense the body
// into place; dematerialize = body scans away. Source depends on where the
// player currently is — Gantz ball (lobby/briefing) or overhead satellite
// (mission). Helper centralises the choice so every call site stays one-line.
//
// Stage 3c: when a scan fires locally we also stash a compact descriptor on
// `_lastLocalScan` so the next pose broadcast carries it. Remote peers read
// the field and fire the same scan on this player's 3rd-person mesh.
//
// The broadcast lifetime (SCAN_BROADCAST_TTL_MS) is intentionally much longer
// than the 2.5s local scan animation: it covers the window during which a
// late-joining peer (Trystero/WebRTC handshake can easily take 5-15s) must
// still see the scan in our pose field so they fire it on their end. The
// receiver's `_remoteScansFired` map uses scan.t as an idempotency key so a
// long-lived field fires at most once per peer per scan.
let _lastLocalScan = null;
const SCAN_BROADCAST_TTL_MS = 20000;

function _triggerTransferScan(type, opts = {}) {
  const scanOpts = { type, ...opts };
  if (!scanOpts.source && !scanOpts.sourceBall) {
    const inLobby = session.phase === Phase.LOBBY
                 || session.phase === Phase.BRIEFING
                 || session.phase === Phase.DEBRIEF;
    if (inLobby) {
      scanOpts.sourceBall = { x: GANTZ_BALL.x, y: 1.2, z: GANTZ_BALL.y, r: GANTZ_BALL.radius };
    } else {
      scanOpts.source = { x: player.x, y: 8, z: player.y };
    }
  }
  scene3d.startTransferScan?.('__player__', scanOpts);
  audio.play(SFX_SCAN, 0.7);

  // Compact pose-sized descriptor. `k: 'b'` = ball source (sx,sy,sz,sr).
  // `k: 'p'` = point source (sx,sy,sz). Date.now() is shared across peers so
  // remote clients can treat it as the idempotency key.
  const s = scanOpts.sourceBall || scanOpts.source;
  _lastLocalScan = scanOpts.sourceBall
    ? { t: Date.now(), type, k: 'b', sx: s.x, sy: s.y, sz: s.z, sr: s.r }
    : { t: Date.now(), type, k: 'p', sx: s.x, sy: s.y, sz: s.z };
  // Push immediately instead of waiting for the next 15Hz pose tick.
  net.broadcastPose?.();
}

function teleportToLobby() {
  player.x = 0; player.y = 4;
  yaw = 0; pitch = 0;           // face toward Gantz ball at (0, -4)
  player.facing = -Math.PI / 2; // kept in sync: atan2(-cos(0), -sin(0)) = -π/2
  player.walkPhase = 0;
}

function teleportToMission() {
  const sp = missionMap?.spawnPoint || { x: 0, y: MISSION_BOUNDS.minY + 2, facing: Math.PI / 2 };
  const ps = missionSpawn(sp, 0);
  player.x = ps.x; player.y = ps.y; player.facing = ps.facing;
  player.walkPhase = 0;
  // Align first-person camera to face into the level.
  // Derived from update loop: facing = atan2(-cos(yaw), -sin(yaw)), so inverse is:
  yaw   = Math.atan2(-Math.cos(ps.facing), -Math.sin(ps.facing));
  pitch = 0;
}

let _wasInMission = false; // true only if local player was teleported into the mission

function enterPhase(newPhase) {
  if (newPhase === Phase.MISSION) {
    missionMap = generateMissionMap(session.missionSeed >>> 0, MISSION_BOUNDS);
    missionMap._seed = session.missionSeed; // stamp seed so scene3d knows when to rebuild the room
    missionProps = missionMap.props;
    civilians = missionMap.civilians;
    missionPointsEarned = 0;
    missionBossKilled = false;
    missionCivilianKills = 0;
    _missionStartPts = new Map();
    _missionStartPts.set('local', player.points);
    for (const [id, p] of net.peers) _missionStartPts.set(id, p.points || 0);

    _wasInMission = localIsParticipant();
    if (_wasInMission) {
      activeColliders = [
        ...missionBoundaryWalls,
        ...missionProps.map(p => p.collider).filter(Boolean),
        ...missionMap.buildings.map(b => ({
          kind: 'aabb', x: b.x, y: b.y, w: b.w, h: b.h, tier: 'hard',
        })),
      ];
      if (net.isHost) {
        const comp = session.composition || ['patroller'];
        aliens = spawnFromComposition(session.missionSeed, MISSION_BOUNDS, comp);
        _bonusBossSpawned = false;
        _missionClearAt = -1;
        broadcastAliens();
        broadcastCivs();
      } else {
        aliens = [];
      }
      tracers = [];
      const suit = SUITS[player.loadout?.suit || 'basic'];
      player.hp = suit.maxHp;
      player.speed = (incoming.speed || 5) * suit.speedMul;
      player.alive = true;
      player.civiliansKilled = 0;
      teleportToMission();
      // Materialize the hunter into the field from an overhead satellite beam.
      // Defer one frame so the mission-map build spike lands before the scan starts,
      // otherwise the first scan frame stalls mid-beam and looks like a stutter.
      requestAnimationFrame(() => _triggerTransferScan('materialize', { source: { x: player.x, y: 8, z: player.y } }));
      // Sphere greets the squad as soon as they materialize in the field.
      _sphereSay('missionEnter', { dwellMs: 4500, rateLimitMs: 0, forceShow: true });
      gantzHudAmbient('FIELD ACTIVE · X-GUN CALIBRATED');
    } else {
      // Non-participant: stay in lobby, just track mission state passively.
      // Host still spawns + broadcasts aliens so participants receive them,
      // but the non-participant player sees the lobby room and can't interact with mission.
      if (net.isHost) {
        const comp = session.composition || ['patroller'];
        aliens = spawnFromComposition(session.missionSeed, MISSION_BOUNDS, comp);
        _bonusBossSpawned = false;
        _missionClearAt = -1;
        broadcastAliens();
        // Non-participant host must STILL simulate + broadcast civilians so
        // participants (on other peers) see them. Civs live in the mission
        // world, not the lobby — the local lobby render filters them out via
        // `localInMission ? civilians : []` in getRenderState.
        broadcastCivs();
      } else {
        aliens = [];
        civilians = []; // Non-host non-participant: mission world not locally visible
      }
      tracers = [];
      // Keep lobby colliders and position — player stays where they are
      activeColliders = lobbyColliders;
    }
  } else {
    if (_wasInMission && (phase.get() === Phase.MISSION || phase.get() === Phase.BRIEFING)) {
      teleportToLobby();
      // Rematerialize in the lobby from the Gantz ball's surface.
      // Defer one frame so any teardown/setup spike finishes before the scan begins.
      requestAnimationFrame(() => _triggerTransferScan('materialize'));
    }
    _wasInMission = false;
    missionMap = null;
    missionProps = [];
    civilians = [];
    aliens = [];
    tracers = [];
    activeColliders = lobbyColliders;
  }
  if (newPhase === Phase.LOBBY || newPhase === Phase.DEBRIEF) {
    player.alive = true;   // revive for lobby/debrief so movement works after dying in mission
    player.ready = false;
    player.afkReady = false;
  }
  if (newPhase === Phase.DEBRIEF) {
    // On a wipe (mission failed or timer ran out), non-host peers must also
    // reset their own points + loadout locally — the host zeros its own copy
    // in hostEndMission but can't reach into peer state. Mirror that here.
    if (!net.isHost && session.missionResult === 'wiped') {
      player.hp = 0;
      player.alive = false;
      player.points = 0;
      player.loadout = baseLoadout();
      player.activeSlot = 0;
    }
    _debriefRevealAt = -1;
    _debriefAllDoneAt = -1;
    _debriefDisplayDone = false;
    const localEarned = Math.max(0, player.points - (_missionStartPts.get('local') || 0));
    // Only include players who were mission participants (queued up before launch)
    const parts = session.participants; // array of peer IDs, or null = all
    _debriefPlayers = [];
    if (!parts || parts.includes(net.selfId)) {
      _debriefPlayers.push({ name: player.username, pts: localEarned, died: !player.alive,
        comment: _pickDebriefComment(localEarned, !player.alive) });
    }
    for (const [id, p] of net.peers) {
      if (!p.username) continue;
      if (parts && !parts.includes(id)) continue; // skip non-participants
      const earned = Math.max(0, (p.points || 0) - (_missionStartPts.get(id) || 0));
      const pDied = p.alive === false;
      _debriefPlayers.push({ name: p.username, pts: earned, died: pDied,
        comment: _pickDebriefComment(earned, pDied) });
    }
    // Highest scorer first so the MVP is always shown at the top.
    _debriefPlayers.sort((a, b) => b.pts - a.pts);
  }
  if (newPhase === Phase.BRIEFING) {
    _briefingRevealAt = -1;
    _briefingContentDoneAt = -1;
    _briefingSnappedTIdx = -1;
    _briefingIntroIdx = -1;
    _briefingCharIdx  = -1;
    _briefingFavIdx   = -1;
    _briefingHatesIdx = -1;
    _briefingHatesSlot = null;
    _gantzOpenProgress = 0;
  }
  if (newPhase === Phase.MISSION) {
    _gantzOpenProgress = 0; // ball will have fully closed before re-appearing in lobby
  }
  // Close the menu on phase change so input is never left suspended
  if (newPhase === Phase.BRIEFING || newPhase === Phase.MISSION) {
    if (menu.isOpen()) menu.closeMenu();
  }
  phase.set(newPhase);
  refreshPhaseOverlay();
  updateWeaponHUD();
  if (menu.isOpen()) menu.refresh();
}

// ---- Host authoritative transitions ----
function allHumansReady() {
  if (net.peers.size === 0) return false;
  if (!player.ready) return false;
  for (const p of net.peers.values()) if (!p.ready) return false;
  return true;
}

function localIsParticipant() {
  // player.ready is the authoritative local gate: set when the player joins the queue,
  // cleared on every LOBBY/DEBRIEF transition.  Avoids net.selfId race conditions
  // (selfId can be 'local-xxx' before Trystero connects).
  return !!player.ready;
}

function collectParticipants() {
  const list = [];
  if (player.ready) list.push(net.selfId);
  for (const [id, pr] of net.peers) if (pr.ready) list.push(id);
  return list;
}

const MODIFIERS = [
  { id: 'clear', label: 'Clear', weight: 1, tint: null },
];

function rollModifier(_seed) {
  return MODIFIERS[0];
}

function hostStartBriefing(nowMs) {
  session.readyCountdownEnd = -1;
  session.missionIndex += 1;
  session.missionSeed = (Math.random() * 0xffffffff) >>> 0;
  session.modifier = rollModifier(session.missionSeed);
  session.briefingEndsAt = nowMs + BRIEFING_MS;
  const comp = rollMissionComposition(session.missionSeed, session.missionIndex);
  session.composition = comp;
  session.bonusBossRolled = rollBonusBoss(session.missionSeed, session.missionIndex);
  session.alienCount = comp.length;
  // Group composition into target rows by archetype, each with a unique random name
  const counts = {};
  for (const t of comp) counts[t] = (counts[t] || 0) + 1;
  const archetypeList = Object.keys(counts);
  const drawnNames = pickAlienNames(session.missionSeed, archetypeList.length);
  session.targets = archetypeList.map((type, i) => ({
    name: drawnNames[i] ?? ARCHETYPES[type].name,
    count: counts[type],
    hint: ARCHETYPES[type].hint,
    archetype: type,
    specSeed: (session.missionSeed ^ (i * 0x9e3779b9)) >>> 0,
  }));
  session.missionResult = null;
  session.phase = Phase.BRIEFING;
  session.version += 1;
  enterPhase(Phase.BRIEFING);
  broadcastSession();
}

function hostPickMissionDuration() {
  return MISSION_BASE_MS + (session.alienCount || 3) * 10000;
}

function hostStartMission(nowMs) {
  // Re-collect participants right before the teleport so join/leave queue
  // actions taken during briefing apply to the actual mission roster.
  session.participants = collectParticipants();
  session.missionEndsAt = nowMs + hostPickMissionDuration();
  session.phase = Phase.MISSION;
  session.version += 1;
  _gantzMockeryNextAt = -1;  // reset so first line fires 20-40s in
  enterPhase(Phase.MISSION);
  broadcastSession();
}

function hostEndMission(nowMs, result = 'wiped') {
  session.missionResult = result;
  session.missionStats = {
    pointsEarned: missionPointsEarned,
    civilianKills: missionCivilianKills,
    bossKilled: missionBossKilled,
    playerDied: !player.alive,
  };
  session.debriefEndsAt = nowMs + DEBRIEF_MS;
  session.phase = Phase.DEBRIEF;
  session.version += 1;

  // Record stats + permadeath
  if (result === 'wiped') {
    stats = recordWipe();
    // Full wipe: reset everything, restart from mission 1
    session.missionIndex = 0;  // hostStartBriefing() will increment to 1
    player.points = 0;
    player.loadout = baseLoadout();
    player.activeSlot = 0;
  } else {
    stats = recordMissionResult({
      pointsEarned: missionPointsEarned,
      cleared: true,
      bossKilled: missionBossKilled,
      civilianKills: missionCivilianKills,
    });
  }

  enterPhase(Phase.DEBRIEF);
  broadcastSession();
}

// Stage 3b: open the post-mission scan gate. Stashes the intended result on
// `session._pendingResult` (stripped before broadcast to avoid polluting peers)
// and broadcasts the scan phase so participants fire their dematerialize.
function _hostOpenEndMissionGate(nowMs, result) {
  session.scanPhase = 'post-mission';
  session.scanEndsAt = nowMs + PRE_TELEPORT_SCAN_MS;
  session._pendingResult = result;
  session.version += 1;
  broadcastSession();
}

function hostReturnToLobby() {
  session.phase = Phase.LOBBY;
  session.readyCountdownEnd = -1;
  session.participants = null;
  session.version += 1;
  enterPhase(Phase.LOBBY);
  broadcastSession();
}

function hostTick(nowMs) {
  if (!net.isHost) return;

  const p = session.phase;
  if (p === Phase.LOBBY || p === Phase.DEBRIEF) {
    const anyReady = player.ready || [...net.peers.values()].some(pr => pr.ready);
    // Brief 500ms grace after becoming host to let pose exchange settle, then
    // always honor ready toggles. Previous 5000ms guard was silently swallowing
    // ready clicks right after host migration / initial connect.
    if (nowMs - hostSince > 500) {
      if (anyReady && session.readyCountdownEnd < 0) {
        session.readyCountdownEnd = nowMs + READY_COUNTDOWN_MS;
        session.version += 1;
        broadcastSession();
      } else if (!anyReady && session.readyCountdownEnd >= 0) {
        session.readyCountdownEnd = -1;
        session.version += 1;
        broadcastSession();
      } else if (session.readyCountdownEnd >= 0 && nowMs >= session.readyCountdownEnd) {
        session.participants = collectParticipants();
        session.readyCountdownEnd = -1;
        if (session.participants.length > 0) {
          hostStartBriefing(nowMs);
        } else {
          session.version += 1;
          broadcastSession();
        }
      }
    }
    if (session.phase === Phase.DEBRIEF && session.readyCountdownEnd < 0 && nowMs >= session.debriefEndsAt) {
      hostReturnToLobby(nowMs);
    }
  } else if (p === Phase.BRIEFING) {
    // If everyone has left the queue during briefing, cancel and return to lobby.
    // Once the scan gates have opened ('pre-mission-wait' or 'pre-mission')
    // it's too late to abort — the mission is committed.
    const anyReady = player.ready || [...net.peers.values()].some(pr => pr.ready);
    const scanArmed = session.scanPhase === 'pre-mission' || session.scanPhase === 'pre-mission-wait';
    if (!anyReady && !scanArmed) {
      session.phase = Phase.LOBBY;
      session.briefingEndsAt = 0;
      session.readyCountdownEnd = -1;
      session.participants = [];
      session.version += 1;
      enterPhase(Phase.LOBBY);
      broadcastSession();
      return;
    }
    if (nowMs >= session.briefingEndsAt) {
      // "Gantz opening" final sequence: first a clock-only wait
      // ('pre-mission-wait', ~17.5s), then the dematerialize scan fires
      // ('pre-mission', 2.5s), then the actual mission teleport.
      if (!session.scanPhase) {
        session.scanPhase = 'pre-mission-wait';
        session.scanEndsAt = nowMs + PRE_TELEPORT_WAIT_MS;
        session.version += 1;
        broadcastSession();
      } else if (session.scanPhase === 'pre-mission-wait' && nowMs >= session.scanEndsAt) {
        session.scanPhase = 'pre-mission';
        session.scanEndsAt = nowMs + PRE_TELEPORT_SCAN_MS;
        session.version += 1;
        broadcastSession();
      } else if (session.scanPhase === 'pre-mission' && nowMs >= session.scanEndsAt) {
        session.scanPhase = null;
        session.scanEndsAt = -1;
        hostStartMission(nowMs);
      }
    }
  } else if (p === Phase.MISSION) {
    // Mission-end gate (Stage 3b). While 'post-mission' scan is running, skip
    // all end-of-mission evaluation so we don't re-set the gate each tick.
    if (session.scanPhase === 'post-mission') {
      if (nowMs >= session.scanEndsAt) {
        const result = session._pendingResult || 'cleared';
        delete session._pendingResult;
        session.scanPhase = null;
        session.scanEndsAt = -1;
        hostEndMission(nowMs, result);
      }
      _gantzMockeryTick(nowMs);
    } else {
    const localDead = localIsParticipant() ? !player.alive : true;
    const peersDead = [...net.peers.entries()].every(([id, pr]) => {
      const inMission = !session.participants || session.participants.includes(id);
      return inMission ? pr.alive === false : true;
    });
    const allHumansDead = localDead && peersDead;
    if (allHumansDead) {
      _hostOpenEndMissionGate(nowMs, 'wiped');
    } else if (nowMs >= session.missionEndsAt) {
      // Timer ran out — kill every participant (host + peers) then wipe.
      if (player.alive) applyDamageToPlayer(player.hp || 999);
      for (const [, pr] of net.peers) pr.alive = false;
      net.sendSession?.({ timerWipe: true });
      _hostOpenEndMissionGate(nowMs, 'wiped');
    } else if (aliens.length > 0 && aliens.every(a => !a.alive)) {
      if (session.bonusBossRolled && !_bonusBossSpawned) {
        _bonusBossSpawned = true;
        const boss = spawnBonusBoss(session.missionSeed, MISSION_BOUNDS, session.missionIndex);
        aliens = [...aliens, boss];
        _sphereSay('bossAppearance', { forceShow: true, dwellMs: 4200, rateLimitMs: 1500 });
        broadcastAliens();
        _missionClearAt = -1;
      } else {
        // Hold briefly after the last kill so the gib burst + kill beat land
        // before the debrief overlay slams in.
        if (_missionClearAt < 0) _missionClearAt = nowMs;
        if (nowMs - _missionClearAt >= 3000) _hostOpenEndMissionGate(nowMs, 'cleared');
      }
    } else {
      _missionClearAt = -1;
    }
    _gantzMockeryTick(nowMs);
    }  // end of else (scanPhase !== 'post-mission')
  }

  if (nowMs - lastSessionBroadcast > SESSION_REBROADCAST_MS) broadcastSession();
}

// ---- Phase overlay UI ----
const overlayEl = document.getElementById('phase-overlay');
const overlayLabel = document.getElementById('po-label');
const overlayMission = document.getElementById('po-mission');
const overlayContent = document.getElementById('po-content');
const overlayCount = document.getElementById('po-count');
const missionHudEl = document.getElementById('mission-hud');
const missionTimerEl = document.getElementById('mh-timer');
const missionInfoEl = document.getElementById('mh-info');

function fmtMS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function refreshPhaseOverlay() {
  const p = session.phase;
  if (p === Phase.BRIEFING) {
    overlayEl.style.display = 'flex';
    overlayLabel.textContent = 'BRIEFING';
    overlayMission.textContent = `MISSION ${session.missionIndex}`;
    const targetsHtml = session.targets.map((t, i) => `
      <div class="target">
        <canvas class="alien-portrait" id="alien-portrait-${i}" width="140" height="180"></canvas>
        <div class="target-info">
          <strong>${t.name}</strong><span class="target-count"> × ${t.count}</span>
          <div class="target-hint">${t.hint || ''}</div>
        </div>
      </div>`).join('');
    overlayContent.innerHTML = `
      <div class="section">TARGETS</div>
      ${targetsHtml}
      <div class="section" style="margin-top:0.8rem;">RULES</div>
      <div style="opacity:0.75;font-size:0.8rem;">
        · Lobby is disarmed — weapons fire only in the field.<br/>
        · Timer out → Gantz detonates every hunter in your squad.<br/>
        · Shop is locked until debrief.
      </div>
    `;
    // Draw portraits after innerHTML is set so canvas elements exist in DOM
    session.targets.forEach((t, i) => {
      const cvs = document.getElementById(`alien-portrait-${i}`);
      if (cvs && t.archetype) drawAlienPortrait(cvs, t.archetype, t.specSeed);
    });
  } else if (p === Phase.DEBRIEF) {
    overlayEl.style.display = 'flex';
    overlayLabel.textContent = 'DEBRIEF';
    overlayMission.textContent = `MISSION ${session.missionIndex} ${session.missionResult === 'wiped' ? '— WIPED' : '— COMPLETE'}`;
    const ms = session.missionStats || {};
    const wiped = session.missionResult === 'wiped';
    const hpcBadge = stats.hundredPointClub ? `<span class="accent">★ 100-point club</span>` : '';
    overlayContent.innerHTML = `
      <div class="section">RESULTS</div>
      <div class="tally"><span>outcome</span><span class="v">${wiped ? 'wiped' : 'cleared'}</span></div>
      <div class="tally"><span>points earned</span><span class="v">${wiped ? '0 (reset)' : '+' + (ms.pointsEarned || 0)}</span></div>
      <div class="tally"><span>civilians killed</span><span class="v">${ms.civilianKills || 0}</span></div>
      <div class="tally"><span>hunters lost</span><span class="v">${ms.playerDied ? 1 : 0}</span></div>
      ${ms.bossKilled ? '<div class="tally"><span>bonus boss</span><span class="v">confirmed kill</span></div>' : ''}
      ${wiped ? '<div class="tally" style="color:#ff7080">GANTZ DETONATED THE SQUAD · ALL POINTS AND GEAR LOST</div>' : ''}
      <div class="section" style="margin-top:0.8rem;">LIFETIME</div>
      <div class="tally"><span>missions cleared</span><span class="v">${stats.missionsCompleted}</span></div>
      <div class="tally"><span>total wipes</span><span class="v">${stats.totalWipes}</span></div>
      <div class="tally"><span>bosses killed</span><span class="v">${stats.bossesKilled}</span></div>
      ${hpcBadge ? '<div style="margin-top:0.3rem;">' + hpcBadge + '</div>' : ''}
      <div class="section" style="margin-top:0.8rem;">NEXT</div>
      <div style="opacity:0.7;font-size:0.8rem;">
        Shop is open. Talk to Gantz and ready up when you're set.
      </div>
    `;
  } else if (p === Phase.MISSION && !localIsParticipant()) {
    overlayEl.style.display = 'flex';
    overlayLabel.textContent = 'STANDING BY';
    overlayMission.textContent = `MISSION ${session.missionIndex} IN PROGRESS`;
    overlayContent.innerHTML = `<div style="opacity:0.7;font-size:0.85rem;">You did not ready up. Wait in the lobby for your squad to return.</div>`;
    overlayCount.innerHTML = '';
  } else {
    overlayEl.style.display = 'none';
  }

  missionHudEl.style.display = (p === Phase.MISSION && localIsParticipant()) ? 'block' : 'none';
  missionInfoEl.textContent = `MISSION ${session.missionIndex}`;
}

function updatePhaseTimers(nowMs) {
  if (session.phase === Phase.BRIEFING) {
    const remain = Math.max(0, session.briefingEndsAt - nowMs);
    overlayCount.innerHTML = `<span class="dim">entering mission in</span> ${fmtMS(remain)}`;
  } else if (session.phase === Phase.DEBRIEF) {
    const remain = Math.max(0, session.debriefEndsAt - nowMs);
    overlayCount.innerHTML = `<span class="dim">lobby returns in</span> ${fmtMS(remain)}`;
  } else if (session.phase === Phase.MISSION) {
    if (localIsParticipant()) {
      const remain = Math.max(0, session.missionEndsAt - nowMs);
      missionTimerEl.textContent = fmtMS(remain);
      missionTimerEl.classList.toggle('urgent', remain < 15000);
    }
  }
}

const _chatBubbles = new Map(); // peerId → { text, expiresAt }
const CHAT_BUBBLE_MS = 7000;

net.onChat(msg => {
  chat.add(msg);
  // Gantz chants go to the chat log only — no speech bubble above a character.
  if (msg.peerId && msg.username !== 'GANTZ') {
    _chatBubbles.set(msg.peerId, { text: msg.text, expiresAt: performance.now() + CHAT_BUBBLE_MS });
  }
});

const peersEl = document.getElementById('peers');

function refreshPeerCount() {
  const n = net.peers.size + 1;
  peersEl.textContent = `${n} online${net.isHost ? ' · host' : ''}`;
  peersEl.classList.toggle('offline', net.status === 'offline');
}
net.onStatus(s => {
  if (s === 'connected') refreshPeerCount();
  else if (s === 'offline') { peersEl.textContent = 'multiplayer offline'; peersEl.classList.add('offline'); }
});
net.onPeerChange(refreshPeerCount);
let hostSince = Date.now();
net.onHostChange((hostId) => {
  refreshPeerCount();
  if (net.isHost) hostSince = Date.now();
});
net.onPeerLeave((id, peer) => {
  const name = peer?.username;
  if (name) chat.addSystem(`Data corrupted. ${name} has been erased.`);
  _remoteFirstSeen.delete(id);
  _remoteSawScan.delete(id);
  _remoteScansFired.delete(id);
});
net.onNudge((msg, peerId) => {
  if (!msg || typeof msg.dx !== 'number' || typeof msg.dy !== 'number') return;
  if (msg.kind === 'civ') {
    // Another player nudged a civilian — apply to our local copy by ID.
    // Ignore civilian nudges from cross-zone peers; mission civilians don't
    // exist for lobby clients and vice versa.
    if (peerId && !sameZoneAsLocal(peerId)) return;
    const civ = civilians.find(c => c.id === msg.id);
    if (civ && civ.alive !== false) {
      civ.x += msg.dx;
      civ.y += msg.dy;
    }
  } else {
    // Targeted nudge — this message was sent to us specifically. Reject if
    // it came from a peer in a different zone; a lobby player can't push a
    // mission player (or vice versa) even though their world coords might
    // momentarily overlap across the two rooms.
    if (peerId && !sameZoneAsLocal(peerId)) return;
    if (!player.alive) return;
    player.x += msg.dx;
    player.y += msg.dy;
  }
});

// ---- Frame ----
const prevPos = new Map();

function noteActivity() { player.lastActivityAt = performance.now(); }
addEventListener('keydown', noteActivity);
addEventListener('mousemove', noteActivity);
addEventListener('mousedown', noteActivity);

// --- Toast log ---
const gantzPromptEl  = document.getElementById('gantz-prompt');
const doorPromptEl   = document.getElementById('door-prompt');
const portalPromptEl = document.getElementById('portal-prompt');

function updateWorldHtmlOverlays() {
  // localInMission: true only when the player is physically present in the mission.
  // Non-participants remain in the lobby even while session.phase === MISSION.
  const localInMission = session.phase === Phase.MISSION && localIsParticipant();
  if (!localInMission) {
    const d = Math.hypot(player.x - GANTZ_BALL.x, player.y - GANTZ_BALL.y);
    const gantzTalking = (_introStartTime !== -1 && !_introDone) || (_namePromptPhase !== 'idle' && !_namePromptDone) || (!_gantzTalkDone && !!_gantzTalkLines) || (!_gantzExitDone && _gantzExitStart !== -1);
    const countdownActive = session.readyCountdownEnd >= 0 && session.phase !== Phase.BRIEFING && session.phase !== Phase.MISSION;
    const briefingActive = session.phase === Phase.BRIEFING;
    const queueToggleActive = countdownActive || briefingActive;
    const nearBall = d < INTERACT_RADIUS && !menu.isOpen() && !gantzTalking;
    if (d < INTERACT_RADIUS && _gantzSpeechSkippable()) {
      gantzPromptEl.textContent = '[E] Skip';
      gantzPromptEl.style.display = 'block';
    } else if (nearBall && queueToggleActive) {
      gantzPromptEl.textContent = player.ready ? '[E] Leave Queue' : '[E] Join Queue';
      gantzPromptEl.style.display = 'block';
    } else {
      gantzPromptEl.textContent = '[E] Talk to Gantz';
      gantzPromptEl.style.display = (nearBall && !player.ready) ? 'block' : 'none';
    }
  } else {
    gantzPromptEl.style.display = 'none';
  }

  // Door prompt — show when near a lobby door and no menu is open
  if (!localInMission && !menu.isOpen()) {
    let nearDoor = -1;
    for (let di = 0; di < _LOBBY_DOORS.length; di++) {
      const door = _LOBBY_DOORS[di];
      if (Math.hypot(player.x - door.x, player.y - door.y) < DOOR_INTERACT_RADIUS) {
        nearDoor = di; break;
      }
    }
    if (nearDoor >= 0 && gantzPromptEl.style.display === 'none') {
      doorPromptEl.textContent = _doorOpen[nearDoor] ? '[E] Close door' : '[E] Open door';
      doorPromptEl.style.display = 'block';
    } else {
      doorPromptEl.style.display = 'none';
    }
  } else {
    doorPromptEl.style.display = 'none';
  }

  // Portal prompt — show when near the Jam Portal in the hallway room
  if (!localInMission && !menu.isOpen()) {
    const dp = Math.hypot(player.x - _PORTAL_POS.x, player.y - _PORTAL_POS.y);
    portalPromptEl.style.display = (dp < _PORTAL_RADIUS && !_portalBusy) ? 'block' : 'none';
  } else {
    portalPromptEl.style.display = 'none';
  }

  // Hunters list — local player first, then connected peers
  // status: 'lobby' | 'mission_alive' | 'mission_dead'
  const _inMission = session.phase === Phase.MISSION;
  const _parts     = session.participants; // null = everyone is a participant
  function _hunterStatus(isParticipant, alive) {
    if (!_inMission || !isParticipant) return 'lobby';
    return alive ? 'mission_alive' : 'mission_dead';
  }
  const _hunters = [
    {
      name:   player.username || 'Hunter',
      color:  String(player.color || 'c8142b').replace('#', ''),
      local:  true,
      status: _hunterStatus(localIsParticipant(), player.alive),
    },
    ...[...net.peers.entries()]
      .filter(([, p]) => p.username)
      .map(([id, p]) => ({
        name:   p.username,
        color:  String(p.color || 'c8142b').replace('#', ''),
        local:  false,
        status: _hunterStatus(!_parts || _parts.includes(id), p.alive !== false),
      })),
  ];
  chat.updateHunters(_hunters);
}

const toastEl = document.getElementById('toast-log');
function toast(text, kind = 'info') {
  if (!toastEl) return;
  const div = document.createElement('div');
  div.className = 'toast ' + kind;
  div.textContent = text;
  toastEl.appendChild(div);
  setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 2500);
}

// --- Weapon HUD ---
const weaponHudEl = document.getElementById('weapon-hud');
const weaponSlotEl = document.getElementById('wh-weapon');
const weaponPointsEl = document.getElementById('wh-points');
function updateWeaponHUD() {
  const inMission = session.phase === Phase.MISSION && localIsParticipant();
  weaponHudEl.style.display = inMission ? 'flex' : 'none';
  if (inMission) {
    const slots = [player.loadout.weapon1, player.loadout.weapon2];
    const active = slots[player.activeSlot || 0];
    const w = WEAPONS[active];
    weaponSlotEl.textContent = w ? w.name.toUpperCase() : '—';
    weaponSlotEl.title = w ? w.hint : '';
  }
  const suit = SUITS[player.loadout?.suit || 'basic'];
  weaponPointsEl.textContent = `${player.points} pt · hp ${player.hp}/${suit.maxHp}`;
}

// --- Gantz Neural HUD (new) ---
let _lastHudMode = 'fps';
let _lastPointsSeen = -1; // sentinel — first observed value is a no-op
let _dossierIdx = 0;
let _dossierCycleAt = 0;
let _aimTargetKind = 'idle';       // 'idle' | 'civ' | 'alien' | 'peer'
let _aimTargetId = null;           // stable id of current aim target (alien/civ/peer)
let _aimDwellStart = 0;            // ms when current aim target was first seen
let _aimAnnouncedForId = null;     // id we've already spoken about
let _idleLastX = 0, _idleLastY = 0;
let _idleSinceMs = 0;
let _idleNextAnnounceAt = 0;
let _reticleWarnState = 'idle';    // what the HUD reticle is showing
let _hudPrevAliensAlive = -1;
let _hudAnnouncedLastAlien = false;
let _hudAnnouncedTenSec = false;
let _hudAnnouncedFirstBlood = false;

function _pickDossierTarget() {
  if (!aliens.length) return null;
  const now = performance.now();
  if (now >= _dossierCycleAt) {
    const alive = aliens.filter(a => a.alive);
    if (alive.length) _dossierIdx = (_dossierIdx + 1) % alive.length;
    _dossierCycleAt = now + 4000;
  }
  const alive = aliens.filter(a => a.alive);
  const tgt = alive[_dossierIdx % Math.max(1, alive.length)] || aliens.find(a => a.alive) || aliens[0] || null;
  if (!tgt) return null;
  const arch = ARCHETYPES[tgt.archetype] || {};
  const threat = Math.min(1, (arch.hp || 1) / 500);
  const targetRow = (session.targets || []).find(r => r.archetype === tgt.archetype);
  const resolvedName = tgt.spec?.name || targetRow?.name || arch.name || 'UNKNOWN';
  return {
    id: tgt.id,
    alive: tgt.alive,
    marked: tgt.marked,
    archetype: tgt.archetype,
    specSeed: tgt.spec?.seed,
    name: resolvedName,
    threat,
    _portraitKey: `${tgt.archetype}-${tgt.spec?.seed}`,
  };
}

function _computeReticleWarn() {
  // Compute cheaply each frame: is the crosshair currently over a civilian/teammate?
  const inMission = session.phase === Phase.MISSION && localIsParticipant();
  if (!inMission || !player.alive) { _aimTargetKind = 'idle'; _aimTargetId = null; return 'idle'; }
  const camFwd = scene3d.getCameraForwardXZ?.();
  const camOrg = scene3d.getCameraOriginXZ?.();
  if (!camFwd || !camOrg) return 'idle';

  // Build a peer hitscan set (peers aren't in _buildFireTargets because bullets
  // pass through them — but we still want to detect them for aim warnings).
  const peerTargets = [];
  for (const [id, p] of net.peers) {
    if (!p || p.alive === false) continue;
    if (p.inMission !== true) continue;
    if (p.x == null) continue;
    peerTargets.push({ id, kind: 'peer', x: p.renderX ?? p.x, y: p.renderY ?? p.y, radius: 0.35, alive: true, username: p.username });
  }
  const targets = _buildFireTargets();
  const bodyClear = (player.radius || 0.35) + 0.2;
  const filter = (t) => {
    if (!t || t.alive === false) return false;
    const proj = (t.x - player.x) * camFwd.x + (t.y - player.y) * camFwd.y;
    return proj >= bodyClear;
  };
  const all = [...targets.filter(filter), ...peerTargets.filter(filter)];
  const w = { range: 40 };
  const hit = hitscan(camOrg.x, camOrg.y, camFwd.x, camFwd.y, w.range, activeColliders, all);
  let kind = 'idle';
  let id = null;
  let warn = 'idle';
  if (hit && hit.target) {
    if (hit.target.kind === 'civilian') { kind = 'civ'; id = hit.target.id; warn = 'civ'; }
    else if (hit.target.kind === 'peer') { kind = 'peer'; id = hit.target.id; warn = 'idle'; }
    else { kind = 'alien'; id = hit.target.id; warn = 'idle'; }
  }

  // Dwell-triggered transmission (fires once per new target after short dwell).
  const nowMs = performance.now();
  if (id !== _aimTargetId) {
    _aimTargetId = id;
    _aimDwellStart = nowMs;
    _aimAnnouncedForId = null;
  }
  if (kind !== 'idle' && id != null && _aimAnnouncedForId !== id && nowMs - _aimDwellStart > 700) {
    _aimAnnouncedForId = id;
    if (kind === 'alien') {
      _sphereSay('aimAlien', { dwellMs: 2400, rateLimitMs: 8000 });
    } else if (kind === 'civ') {
      _sphereSay('aimCiv', { dwellMs: 2800, rateLimitMs: 7000 });
    } else if (kind === 'peer') {
      const peerName = hit.target.username || 'hunter';
      _sphereSay('aimPeer', { dwellMs: 2600, rateLimitMs: 8000, name: peerName });
    }
  }

  _aimTargetKind = kind;
  return warn;
}

function _buildWorldBadges() {
  // Project marked aliens + civilians to screen, return an array of badges
  // to render as absolutely-positioned divs. Skip entries that are behind
  // the camera or offscreen.
  const out = [];
  if (!(session.phase === Phase.MISSION && localIsParticipant())) return out;
  const now = performance.now();
  const add = (ent, kind) => {
    if (!ent || ent.alive === false || !ent.marked) return;
    const dur = ent._markTimeMs || 1500;
    const remain = Math.max(0, dur - (now - (ent.markedAt || 0))) / 1000;
    // Project an elevated point (head level) for nicer placement.
    const headY = kind === 'alien' ? 2.0 : 1.75;
    const p = scene3d.worldToScreen?.(ent.x, headY, ent.y);
    if (!p || p.behind) return;
    out.push({ sx: p.x, sy: p.y, secs: remain, kind: kind === 'alien' ? 'alien' : 'civ' });
  };
  for (const a of aliens) add(a, 'alien');
  for (const c of civilians) add(c, 'civ');
  return out;
}

function _tickGantzHudFrame(dt) {
  const inMission = session.phase === Phase.MISSION && localIsParticipant();
  setGantzHudActive(inMission);

  // FP/TP mode swap
  const nextMode = scene3d.isThirdPerson?.() ? 'tps' : 'fps';
  if (nextMode !== _lastHudMode) {
    _lastHudMode = nextMode;
    setGantzHudView(nextMode);
  }

  // Points delta edge trigger
  const pts = player.points | 0;
  if (pts !== _lastPointsSeen) {
    const firstObservation = _lastPointsSeen < 0;
    const delta = firstObservation ? 0 : pts - _lastPointsSeen;
    if (!firstObservation) gantzHudOnPoints(pts, delta, delta < 0 ? 'loss' : 'gain');
    // Skip SFX on a total wipe (points slammed to 0 from a big balance) —
    // that's not a player-driven loss they'd expect to hear.
    const isWipeReset = pts === 0 && delta < -50;
    if (!firstObservation && !isWipeReset) {
      if (delta > 0) audio.play(SFX_POINT_GAIN, 0.7);
      else if (delta < 0) audio.play(SFX_POINT_LOSS, 0.8);
    }
    _lastPointsSeen = pts;
  }

  if (!inMission) {
    _hudPrevAliensAlive = -1;
    _hudAnnouncedLastAlien = false;
    _hudAnnouncedTenSec = false;
    _hudAnnouncedFirstBlood = false;
    _idleSinceMs = 0;
    _idleNextAnnounceAt = 0;
    return;
  }

  // Idle detection: player hasn't moved for a while → sphere nags.
  {
    const nowMs = performance.now();
    const dx = player.x - _idleLastX;
    const dy = player.y - _idleLastY;
    if (dx * dx + dy * dy > 0.04) {
      _idleLastX = player.x;
      _idleLastY = player.y;
      _idleSinceMs = nowMs;
      _idleNextAnnounceAt = nowMs + 8000 + Math.random() * 4000;
    } else if (_idleSinceMs > 0 && nowMs > _idleNextAnnounceAt && nowMs - _idleSinceMs > 8000) {
      _sphereSay('idle', { dwellMs: 2800, rateLimitMs: 3000 });
      _idleNextAnnounceAt = nowMs + 12000 + Math.random() * 8000;
    }
  }

  // Reticle warn
  const warn = _computeReticleWarn();
  _reticleWarnState = warn;

  // Dialogue triggers on state change
  const aliveCount = aliens.filter(a => a.alive).length;
  if (_hudPrevAliensAlive === -1) _hudPrevAliensAlive = aliveCount;
  if (aliveCount < _hudPrevAliensAlive) {
    if (!_hudAnnouncedFirstBlood) {
      _hudAnnouncedFirstBlood = true;
      gantzHudAmbient('KILL CONFIRMED · TALLY +1');
    }
    if (aliveCount === 1 && !_hudAnnouncedLastAlien) {
      _hudAnnouncedLastAlien = true;
      _sphereSay('oneLeft', { dwellMs: 3500, rateLimitMs: 0, forceShow: true });
    } else if (aliveCount === 0 && aliens.length > 0) {
      _sphereSay('fieldCleared', { dwellMs: 4500, rateLimitMs: 0, forceShow: true });
    }
  }
  _hudPrevAliensAlive = aliveCount;

  const chronoRemainMs = Math.max(0, session.missionEndsAt - Date.now());
  if (chronoRemainMs < 10000 && !_hudAnnouncedTenSec && chronoRemainMs > 0) {
    _hudAnnouncedTenSec = true;
    _sphereSay('tenSecWarning', { dwellMs: 3000, rateLimitMs: 0, forceShow: true });
  }

  // Weapon bar
  const wid = activeWeaponId();
  const w = WEAPONS[wid];
  const cdMax = w ? (w.cooldown || 0) : 0;
  const cdRem = Math.max(0, fireCooldown);
  const ready = cdRem <= 0.001 || cdMax <= 0.001;
  const barT = ready ? 1 : 1 - (cdRem / cdMax);

  // Dossier target
  const dossierTarget = _pickDossierTarget();

  // Remote peers as radar blips
  const remotePeers = [];
  for (const [, p] of net.peers) {
    if (!p || p.alive === false) continue;
    if (p.inMission !== true) continue;
    if (p.x == null) continue;
    remotePeers.push({ x: p.renderX ?? p.x, y: p.renderY ?? p.y, name: p.username });
  }

  const chronoMs = Math.max(0, session.missionEndsAt - Date.now());

  tickGantzHud({
    phase: session.phase,
    inMission,
    username: player.username || '—',
    peerCount: remotePeers.length + 1,
    modifierLabel: '',
    chronoMs,
    weaponName: w?.name || '—',
    weaponState: ready ? 'READY' : 'CYCLING',
    weaponBarT: barT,
    weaponBarReady: ready,
    points: pts,
    aliens,
    civilians,
    remotePeers,
    player: { x: player.x, y: player.y, facing: player.facing, yaw },
    dossierTarget,
    reticleWarn: warn,
    worldBadges: _buildWorldBadges(),
  }, dt);
}

// --- Fire weapon on click ---
function activeWeaponId() {
  const slots = [player.loadout.weapon1, player.loadout.weapon2];
  return slots[player.activeSlot || 0] || slots.find(Boolean);
}

function _buildFireTargets() {
  // Remote human peers are intentionally NOT included — players shoot through
  // each other. (Previously they were included as non-damaging blockers; that
  // meant a teammate between you and an alien could absorb your shot.)
  return [
    ...aliens,
    ...civilians,
  ];
}

// Queue of hits waiting for their bullets to visually reach the target
// before any damage / marks / deaths are applied. Entries:
//   { appliesAt, hit, w, shooterId }
// Processed once per frame by processPendingHits() from update().
const _pendingHits = [];
// Must match BULLET_SPEED in scene3d.js — used to compute travel time so
// damage lands the instant the visible bullet arrives.
const BULLET_TRAVEL_SPEED = 80;

// Apply the gameplay effects of a single hitscan result (alien mark, civilian
// kill, tracer broadcast). `tracerFrom` is where to draw the visible tracer
// FROM — usually the shooter's position (not necessarily the hitscan origin;
// in TP we do the hitscan from the camera but the tracer still originates at
// the player so remote clients see a plausible shot).
function applyHitResult(hit, w, shooterId, tracerFromX, tracerFromY) {
  // Spawn our own visible bullet locally — peers spawn theirs via onShot.
  // In first-person, the bullet should exit the gun's barrel, not the middle
  // of the screen, so we pull the viewmodel muzzle's world position and pass
  // it as an explicit 3D origin override on the tracer payload.
  if (shooterId === net.selfId) {
    const payload = { x1: tracerFromX, y1: tracerFromY, x2: hit.point.x, y2: hit.point.y, color: w.tracerColor };
    // Origin: FP uses the viewmodel muzzle (gun in front of camera); TP uses
    // the local character's hand gun so the bullet exits the weapon the
    // player sees on their own 3rd-person model.
    const isTP = scene3d.isThirdPerson?.();
    const muz = isTP
      ? scene3d.getRemoteMuzzleWorldPosition?.('__player__')
      : scene3d.getMuzzleWorldPosition?.();
    if (muz) {
      payload.ox = muz.x; payload.oy = muz.y; payload.oz = muz.z;
    }
    // Bullet endpoint controls BOTH direction (scene3d normalizes endpoint−
    // origin) and how far the bullet can travel (scene3d caps `remaining` at
    // the endpoint distance). Two situations need different strategies:
    //
    // 1) Hitscan landed on a LIVING TARGET (hit.target set): aim the bullet
    //    at the actual 3D crosshair target point so it converges exactly on
    //    that target. The endpoint is the 3D point on the camera ray at the
    //    2D hit distance (horizLen correction so the vertical/horizontal
    //    components scale together — without this, pitched shots fall short
    //    horizontally and the bullet flies at a wrong angle).
    //
    // 2) Hitscan hit only a WALL or nothing: aim the bullet along camFwd
    //    starting at the muzzle. Using muzzle→wall-point here makes the
    //    bullet fly at a visibly steep angle (and continue that angle past
    //    the wall for the rest of BULLET_MAX_DIST) — the "going off in
    //    another direction" bug. Flying straight along camFwd from the
    //    muzzle looks correct; the small parallel offset from the actual
    //    crosshair ray is acceptable when there's no target to miss.
    const fwd = scene3d.getCameraForward3D?.();
    const camO = scene3d.getCameraOrigin3D?.();
    if (fwd && camO && payload.ox != null) {
      if (hit.target) {
        // Aim at the 3D crosshair point — horizLen scales the 3D unit fwd
        // vector so its horizontal component equals the 2D hit distance.
        const dist = Math.hypot(hit.point.x - camO.x, hit.point.y - camO.z);
        const horizLen = Math.hypot(fwd.x, fwd.z) || 1;
        const s = dist / horizLen;
        payload.ex = camO.x + fwd.x * s;
        payload.ey = camO.y + fwd.y * s;
        payload.ez = camO.z + fwd.z * s;
      } else {
        // No target hit (wall or empty sky). Point the bullet at a distant
        // spot on the CAMERA ray (crosshair ray), not parallel to camFwd
        // starting at the muzzle. Flying parallel means the bullet stays
        // offset from the crosshair for its entire travel distance — at
        // long range you see it pass visibly left-and-down of the reticle
        // (muzzle sits right+low of the camera in TP). Aiming through a
        // point far along the camera ray pulls the bullet path back onto
        // the crosshair.
        const K = 50; // ≥ BULLET_MAX_DIST so direction dominates
        payload.ex = camO.x + fwd.x * K;
        payload.ey = camO.y + fwd.y * K;
        payload.ez = camO.z + fwd.z * K;
      }
    }
    emitTracer(payload);
    // Broadcast the shot to remote peers so they see the bullet travel in the
    // correct 3D direction (with pitch), not as a flat horizontal tracer. We
    // include the 3D endpoint (ex, ey, ez) computed above; peers derive their
    // own bullet origin from OUR remote muzzle position in their scene, so we
    // don't send ox/oy/oz. Falls back to 2D fields if the 3D computation was
    // skipped (no camera forward available).
    const shotMsg = { x1: tracerFromX, y1: tracerFromY, x2: hit.point.x, y2: hit.point.y, color: w.tracerColor };
    if (payload.ex != null) { shotMsg.ex = payload.ex; shotMsg.ey = payload.ey; shotMsg.ez = payload.ez; }
    net.sendShot(shotMsg);
  } else {
    // NPC / AI shooter path — still broadcast 2D so sound + a horizontal
    // tracer play on remote peers (no 3D info available here).
    net.sendShot({ x1: tracerFromX, y1: tracerFromY, x2: hit.point.x, y2: hit.point.y, color: w.tracerColor });
  }
  if (!hit.target) return;
  // Defer the damage / mark / kill effects until the bullet's visual has
  // had time to travel from the shooter to the hit point. Travel distance
  // is computed in the 2D game plane — matches how scene3d steps bullets.
  const dx = hit.point.x - tracerFromX;
  const dy = hit.point.y - tracerFromY;
  const dist = Math.hypot(dx, dy);
  const delayMs = (dist / BULLET_TRAVEL_SPEED) * 1000;
  _pendingHits.push({
    appliesAt: performance.now() + delayMs,
    hit, w, shooterId,
  });
}

// Actually apply the gameplay consequences of a hit. Called once the
// corresponding bullet has traveled long enough to visually reach the
// target.
function _applyHitNow(hit, w, shooterId) {
  if (!hit?.target) return;
  if (hit.target.kind === 'alien') {
    if (shooterId === net.selfId) {
      net.sendHit({ kind: 'alien', id: hit.target.id, shooterId, markMs: w.markTime * 1000 });
      if (!hit.target.marked) {
        _sphereSay('alienMarkedByYou', { dwellMs: 2600, rateLimitMs: 4500 });
      }
    }
    if (net.isHost) {
      const a = aliens.find(a => a.id === hit.target.id && a.alive);
      if (a && !a.marked) {
        a.marked = true;
        a.markedAt = performance.now();
        a._killerId = shooterId;
        a._markTimeMs = w.markTime * 1000;
        broadcastAliens();
      }
    }
  } else if (hit.target.kind === 'civilian') {
    // X-family weapons fuse the civilian — they bloat and detonate after
    // markTime. Host authoritative: host marks + ticks + broadcasts death.
    if (shooterId === net.selfId) {
      net.sendHit({ kind: 'civilian', id: hit.target.id, shooterId, markMs: w.markTime * 1000 });
    }
    if (net.isHost && shooterId === net.selfId) {
      const c = civilians.find(c => c.id === hit.target.id);
      if (c && c.alive !== false && !c.marked) {
        c.marked = true;
        c.markedAt = performance.now();
        c._markTimeMs = w.markTime * 1000;
        c._killerId = shooterId;
        c.vx = 0; c.vy = 0;
        broadcastCivs();
      }
    }
  }
}

// Flush any bullets that have reached their targets this frame.
function processPendingHits() {
  if (_pendingHits.length === 0) return;
  const now = performance.now();
  for (let i = _pendingHits.length - 1; i >= 0; i--) {
    const p = _pendingHits[i];
    if (now >= p.appliesAt) {
      _applyHitNow(p.hit, p.w, p.shooterId);
      _pendingHits.splice(i, 1);
    }
  }
}

function fireRay(originX, originY, dirX, dirY, w, shooterId = net.selfId) {
  const targets = _buildFireTargets();
  const hit = hitscan(originX, originY, dirX, dirY, w.range, activeColliders, targets);
  applyHitResult(hit, w, shooterId, originX, originY);
}

function tryFire() {
  if (session.phase !== Phase.MISSION || !player.alive) return;
  if (!localIsParticipant()) return;
  if (fireCooldown > 0) return;
  const wid = activeWeaponId();
  const w = WEAPONS[wid];
  if (!w) return;
  fireCooldown = w.cooldown;

  // Civilian warning: if the crosshair is on a civilian when we pulled the
  // trigger, punish cosmetically (flash + inverted clicks + dialogue).
  if (_aimTargetKind === 'civ') {
    gantzHudOnFire({ kind: 'civilian' });
    _sphereSay('civMarkedByYou', { dwellMs: 5000, rateLimitMs: 3000, forceShow: true });
  } else if (_aimTargetKind === 'peer') {
    _sphereSay('shotAtPeer', { dwellMs: 3200, rateLimitMs: 4000, forceShow: true });
  }

  // FPS feedback: muzzle flash + screen tint + sound
  scene3d.triggerMuzzleFlash?.();
  _gunFlashEl.classList.remove('active');
  void _gunFlashEl.offsetWidth; // reflow to restart animation
  _gunFlashEl.classList.add('active');
  // Own gunshot: always full volume, no pan — the sound is "in your hands",
  // not in the world from your listener's POV. Remote peers still hear it
  // positionally via the onShot broadcast.
  audio.play(SFX_GUN_SHOOT, 0.6);
  fireId++;
  // Dynamic crosshair: each shot pushes the four ticks outward. Spread decays
  // back to 0 every frame in render() when not firing.
  // X-Gun is one-shot-per-charge, so each shot slams the crosshair wide open.
  bumpCrosshairSpread(w.mode === 'spread' ? 130 : 120);

  // The bullet hits whatever the CROSSHAIR is actually over. We hitscan from
  // the camera's XZ position along its forward axis (the same 2D collision
  // set the bullet uses) and apply the damage/mark to that target directly.
  // This avoids the parallax problem a second hitscan from the player would
  // cause — the player and the camera are offset by the TP shoulder rig, so
  // a ray from the player aimed at the crosshair point passes through
  // different space than the camera's ray and could clip objects that are
  // left/right of the crosshair but on the player→aim-point line.
  const camFwd = scene3d.getCameraForwardXZ();
  const camOrg = scene3d.getCameraOriginXZ();
  const allTargets = _buildFireTargets();

  // Targeting filter: keep only entities that are in front of the PLAYER
  // along the aim direction, past the player's body. This is what blocks
  // the TP shoulder-offset camera ray from hitting NPCs that stand beside
  // or behind the player — they project negative (behind player) or near
  // zero (adjacent) on the aim axis even though the camera ray happens to
  // graze their body circle. Crosshair accuracy is preserved because the
  // ray we then cast is still from the camera origin along camFwd (the
  // true crosshair ray) — we're just denying the ray access to entities
  // the player couldn't reasonably be shooting at.
  const bodyClear = (player.radius || 0.35) + 0.2;
  const targets = allTargets.filter(t => {
    if (!t || t.alive === false) return false;
    const proj = (t.x - player.x) * camFwd.x + (t.y - player.y) * camFwd.y;
    return proj >= bodyClear;
  });

  // Vertical hit check: the hitscan is 2D (XZ plane only) so without this a
  // shot aimed high above/below an NPC still lands whenever the crosshair's
  // horizontal direction crosses the target's footprint. Reconstruct the
  // camera ray's Y at the TARGET's position and reject the target hit if Y
  // is outside the NPC's vertical extent. We use the target's own x,y
  // (not hit.point) so the check is invariant to how the hitscan snapped
  // the intersection — hit.point is often at the target circle's near edge
  // which can sit closer than the center at oblique angles.
  const cam3D = scene3d.getCameraOrigin3D?.();
  const fwd3D = scene3d.getCameraForward3D?.();
  function verticalCheck(hit) {
    if (!hit || !hit.target || !cam3D || !fwd3D) return hit;
    const t = hit.target;
    // Use the target's body center (2D) for the distance, not the ray
    // intersection point on its circle.
    const dx = (t.x != null ? t.x : hit.point.x) - cam3D.x;
    const dz = (t.y != null ? t.y : hit.point.y) - cam3D.z;
    const dist2D = Math.hypot(dx, dz);
    const horizLen = Math.hypot(fwd3D.x, fwd3D.z) || 1;
    const yAtTarget = cam3D.y + fwd3D.y * (dist2D / horizLen);
    // Per-target vertical extent. Humans/civilians stand ~1.8m; aliens vary
    // wildly (big boss can clear 4m). Scale by spec.size so tall aliens still
    // take headshots. Feet at 0; subtract a little for stance variance.
    const bodyTop =
      t.kind === 'alien' ? Math.max(2.5, 2.2 * (t.spec?.size || 1)) :
      /* human / civilian / remote */ 1.9;
    const bodyBot = -0.2;
    const fudge = (t.radius || 0.35) * 0.5;
    if (yAtTarget < bodyBot - fudge || yAtTarget > bodyTop + fudge) {
      return { ...hit, target: null };
    }
    return hit;
  }

  if (w.mode === 'spread') {
    // Shotgun: pellets spread around the crosshair direction from the camera
    // origin so each pellet's aim matches what it "points at" on screen.
    const baseAng = Math.atan2(camFwd.y, camFwd.x);
    const n = w.spreadCount || 3;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) - 0.5;
      const a = baseAng + t * w.spreadAngle;
      const dx = Math.cos(a), dy = Math.sin(a);
      const hit = verticalCheck(hitscan(camOrg.x, camOrg.y, dx, dy, w.range, activeColliders, targets));
      applyHitResult(hit, w, net.selfId, player.x, player.y);
    }
  } else {
    const hit = verticalCheck(hitscan(camOrg.x, camOrg.y, camFwd.x, camFwd.y, w.range, activeColliders, targets));
    applyHitResult(hit, w, net.selfId, player.x, player.y);
    if (session.phase === Phase.MISSION && !hit.target && _aimTargetKind === 'idle') {
      _sphereSay('missedShot', { dwellMs: 2400, rateLimitMs: 7000 });
    }
  }

  noteActivity();
  updateWeaponHUD();
}

// Weapon slot switching
addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.id === 'chat-input') return;
  if (menu.isOpen()) return;
  if (e.key === '1') {
    if (player.activeSlot !== 0) {
      player.activeSlot = 0;
      updateWeaponHUD();
      toast(WEAPONS[player.loadout.weapon1]?.name || '—', 'info');
      if (session.phase === Phase.MISSION) _sphereSay('weaponSwitch', { dwellMs: 2600, rateLimitMs: 8000 });
    }
  }
  else if (e.key === '2' && player.loadout.weapon2) {
    if (player.activeSlot !== 1) {
      player.activeSlot = 1;
      updateWeaponHUD();
      toast(WEAPONS[player.loadout.weapon2]?.name || '—', 'info');
      if (session.phase === Phase.MISSION) _sphereSay('weaponSwitch', { dwellMs: 2600, rateLimitMs: 8000 });
    }
  }
});

// Ball menu click interaction — raycast screen click to UV, map to button region
addEventListener('click', (e) => {
  if (e.button !== 0) return;
  if (!menu.isOpen()) return;
  if (!scene3d) return;
  const sx = document.pointerLockElement ? canvas.clientWidth / 2 : e.clientX;
  const sy = document.pointerLockElement ? canvas.clientHeight / 2 : e.clientY;
  const uv = scene3d.raycastBallDisplay(sx, sy);
  if (!uv) return;
  const px = uv.x * 1024;
  const py = (1 - uv.y) * 1024;
  const wasOpen = menu.isOpen();
  for (const [key, r] of Object.entries(_ballBtns)) {
    if (px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2) {
      menu.handleAction(key);
      break;
    }
  }
  if (wasOpen && !menu.isOpen()) requestLockIfAllowed();
});

addEventListener('mousedown', (e) => {
  if (document.activeElement && document.activeElement.id === 'chat-input') return;
  // Re-acquire pointer lock on any click, even if menu is open.
  if (!pointerLocked) requestLockIfAllowed();
  if (menu.isOpen()) return;
  if (e.button !== 0) return;
  tryFire();
});

// Exit pointer lock when modals open so the cursor is available
const chatInputEl = document.getElementById('chat-input');
chatInputEl?.addEventListener('focus', () => {
  if (document.pointerLockElement) document.exitPointerLock();
});


function update(dt) {
  // Stage 3c: relay remote peers' scans to scene3d. Each peer's pose carries
  // a compact `scan` descriptor while a scan is active; fire it once per new
  // `scan.t` onto their 3rd-person mesh.
  for (const [peerId, peer] of net.peers) {
    const s = peer?.scan;
    if (!s) continue;
    if (_remoteScansFired.get(peerId) === s.t) continue;
    const opts = { type: s.type };
    if (s.k === 'b') opts.sourceBall = { x: s.sx, y: s.sy, z: s.sz, r: s.sr };
    else opts.source = { x: s.sx, y: s.sy, z: s.sz };
    // startTransferScan returns false if the peer's mesh entry hasn't been
    // ingested yet (first pose frame arrives before scene3d.render creates the
    // entry). Only mark as fired on success so we retry next frame instead of
    // silently dropping the scan.
    const ok = scene3d.startTransferScan?.(peerId, opts);
    if (ok) {
      _remoteScansFired.set(peerId, s.t);
      const px = peer?.x ?? player.x;
      const py = peer?.y ?? player.y;
      audio.playAt(SFX_SCAN, px, py, { volume: 0.7 });
    }
  }

  // Stage 3b: react to scan-phase transitions once per gate open. The host's
  // hostTick sets scanPhase before the teleport; every peer (including host)
  // triggers its local dematerialize here when the phase flips.
  if (session.scanPhase !== _appliedScanPhase) {
    _appliedScanPhase = session.scanPhase;
    if (session.scanPhase === 'pre-mission' && localIsParticipant()) {
      // Dematerialize out of the lobby from the Gantz ball.
      _triggerTransferScan('dematerialize', {
        sourceBall: { x: GANTZ_BALL.x, y: 1.2, z: GANTZ_BALL.y, r: GANTZ_BALL.radius },
      });
      // Stop the ball music a beat after the scan finishes — the scan default
      // is 2.5s; we give the audio a small extra tail so the silence lands as
      // the player has fully disappeared, not mid-beam.
      setTimeout(_stopMusic, 2700);
    } else if (session.scanPhase === 'post-mission' && localIsParticipant()) {
      // Dematerialize out of the field from an overhead satellite beam.
      _triggerTransferScan('dematerialize', {
        source: { x: player.x, y: 8, z: player.y },
      });
    }
  }
  // Flush any pending hits whose bullets have now reached their targets.
  // This must run before AI ticks so a civilian/alien that just died still
  // gets to run its death animation frame this tick.
  processPendingHits();
  // Announce peers the first time their username is known (arrives via pose, not raw join).
  for (const [id, p] of net.peers) {
    if (p.username && !_announcedPeers.has(id)) {
      _announcedPeers.add(id);
      chat.addSystem(`Biological data localized. Reconstructing ${p.username}...`);
    }
  }

  prevPos.clear();
  prevPos.set(player, { x: player.x, y: player.y });

  // Movement relative to camera yaw. W=forward, S=back, A/D strafe.
  const axis = moveAxis();
  const wsIn = -axis.y;   // moveAxis puts W at y=-1 (screen up)
  const adIn =  axis.x;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);      // forward XZ
  const rx =  Math.cos(yaw), rz = -Math.sin(yaw);      // right XZ
  const vx = fx * wsIn + rx * adIn;
  const vz = fz * wsIn + rz * adIn;
  const moving = (vx !== 0 || vz !== 0);
  // ADS disables sprint — aiming down sights forces careful movement in both
  // FP and TP. Any shift input while aiming is ignored for sprint purposes.
  const adsHeld = scene3d.isAds?.() === true;
  sprinting = moving && isDown('shift') && !adsHeld;
  if (wasPressed('x')) walking = !walking;
  if (sprinting) walking = false;
  moveFwd  = moving ? wsIn : 0;
  moveSide = moving ? adIn : 0;
  // ADS slows movement to a deliberate creep in both FP and TP — aiming
  // should trade off mobility for accuracy. Stacks on top of the walk tier
  // so toggled-walk while ADS stays slow, not slower-than-walk×ADS.
  const ADS_SPEED_MUL = 0.7;
  let speedMul = sprinting ? 1.7 : walking ? 0.5 : 1.0;
  if (adsHeld) speedMul = Math.min(speedMul, ADS_SPEED_MUL);
  if (moving) noteActivity();
  // Dead players cannot move in the lobby (alive is only reset to true on MISSION enter)
  if (player.alive) {
    player.x += vx * player.speed * speedMul * dt;
    player.y += vz * player.speed * speedMul * dt;
  }
  // Aim direction = camera. Feet (player.facing) lag behind aim like a typical
  // third-person shooter: hold when idle, rotate toward aim while moving, and
  // snap to catch up if the torso twist gets too extreme.
  const aimFacing = Math.atan2(fz, fx);
  player.aimYaw   = aimFacing;
  player.aimPitch = pitch;
  // Wrap delta into [-π, π]
  let twistDelta = aimFacing - player.facing;
  while (twistDelta >  Math.PI) twistDelta -= 2 * Math.PI;
  while (twistDelta < -Math.PI) twistDelta += 2 * Math.PI;
  const TWIST_LIMIT = Math.PI * 0.55; // ~100°
  if (moving) {
    // Rotate feet toward aim at a rate that catches up smoothly (~0.25 s).
    const k = Math.min(1, dt * 8);
    player.facing += twistDelta * k;
  } else if (Math.abs(twistDelta) > TWIST_LIMIT) {
    // Over-twist snap: rotate feet just enough to stay within the limit.
    const excess = twistDelta - Math.sign(twistDelta) * TWIST_LIMIT;
    player.facing += excess * Math.min(1, dt * 6);
  }
  if (moving) {
    const _prevBob = bobPhase;
    player.walkPhase += dt * (sprinting ? 14 : walking ? 6 : 9);
    bobPhase += dt * (sprinting ? 16 : walking ? 7 : 10);
    bob = Math.abs(Math.sin(bobPhase)) * (sprinting ? 0.055 : walking ? 0.02 : 0.035);
    // Footstep trigger: bob = |sin(bobPhase)| returns to 0 every π radians,
    // which is when a foot plants. Fire a step SFX each time the floor(φ/π)
    // bucket increments — one per foot. _playFootstep picks a sample from the
    // phase-appropriate pool (wood for lobby/briefing/debrief, concrete for
    // mission) and applies per-step pitch/volume jitter. Suppressed while
    // airborne so the jump clip isn't layered with stride samples.
    if (jumpY === 0
        && Math.floor(bobPhase / Math.PI) !== Math.floor(_prevBob / Math.PI)) {
      _playFootstep(sprinting ? 0.55 : walking ? 0.3 : 0.45);
    }
  } else {
    player.walkPhase *= Math.pow(0.05, dt);
    bobPhase *= Math.pow(0.05, dt);
    bob *= Math.pow(0.05, dt);
  }

  // Jump
  if (wasPressed(' ') && jumpY === 0 && player.alive) {
    jumpVY = JUMP_SPEED;
    jumpId++;
    _playJump(0.7);
    jumpMoveFwd  = moveFwd;
    jumpMoveSide = moveSide;
  }
  if (jumpY > 0 || jumpVY > 0) {
    jumpVY -= GRAVITY * dt;
    jumpY = Math.max(0, jumpY + jumpVY * dt);
    if (jumpY === 0) jumpVY = 0;
  }
  // Landing detection: fire the surface's land SFX on the airborne→grounded
  // transition. No-ops for surfaces whose takeoff clip already includes the
  // landing thud (wood).
  if (_prevJumpY > 0 && jumpY === 0) {
    _playJumpLand(0.7);
  }
  _prevJumpY = jumpY;

  if (session.phase === Phase.MISSION) {
    // Civilians are host-authoritative (see broadcastCivs / net.onCivs). Non-host
    // peers receive position + velocity + walkPhase each broadcast and just
    // interpolate visuals from those fields; they must NOT re-simulate locally
    // or they'd diverge from the host's sim.
    if (net.isHost) {
      for (const civ of civilians) {
        if (!civ.alive) continue;
        prevPos.set(civ, { x: civ.x, y: civ.y });
        const v = planCivilian(civ, dt, wanderRng, MISSION_BOUNDS, planWanderer);
        civ.x  += v.vx * dt;
        civ.y  += v.vy * dt;
        civ.vx  = v.vx;   // expose velocity so scene3d can pick the right animation
        civ.vy  = v.vy;
        // Advance walkPhase so legs animate. planWanderer updates it on some
        // branches; for belt-and-braces bump it with current speed here too.
        const spd = Math.hypot(v.vx, v.vy);
        if (spd > 0.1) civ.walkPhase = (civ.walkPhase || 0) + dt * 6;
      }
      // Detonate fused civilians whose fuse has expired. Penalty applies at
      // detonation (not at mark), so a teammate can't "undo" the kill but the
      // shooter gets the full anime-accurate moment of dread first.
      const nowMs = performance.now();
      for (const c of civilians) {
        if (!c.alive || !c.marked) continue;
        const dur = c._markTimeMs != null ? c._markTimeMs : 1500;
        if (nowMs - c.markedAt < dur) continue;
        c.alive = false; c.vx = 0; c.vy = 0;
        const shooterId = c._killerId;
        net.sendKill({ kind: 'civilianPenalty', shooterId });
        net.sendKill({ kind: 'civilianDeath',   id: c.id, shooterId });
        if (shooterId === net.selfId) {
          player.points = Math.max(0, player.points - CIVILIAN_PENALTY);
          player.civiliansKilled += 1;
          missionCivilianKills += 1;
          _sphereSay('civKilledByYou', { dwellMs: 3800, rateLimitMs: 3500, forceShow: true });
        } else if (shooterId) {
          // Host tracks peer points so debrief tallies stay accurate.
          const peer = net.peers.get(shooterId);
          if (peer) peer.points = Math.max(0, (peer.points || 0) - CIVILIAN_PENALTY);
        }
        broadcastCivs();
      }
      if (performance.now() - lastCivsBroadcast > CIVS_BROADCAST_MS) broadcastCivs();
    } else {
      // Non-host: extrapolate between broadcasts using the last-known velocity
      // so civilians glide smoothly. Broadcasts arrive every 100 ms and snap
      // position + velocity back to authoritative values.
      for (const civ of civilians) {
        if (!civ.alive) continue;
        civ.x += (civ.vx || 0) * dt;
        civ.y += (civ.vy || 0) * dt;
        const spd = Math.hypot(civ.vx || 0, civ.vy || 0);
        if (spd > 0.1) civ.walkPhase = (civ.walkPhase || 0) + dt * 6;
      }
    }

    // Alien AI (host authoritative)
    if (net.isHost && aliens.length > 0) {
      // Gather every living mission-participant (local + peers) as alien fodder.
      // Non-participants (still in the lobby) are excluded so aliens don't chase
      // across phase boundaries when a player dies and pops back to the lobby.
      const humanTargets = [];
      if (player.alive && localIsParticipant()) {
        humanTargets.push({ id: player.id, x: player.x, y: player.y, alive: true });
      }
      for (const [id, p] of net.peers) {
        if (!p || p.alive === false) continue;
        if (p.inMission !== true) continue;
        if (p.x == null) continue;
        humanTargets.push({ id, x: p.x, y: p.y, alive: true });
      }
      for (const a of aliens) {
        if (!a.alive) continue;
        const v = planAlien(a, dt, wanderRng, MISSION_BOUNDS, humanTargets);
        a.x += v.vx * dt;
        a.y += v.vy * dt;
        if (a._pendingAttack) {
          const tid = a._pendingAttack.targetId;
          if (tid === player.id) {
            applyDamageToPlayer(a._pendingAttack.damage);
          }
          delete a._pendingAttack;
        }
      }

      tickMarked(aliens, dt, (alien) => {
        // alien died: spawn gib explosion at their last position, award points.
        // Only draw the burst locally if we're in the mission — the host may
        // be spectating from the lobby and shouldn't see the gore.
        const arch = ARCHETYPES[alien.archetype];
        if (session.phase === Phase.MISSION && localIsParticipant()) {
          scene3d.spawnGibs?.(alien.x, alien.y, {
            power: alien.archetype === 'boss' ? 1.7 : alien.archetype === 'brute' ? 1.3 : 1,
            count: alien.archetype === 'boss' ? 48 : alien.archetype === 'brute' ? 36 : 28,
            centerY: (alien.radius || 0.55) * 1.8,
          });
        }
        const points = alien._pointsReward || arch.points || ALIEN_KILL_POINTS_DEFAULT;
        net.sendKill({
          kind: 'alienKilled',
          killerId: alien._killerId,
          alienId: alien.id,
          points,
          archetypeName: arch.name,
        });
        if (alien._killerId === net.selfId) {
          player.points += points;
          missionPointsEarned += points;
          if (alien.isBonusBoss) missionBossKilled = true;
          _sphereSay('alienKilledByYou', { dwellMs: 3200, rateLimitMs: 4500 });
        } else {
          // Trystero has no loopback — the host's onKill listener never fires for
          // kills it broadcasts.  Eagerly update the peer's points here so the host's
          // debrief calculation is accurate without waiting for the next 15Hz pose.
          const killerPeer = net.peers.get(alien._killerId);
          if (killerPeer) killerPeer.points = (killerPeer.points || 0) + points;
        }
      });

      if (performance.now() - lastAliensBroadcast > ALIENS_BROADCAST_MS) broadcastAliens();
    }
  }

  // advance fire cooldown
  if (fireCooldown > 0) fireCooldown -= dt;

  // Only include mission entities in movers when the local player is physically in the mission.
  // Non-participants stay in the lobby (civilians=[], aliens may exist on host but shouldn't
  // push the lobby-positioned player).
  const localInMissionNow = session.phase === Phase.MISSION && localIsParticipant();
  const movers = [
    player,
    ...(localInMissionNow ? civilians : []),
    ...(localInMissionNow ? aliens.filter(a => a.alive) : []),
  ];
  // Sync Gantz panel colliders with the current open progress (lobby only — including
  // non-participants who stay in the lobby while the mission runs elsewhere).
  if (!localInMissionNow) {
    const t = _gantzOpenProgress > 0 ? 1 - Math.pow(1 - _gantzOpenProgress, 2) : 0;
    if (t > 0.08) {
      const d = _PANEL_SLIDE * t;
      const _PO = 1.14; // centroid of 60° sphere arc at R=1.2 (R*sin(halfArc)/halfArc ≈ 1.146)
      gantzPanelLeft.x  = GANTZ_BALL.x - _PO - d;  gantzPanelLeft.y  = GANTZ_BALL.y;            gantzPanelLeft.tier  = 'hard';
      gantzPanelRight.x = GANTZ_BALL.x + _PO + d;  gantzPanelRight.y = GANTZ_BALL.y;            gantzPanelRight.tier = 'hard';
      gantzPanelBack.x  = GANTZ_BALL.x;             gantzPanelBack.y  = GANTZ_BALL.y - _PO - d; gantzPanelBack.tier  = 'hard';

      // Rods & slab: each stretches from a fixed sphere-surface point to the panel inner face.
      // Ball-side end is constant (sphere doesn't move); panel-side end tracks the panel AABB.
      const PH = 0.14; // half of panel AABB thickness (0.28 / 2)

      // Left panel (slides −X) ── rods & slab along 2D X
      { const bs_rod = GANTZ_BALL.x - _R_ROD, bs_slb = GANTZ_BALL.x - _R_SLB;
        const pi = gantzPanelLeft.x + PH;          // panel inner face
        const lr = Math.max(0, bs_rod - pi), cx_r = (bs_rod + pi) / 2;
        const ls = Math.max(0, bs_slb - pi), cx_s = (bs_slb + pi) / 2;
        gantzRodLeftA.x = cx_r; gantzRodLeftA.w = lr; gantzRodLeftA.tier = 'hard';
        gantzRodLeftB.x = cx_r; gantzRodLeftB.w = lr; gantzRodLeftB.tier = 'hard';
        gantzSlabLeft.x  = cx_s; gantzSlabLeft.w  = ls; gantzSlabLeft.tier  = 'hard'; }

      // Right panel (slides +X) ── rods & slab along 2D X
      { const bs_rod = GANTZ_BALL.x + _R_ROD, bs_slb = GANTZ_BALL.x + _R_SLB;
        const pi = gantzPanelRight.x - PH;         // panel inner face
        const lr = Math.max(0, pi - bs_rod), cx_r = (bs_rod + pi) / 2;
        const ls = Math.max(0, pi - bs_slb), cx_s = (bs_slb + pi) / 2;
        gantzRodRightA.x = cx_r; gantzRodRightA.w = lr; gantzRodRightA.tier = 'hard';
        gantzRodRightB.x = cx_r; gantzRodRightB.w = lr; gantzRodRightB.tier = 'hard';
        gantzSlabRight.x  = cx_s; gantzSlabRight.w  = ls; gantzSlabRight.tier  = 'hard'; }

      // Back panel (slides −Y in 2D) ── rods & slab along 2D Y
      { const bs_rod = GANTZ_BALL.y - _R_ROD, bs_slb = GANTZ_BALL.y - _R_SLB;
        const pi = gantzPanelBack.y + PH;          // panel inner face
        const lr = Math.max(0, bs_rod - pi), cy_r = (bs_rod + pi) / 2;
        const ls = Math.max(0, bs_slb - pi), cy_s = (bs_slb + pi) / 2;
        gantzRodBackA.y = cy_r; gantzRodBackA.h = lr; gantzRodBackA.tier = 'hard';
        gantzRodBackB.y = cy_r; gantzRodBackB.h = lr; gantzRodBackB.tier = 'hard';
        gantzSlabBack.y  = cy_s; gantzSlabBack.h  = ls; gantzSlabBack.tier  = 'hard'; }
    } else {
      gantzPanelLeft.tier = gantzPanelRight.tier = gantzPanelBack.tier = 'decorative';
      gantzRodLeftA.tier  = gantzRodLeftB.tier  = gantzSlabLeft.tier  = 'decorative';
      gantzRodRightA.tier = gantzRodRightB.tier = gantzSlabRight.tier = 'decorative';
      gantzRodBackA.tier  = gantzRodBackB.tier  = gantzSlabBack.tier  = 'decorative';
    }

    // Sync door colliders — hard when closed, decorative (ignored) when open.
    for (let i = 0; i < _doorColliders.length; i++) {
      _doorColliders[i].tier = _doorOpen[i] ? 'decorative' : 'hard';
    }
  }

  for (const e of movers) resolveAgainstStatic(e, activeColliders);

  // NPC-vs-NPC overlap resolution (symmetric) — civilians and aliens don't stack.
  const npcMovers = movers.filter(e => e !== player);
  resolveCharacterOverlaps(npcMovers);

  // Player nudges civilians/aliens/remote-peers: only the other entity moves, never the player.
  // Apply a fraction of overlap depth per frame so it feels like a gentle drift, not a snap.
  const NUDGE = 0.15;
  if (player.alive) {
    // Civilians & aliens (game-authoritative — move their real positions)
    // Broadcast civilian nudges so all peers move their local copy of that civilian.
    for (const other of npcMovers) {
      if (other.alive === false) continue;
      const hit = circleVsCircle(
        player.x, player.y, player.radius || 0.35,
        other.x,  other.y,  other.radius  || 0.35,
      );
      if (hit) {
        const dx = -hit.nx * hit.depth * NUDGE;
        const dy = -hit.ny * hit.depth * NUDGE;
        other.x += dx;
        other.y += dy;
        if (other.kind === 'civilian' && other.id) {
          net.sendNudge({ kind: 'civ', id: other.id, dx, dy });
        }
      }
    }
    // Remote players: check against rendered position, but nudge the lerp TARGET (pr.x/pr.y)
    // so the render follows smoothly and doesn't snap back every frame.
    // Also send a nudge message to that peer so they move in their own game.
    // Cross-zone peers (lobby ↔ mission) have no physical interaction — their
    // rendered position lives in a different room and pushing each other
    // would make lobby players drag mission players around (and vice versa).
    for (const [peerId, pr] of net.peers) {
      if (pr.renderX == null || pr.alive === false) continue;
      if (!sameZoneAsLocal(peerId)) continue;
      const hit = circleVsCircle(
        player.x,   player.y,   player.radius || 0.35,
        pr.renderX, pr.renderY, 0.35,
      );
      if (hit) {
        const dx = -hit.nx * hit.depth * NUDGE;
        const dy = -hit.ny * hit.depth * NUDGE;
        pr.x += dx;
        pr.y += dy;
        net.sendNudge({ dx, dy }, peerId);
      }
    }
  }

  if (session.phase === Phase.MISSION) {
    for (const civ of civilians) {
      if (!civ.alive || civ.behavior !== 'patrol' && civ.behavior !== 'hero') continue;
      const p = prevPos.get(civ);
      if (p) checkStuckWanderer(civ, p.x, p.y, dt, wanderRng);
    }
  }

  // Non-participants remain physically in the lobby even while phase === MISSION,
  // so they should be able to interact with the Gantz ball as normal.
  const inLobbyScene =
    session.phase === Phase.LOBBY ||
    session.phase === Phase.DEBRIEF ||
    session.phase === Phase.BRIEFING ||
    (session.phase === Phase.MISSION && !localIsParticipant());

  if (inLobbyScene) {
    const dBall = Math.hypot(player.x - GANTZ_BALL.x, player.y - GANTZ_BALL.y);
    const gantzTalking = (_introStartTime !== -1 && !_introDone) || (_namePromptPhase !== 'idle' && !_namePromptDone) || (!_gantzTalkDone && !!_gantzTalkLines) || (!_gantzExitDone && _gantzExitStart !== -1);
    const _countdownNow = session.readyCountdownEnd >= 0 && session.phase !== Phase.BRIEFING && session.phase !== Phase.MISSION;
    const _briefingNow = session.phase === Phase.BRIEFING;
    // Queue toggle is available during the ready-countdown and during briefing —
    // players can change their mind right up until the mission teleport fires.
    const _queueToggleNow = _countdownNow || _briefingNow;
    const _canInteract = !player.ready || _queueToggleNow;
    if (dBall < INTERACT_RADIUS && wasPressed('e') && !chat.isOpen?.() && _gantzSpeechSkippable()) {
      _skipGantzSpeech();
    } else if (dBall < INTERACT_RADIUS && wasPressed('e') && !menu.isOpen() && !chat.isOpen?.() && !gantzTalking && _canInteract && performance.now() - _menuClosedAt > 250) {
      if (_queueToggleNow) {
        // During the countdown or briefing, pressing E toggles the queue directly.
        player.ready = !player.ready;
        if (!player.ready) player.afkReady = false;
        net.broadcastPose();
      } else {
        menu.openMenu();
      }
    }
  }

  // ── Lobby door interaction ───────────────────────────────────────────────
  if (inLobbyScene && !menu.isOpen() && !chat.isOpen?.()) {
    for (let di = 0; di < _LOBBY_DOORS.length; di++) {
      const door = _LOBBY_DOORS[di];
      const dd = Math.hypot(player.x - door.x, player.y - door.y);
      if (dd < DOOR_INTERACT_RADIUS && wasPressed('e')) {
        _doorOpen[di] = !_doorOpen[di];
        break; // consume E for this frame
      }
    }
  }

  // ── Peer door state sync ────────────────────────────────────────────────────
  if (inLobbyScene) {
    for (const pr of net.peers.values()) {
      if (!Array.isArray(pr.doorStates)) continue;
      for (let i = 0; i < _doorOpen.length; i++) {
        const cur = !!pr.doorStates[i];
        const prev = pr._prevDoorStates ? !!pr._prevDoorStates[i] : null;
        if (prev === null || cur !== prev) _doorOpen[i] = cur;
      }
      pr._prevDoorStates = pr.doorStates.slice();
    }
  }

  // ── Jam Portal interaction ───────────────────────────────────────────────────
  if (inLobbyScene && !menu.isOpen() && !chat.isOpen?.() && !_portalBusy) {
    const dp = Math.hypot(player.x - _PORTAL_POS.x, player.y - _PORTAL_POS.y);
    if (dp < _PORTAL_RADIUS && wasPressed('e')) {
      _portalBusy = true;
      Portal.sendPlayerThroughPortal('https://callumhyoung.github.io/gamejam1-lobby/', {
        username: player.username || 'Hunter',
        color:    (player.color || 'c8142b').replace('#', ''),
        speed:    5,
      });
    }
  }

  const nowMs = Date.now(); // wall-clock ms — synchronized across peers unlike performance.now()
  hostTick(nowMs);
  updatePhaseTimers(nowMs);
  if (session.phase === Phase.MISSION && localIsParticipant()) updateMissionTargetsHUD();

  net.tick(dt);

  const cam = renderer.getCamera();
  const k = Math.min(1, dt * 8);
  renderer.setCamera({
    x: cam.x + (player.x - cam.x) * k,
    y: cam.y + (player.y - cam.y) * k,
    zoom: 1.1,
  });

  // Mouse "world target" in FP mode = camera forward projected a long way.
  // Retained for compat with any legacy getMouse consumers.
  const fwd = scene3d.getCameraForwardXZ();
  setMouseWorld(player.x + fwd.x * 20, player.y + fwd.y * 20);

  world.time += dt;
  endFrameInput();
}

// Pending tracers to hand off to the 3D scene once per frame.
// Replaces the old per-frame 2D tracer ring; scene3d manages its own TTL.
let _pendingTracers = [];
function emitTracer(t) { _pendingTracers.push(t); }

function render(dt, alpha = 1) {
  const inMission = session.phase === Phase.MISSION;
  const _now = performance.now();

  // Fixed-timestep render interpolation for the local player's pose. The
  // simulation advances at 60Hz but displays commonly run at 120–165Hz, so
  // between update ticks player.x/y is stale for several render frames —
  // which reads as strafe-stutter relative to objects that are interpolated
  // every render frame. Lerp player.x/y from their pre-update snapshot
  // (prevPos) toward the current value by `alpha` (fraction into the next
  // fixed step). We temporarily overwrite player.x/y so downstream camera
  // + remotes-list code consumes the smoothed values, then restore after.
  const _pp = prevPos.get(player);
  let _realPx, _realPy;
  if (_pp && alpha < 1) {
    _realPx = player.x; _realPy = player.y;
    player.x = _pp.x + (_realPx - _pp.x) * alpha;
    player.y = _pp.y + (_realPy - _pp.y) * alpha;
  }

  // localInMission: true only when this player physically entered the mission.
  // Non-participants keep their lobby position + lobby room even while phase === MISSION.
  const localInMission = inMission && localIsParticipant();

  // Cross-zone cull: hide any peer whose zone differs from the local player's.
  // This MUST run every frame regardless of local phase — a lobby client's
  // session.phase can lag behind the host's transition to MISSION, so gating
  // the cull on `inMission` (local's phase) lets mission players render in
  // the lobby during the transition window. We now use a per-peer broadcast
  // flag (`p.inMission`) as the primary truth source and OR it with the
  // legacy signals so old clients / races still cull correctly.
  // Failure modes this guards against (all previously seen as bugs):
  //   • Host migration leaving session.participants briefly stale.
  //   • Local client hasn't received session broadcast for MISSION yet while
  //     remote peer has already teleported into the mission.
  //   • Remote peer's `ready` flag lags relative to their physical position.
  // See project_gantz.md: "Cross-zone visibility cull".
  const parts = session.participants;

  const remotes = [];
  for (const [peerId, p] of net.peers) {
    if (p.x == null) continue;
    const peerInMission =
      (p.inMission === true)
      || (session.phase === Phase.MISSION && parts ? parts.includes(peerId) : false)
      || (session.phase === Phase.MISSION && !!p.ready);
    if (localInMission !== peerInMission) continue;
    // Spawn-grace gate: hold a brand-new peer out of scene3d until their scan
    // descriptor reaches us, so scene3d never creates an un-scanned full-body
    // entry for a peer that's about to beam in.
    if (p.scan) _remoteSawScan.add(peerId);
    if (!_remoteFirstSeen.has(peerId)) _remoteFirstSeen.set(peerId, _now);
    if (!_remoteSawScan.has(peerId)
        && (_now - _remoteFirstSeen.get(peerId)) < REMOTE_SPAWN_GRACE_MS) continue;
    const bubble = _chatBubbles.get(peerId);
    const bubbleAlive = bubble && _now < bubble.expiresAt;
    remotes.push({
      peerId,
      spec: getRemoteSpec(peerId, p.specSeed),
      x: p.renderX, y: p.renderY,
      facing: p.facing || 0,
      aimYaw:   p.aimYaw   != null ? p.aimYaw   : (p.facing || 0),
      aimPitch: p.aimPitch != null ? p.aimPitch : 0,
      walkPhase: p.walkPhase || 0,
      alive: p.alive !== false,
      username: p.username || '?',
      suit: p.loadout?.suit && p.loadout.suit !== 'basic',
      jumpY: p.renderJumpY || 0,
      jumpId: p.jumpId || 0,
      jumpMoveFwd:  p.jumpMoveFwd  || 0,
      jumpMoveSide: p.jumpMoveSide || 0,
      sprinting:  !!p.sprinting,
      walking:    !!p.walking,
      ads:        !!p.ads,
      fireId:     p.fireId    || 0,
      moveFwd:  p.moveFwd  || 0,
      moveSide: p.moveSide || 0,
      chatText:  bubbleAlive ? bubble.text : null,
      chatAlpha: bubbleAlive ? Math.min(1, (bubble.expiresAt - _now) / 1000) : 0,
    });
  }

  const focus = player;

  const newTracers = _pendingTracers;
  _pendingTracers = [];

  // Drive Gantz ball open/close progress.
  // Opens once briefing content finishes + linger+fade (3700 ms) → triggers countdown.
  // The racks sweep out fast (1.5 s) and close over 1 s after mission starts.
  {
    const OPEN_START_MS  = 3700; // matches BFADE_LINGER_MS + BFADE_CONTENT_MS in _drawBallMenu
    const OPEN_SPEED     = 1 / 3.5;
    const CLOSE_SPEED    = 1 / 3.0;
    const wantOpen = _debugGantzForceOpen || (session.phase === Phase.BRIEFING
      && _briefingContentDoneAt > 0
      && (performance.now() - _briefingContentDoneAt) >= OPEN_START_MS);
    if (wantOpen) {
      if (!_gantzWasOpening) {
        // Rising edge — ball just started opening
        audio.playAt(SFX_GANTZ_OPEN, GANTZ_BALL.x, GANTZ_BALL.y, { volume: 0.12, maxDist: 60 });
      }
      _gantzOpenProgress = Math.min(1, _gantzOpenProgress + dt * OPEN_SPEED);
    } else {
      if (_gantzWasOpening && session.phase !== Phase.MISSION) {
        // Falling edge — ball just started closing (suppress during mission entry)
        audio.playAt(SFX_GANTZ_OPEN, GANTZ_BALL.x, GANTZ_BALL.y, { volume: 0.12, maxDist: 60 });
      }
      _gantzOpenProgress = Math.max(0, _gantzOpenProgress - dt * CLOSE_SPEED);
    }
    _gantzWasOpening = wantOpen;
  }

  scene3d.render({
    // Non-participants stay in the lobby room even while phase===MISSION globally.
    // Pass Phase.LOBBY for them so scene3d doesn't switch to the mission room/props/weapon.
    phase: localInMission ? session.phase : (inMission ? Phase.LOBBY : session.phase),
    missionSeed: session.missionSeed,
    lobbySeed: session.lobbySeed,
    missionMap,
    missionProps,
    lobbyProps: props,
    gantzBallPos: localInMission ? null : GANTZ_BALL,
    gantzOpenProgress: _gantzOpenProgress,
    player: {
      ...player,
      suit: player.loadout?.suit && player.loadout.suit !== 'basic',
      moveFwd, moveSide, walking, sprinting,
      jumpId, fireId,
      jumpMoveFwd, jumpMoveSide,
      jumpY,
    },
    civilians: localInMission ? civilians : [],
    aliens: localInMission ? aliens : [],
    remotes,
    newTracers,
    focus: { x: focus.x, y: focus.y },
    time: world.time,
    firstPerson: !scene3d.isThirdPerson(),
    yaw,
    pitch,
    bob,
    jumpY,
    playerAlive: player.alive,
    doorStates: _doorOpen.map(o => o ? 1 : 0),
  }, dt || 1 / 60);

  // Decay the dynamic crosshair spread toward resting and push to CSS.
  updateCrosshairSpread(dt || 1 / 60);

  // Update the proximity-audio listener so every sound this frame attenuates
  // / pans relative to the local player's current position + facing.
  audio.setListener(player.x, player.y, yaw);

  // Remote-peer footsteps: detect when any peer's walkPhase crosses a new
  // π-bucket (one per foot) and play a positional step SFX at their spot.
  // Gated on sameZoneAsLocal so lobby spectators don't hear mission steps
  // and vice versa, and on the local surface phase being lobby-side (we
  // don't have mission surface SFX yet).
  {
    for (const [peerId, peer] of net.peers) {
      if (!peer) continue;
      if (peer.x == null || peer.y == null) continue;
      if (!sameZoneAsLocal(peerId)) continue;
      const wp = peer.walkPhase || 0;
      const bucket = Math.floor(wp / Math.PI);
      const prev = _peerStepBucket.get(peerId);
      const airborne = (peer.jumpY || 0) > 0;
      if (!airborne && prev != null && bucket !== prev) {
        _playFootstep(0.4, peer.x, peer.y);
      }
      _peerStepBucket.set(peerId, bucket);

      const jid = peer.jumpId || 0;
      const pjid = _peerJumpId.get(peerId);
      if (pjid != null && jid > pjid) {
        _playJump(0.5, peer.x, peer.y);
      }
      _peerJumpId.set(peerId, jid);

      const wasAirborne = _peerAirborne.get(peerId) === true;
      const isAirborne = (peer.jumpY || 0) > 0;
      if (wasAirborne && !isAirborne) {
        _playJumpLand(0.5, peer.x, peer.y);
      }
      _peerAirborne.set(peerId, isAirborne);
    }
  }

  // Gantz ball music state machine. Music starts when a mission ready queue
  // is running (LOBBY/DEBRIEF with readyCountdownEnd >= 0). It stops when the
  // queue empties without a mission start; the pre-mission scan branch above
  // handles stopping when players ARE sent away. Phase has to include BRIEFING
  // because readyCountdownEnd is cleared the instant briefing begins — we
  // keep the music alive through briefing until the dematerialize fires.
  const _queueInLobbyPhase = session.phase === Phase.LOBBY
                          || session.phase === Phase.DEBRIEF;
  const _queueArmed = _queueInLobbyPhase && session.readyCountdownEnd >= 0;
  if (_queueArmed && !_musicQueueWasArmed) {
    _ensureMusicPlaying();
  } else if (!_queueArmed && _musicQueueWasArmed) {
    // Only stop here when the queue cleared while still in the lobby. When the
    // queue drops because we advanced to BRIEFING/MISSION, the pre-mission
    // scan path (above) is in charge of stopping the music instead.
    if (_queueInLobbyPhase) _stopMusic();
  }
  _musicQueueWasArmed = _queueArmed;

  // Weather ambience — ties the loop to physical presence in the lobby scene
  // (non-participants during MISSION still hear lobby weather).
  const _inLobbyForAudio = session.phase === Phase.LOBBY
                        || session.phase === Phase.DEBRIEF
                        || session.phase === Phase.BRIEFING
                        || (session.phase === Phase.MISSION && !localIsParticipant());
  _syncWeatherAudio(_inLobbyForAudio);
  _tickLightningAudio(_inLobbyForAudio);

  // Draw menu content onto the ball surface canvas
  _drawBallMenu();

  // update world-prompt HTML overlays (Gantz interact, door, portal)
  updateWorldHtmlOverlays();

  // Gantz Neural HUD (new)
  _tickGantzHudFrame(dt || 1 / 60);

  // Restore the simulation-authoritative player pose so the next update()
  // step runs against the real state, not our interpolated render copy.
  if (_realPx !== undefined) { player.x = _realPx; player.y = _realPy; }
}

function applyDamageToPlayer(amount) {
  if (!player.alive) return;
  player.hp = Math.max(0, player.hp - amount);
  if (player.hp <= 0) {
    toast('You died. Returning to lobby.', 'warn');
    _sendLocalPlayerToLobby();
  } else {
    toast(`-${amount} hp`, 'warn');
  }
  updateWeaponHUD();
}

// Yank the local player out of the current mission and drop them in the lobby
// alive. Mission continues for everyone else; session.participants is
// host-authoritative so remote peers still treat us as a (temporarily absent)
// participant until the host ends the mission and broadcasts DEBRIEF.
function _sendLocalPlayerToLobby() {
  const suit = SUITS[player.loadout?.suit || 'basic'];
  player.hp = suit.maxHp;
  player.alive = true;
  player.ready = false;   // localIsParticipant() → false → localInMission flips off
  player.afkReady = false;
  _wasInMission = false;  // prevent enterPhase(LOBBY) from re-firing the lobby scan
  teleportToLobby();
  activeColliders = lobbyColliders;
  tracers = [];
  requestAnimationFrame(() => _triggerTransferScan('materialize'));
  net.broadcastPose?.();
  updateWeaponHUD();
}

// Update targets in mission HUD
const mhTargetsEl = document.getElementById('mh-targets');
function updateMissionTargetsHUD() {
  if (!mhTargetsEl) return;
  if (session.phase !== Phase.MISSION) { mhTargetsEl.innerHTML = ''; return; }
  const total = aliens.length;
  const alive = aliens.filter(a => a.alive).length;
  const dead = total - alive;
  mhTargetsEl.innerHTML = `
    <div class="t-row"><span>targets</span><span>${alive} / ${total}</span></div>
    <div class="t-row dead"><span>killed</span><span>${dead}</span></div>
  `;
}

refreshPhaseOverlay();
initGantzHud({ drawAlienPortrait });
// Default to third-person on first-time entry only. After this, the player
// owns the camera — we don't reset it on phase transitions between lobby and
// mission; scroll wheel switches modes.
scene3d.setThirdPerson?.(true);
startLoop({ update, render });

// First load: arrival in the lobby is itself a Gantz teleport. Wait for the
// FBX character assets to load AND for a few stable frames before firing —
// otherwise the scan runs during the asset-load frame-time spikes (FBX parse,
// GLB weapon, shader compile) and visibly stutters. The scan also has to
// attach AFTER the FBX entry replaces the procedural fallback, otherwise the
// material patch gets thrown away when the pool swaps in.
(function scheduleInitialScan() {
  const startedAt = performance.now();
  const MAX_WAIT_MS = 6000;      // hard ceiling — fire even if frames never stabilise
  const STABLE_FRAMES = 3;       // small burst of clean frames is enough
  const STABLE_DT_MS = 40;       // tolerate slower machines
  const POST_READY_DELAY_MS = 150;
  let stable = 0;
  let readyAt = 0;
  let lastT = performance.now();
  function fire() { try { _triggerTransferScan('materialize'); } catch (e) { console.warn('[scan] initial fire failed:', e); } }
  function tick(t) {
    const dt = t - lastT; lastT = t;
    const ready = scene3d.isCharReady?.() ?? true;
    if (ready && !readyAt) readyAt = t;
    // Fire as soon as char is ready, we've waited the post-ready delay, AND a
    // small burst of fast frames confirms assets have settled. Either way, max
    // 6s from page load — never leave the scan un-fired, since that also means
    // no peer would ever see us materialise into the lobby.
    if (ready && dt < STABLE_DT_MS) stable++;
    else stable = 0;
    const postReadyOk = readyAt && (t - readyAt) >= POST_READY_DELAY_MS;
    const shouldFire =
      (ready && postReadyOk && stable >= STABLE_FRAMES)
      || (performance.now() - startedAt) >= MAX_WAIT_MS;
    if (shouldFire) { fire(); return; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

window.__gantz = {
  player, props, walls: lobbyWalls, staticColliders: lobbyColliders, world, renderer,
  net, chat, menu, session, scene3d,
  roster: () => roster,
  missionMap: () => missionMap,
  civilians: () => civilians,
  aliens: () => aliens,
  tryFire,
  forceReady: () => { player.ready = true; net.broadcastPose(); },
  forceDebrief: (opts = {}) => {
    _missionStartPts = new Map();
    _missionStartPts.set('local', player.points - (opts.localPts ?? 150));
    session.phase = 'DEBRIEF';
    session.missionIndex = opts.missionIndex ?? 1;
    session.missionResult = opts.wiped ? 'wiped' : 'cleared';
    session.missionStats = { pointsEarned: opts.localPts ?? 150, civilianKills: opts.civKills ?? 0, bossKilled: opts.boss ?? false, playerDied: opts.died ?? false, npcDeaths: 0 };
    session.debriefEndsAt = Date.now() + 25000;
    enterPhase('DEBRIEF');
  },
};
