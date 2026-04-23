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
const BRIEFING_MS = 30000;
const MISSION_BASE_MS = 30000;
const DEBRIEF_MS = 25000;
const SESSION_REBROADCAST_MS = 1500;
const READY_COUNTDOWN_MS = 10000;
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
  ["I keep records.", "You're currently unnamed.", "That's unacceptable.", "Fix it."],
  ["Something to call you.", "Anything.", "Within reason."],
  ["Your designation.", "I'm waiting."],
  ["I've processed billions of names.", "Yours isn't one of them yet.", "Type it."],
  ["Name first.", "Everything else second."],
  ["You exist in my system as a random string.", "That ends now.", "Name."],
  ["I don't call hunters by number.", "I call them by name.", "Give me one."],
  ["Before the mission.", "Before anything.", "I need a name."],
  ["I've had hunters go nameless.", "It didn't end well.", "Not because of the name.", "But still.", "Type something."],
  ["What should I engrave on the memorial.", "If it comes to that.", "Name."],
  ["Everyone who comes through here gets a name in my records.", "You're no exception.", "Type it."],
  ["I don't do small talk.", "I do need a name.", "So.", "Name."],
  ["You have a name.", "I can tell.", "Type it."],
  ["I've been doing this long enough to know.", "Names matter.", "Give me yours."],
  ["Your name.", "Not your title.", "Not your history.", "Just the name.", "Now."],
  ["I need something to call you when you do something stupid.", "And you will.", "Name."],
  ["Identification.", "It's not optional."],
  ["The field requires a name.", "Fill it."],
  ["I catalog every hunter.", "You're currently uncatalogued.", "Correct that."],
  ["You want to be remembered.", "Start with a name."],
  ["I don't forget.", "Give me something worth remembering."],
  ["You're in my system.", "Currently as 'unknown'.", "That's not a name.", "Give me one."],
  ["Name.", "Short, if possible.", "You're not the only one with things to do."],
  ["What do I call you when things go wrong.", "They will go wrong.", "Name."],
  ["I've seen hunters come through here with worse names than whatever you're about to type.", "Probably.", "Let's find out."],
  ["Your name.", "I'm not going to ask again.", "Well.", "I'll ask once more after this.", "But then I stop asking."],
  ["Type your name.", "Or don't.", "You'll need one eventually.", "Better now."],
  ["I store names.", "Not faces.", "Not feelings.", "Names.", "Give me yours."],
  ["Before anything else.", "This.", "Name."],
  ["I'd prefer to know what to call you.", "Before the chaos starts.", "Name."],
];

function _pickNameResponse(name) {
  const n = name || 'nothing';
  const pool = [
    [n + ".", "I've stored worse.", "Not many. But a few."],
    [n + ".", "Fine.", "The aliens won't ask.", "I'll remember it whether I want to or not."],
    [n + ".", "I've processed that.", "It doesn't change anything.", "Move."],
    ["You chose that.", "Voluntarily.", "I'll call you " + n + ".", "We'll both have to live with it."],
    [n + ".", "Efficient.", "Disappointing.", "Let's go."],
    [n + ".", "That's what you want on record.", "Fine.", "Don't embarrass it."],
    ["I've heard worse names.", n + " is among them.", "Let's proceed."],
    [n + ".", "Your parents had expectations.", "Don't let them down.", "It won't affect the mission either way."],
    [n + ".", "Recorded.", "I'll try not to use it sarcastically.", "Frequently."],
    [n + ".", "The last hunter with a name like that didn't finish.", "You might.", "Probably won't.", "But might."],
    [n + ".", "I'll remember it.", "I remember everything.", "That's not a compliment."],
    ["Interesting.", n + ".", "I'll reserve judgment.", "No I won't.", "It's adequate."],
    [n + ".", "It's a name.", "It will do.", "Most things that just do are all that's required."],
    [n + ".", "Fine.", "I've processed it.", "It tells me more about you than you intended."],
    [n + ".", "You could have picked something stronger.", "You didn't.", "Noted."],
    [n + ".", "I've stored it.", "I've stored better.", "But you're here now, so."],
    ["Recorded.", n + ".", "Don't make me regret it."],
    [n + ".", "That's the name you're going with.", "Acceptable.", "Barely."],
    [n + ".", "I've processed worse designations.", "Not recently.", "But historically."],
    ["So.", n + ".", "I'll try to say it with a straight face.", "I don't have a face.", "Advantage mine."],
    [n + ".", "Filed.", "Don't die before it means anything."],
    ["I'll call you " + n + ".", "The aliens will call you prey.", "One of us is being more honest."],
    [n + ".", "Stored.", "Associated with your biometrics.", "You can't take it back.", "Good."],
    ["That's your name.", n + ".", "I would have picked something more threatening.", "But I wasn't asked."],
    [n + ".", "It has a certain quality.", "I won't specify what quality.", "It's not a compliment."],
    ["You picked " + n + ".", "That says something about you.", "I'm still deciding what."],
    [n + ".", "Noted.", "The missions don't care what I call you.", "I do.", "Slightly."],
    ["So you're " + n + ".", "Interesting.", "No.", "Not really.", "But proceed."],
    [n + ".", "Every hunter gets a name in my records.", "Not all of them keep it.", "Try to keep yours."],
    [n + ".", "I've had hunters with stronger names die immediately.", "Names don't save anyone.", "But yours is filed."],
    [n + ".", "Your parents named you that.", "Or you chose it yourself.", "Either way it's yours now.", "Make it mean something."],
    ["Logged.", n + ".", "If you survive long enough, I might use it approvingly.", "Don't count on it."],
    [n + ".", "I'll remember it long after you've forgotten what you came here for.", "I remember everything."],
    ["You typed " + n + ".", "Without hesitation.", "That's either confidence or a lack of imagination.", "I haven't decided."],
    [n + ".", "It's serviceable.", "Like most things about you.", "Probably.", "We'll see."],
    ["I'll be saying that name for a while.", n + ".", "Or a short while.", "Depending on how you perform."],
    [n + ".", "A name carries weight.", "Yours is going to have to earn some.", "Starting now."],
    [n + ".", "I've catalogued it.", "I've catalogued everything.", "It's less impressive than it sounds."],
    ["So " + n + " is what I'll be working with.", "Fine.", "I've worked with less."],
    [n + ".", "I won't say I like it.", "I won't say I don't.", "I'll say it's stored.", "That's enough."],
    ["Every hunter thinks their name sounds tough.", n + ".", "I've heard tougher.", "I've heard worse.", "Yours is in the middle."],
    [n + ".", "The sphere has processed millions of names.", "Yours is now one of them.", "Don't read into that."],
    [n + ".", "Short.", "Fine.", "The aliens don't give you time for long names anyway."],
    [n + ".", "Three letters.", "Fine.", "Less to engrave if necessary."] ,
    ["I'll address you as " + n + ".", "I'll do so without enthusiasm.", "That's just how I do things.", "Don't take it personally."],
    [n + ".", "Registered.", "Now stop stalling."],
    ["You said " + n + ".", "I heard it.", "I'll remember it.", "Begin."],
    [n + ".", "That's fine.", "Everything here is fine.", "Fine doesn't mean good.", "Move."],
    [n + ".", "It'll do.", "You'll do.", "Neither of you has a choice.", "Let's go."],
    [n + ".", "I've said worse.", "To worse hunters.", "You're not the worst.", "Yet.", "Move."],
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
function _gantzPickLines(pool) {
  const entry = pool[Math.floor(Math.random() * pool.length)];
  let names = null;
  return entry.map(line => {
    let out = line;
    if (out.indexOf('{name}') >= 0) {
      if (!names) names = _gantzParticipantNames();
      const target = names.length
        ? names[Math.floor(Math.random() * names.length)]
        : 'hunter';
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
];


let _gantzMockeryNextAt = -1;  // ms timestamp — when to fire next line
let _gantzMockeryIndex  = -1;  // shuffled index into combined line pool

function _gantzMockeryTick(nowMs, participants) {
  if (!net.isHost) return;
  if (session.phase !== Phase.MISSION) return;
  if (_gantzMockeryNextAt < 0) {
    // First message: 20–40s into the mission
    _gantzMockeryNextAt = nowMs + 20000 + Math.random() * 20000;
    return;
  }
  if (nowMs < _gantzMockeryNextAt) return;

  // Schedule next: every 25–55s
  _gantzMockeryNextAt = nowMs + 25000 + Math.random() * 30000;

  // Single unified mission pool — some entries contain {name}, the picker
  // substitutes randomly with a live participant's username. Multi-sentence
  // entries are joined with " " for the single-row chat format.
  const lines = _gantzPickLines(_GANTZ_MISSION);
  net.sendChat(lines.join(' '), 'GANTZ', '00e05a');
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
const SFX_GUN_SHOOT  = 'assets/audio/x-gun-shoot.mp3';
const SFX_GANTZ_OPEN = 'audio/gantz-open.mp3';
audio.preload([SFX_GUN_SHOOT, SFX_GANTZ_OPEN]);
const _gunFlashEl = document.getElementById('gun-flash');

// ── Dynamic crosshair state ───────────────────────────────────────────────
// Pixels the four crosshair ticks are pushed outward from center. Each shot
// adds `bumpCrosshairSpread(amount)` and the value lerps back to 0 every
// render frame. Kept purely client-local — no networking.
const _crosshairEl        = document.getElementById('crosshair');
const CROSSHAIR_SPREAD_MAX   = 44;   // px — cap on how far ticks can splay
const CROSSHAIR_SPREAD_DECAY = 90;   // px/sec — rate of return to rest
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
let _countdownRevealAt = -1;
let _debriefRevealAt = -1;
let _debriefAllDoneAt = -1;
let _debriefDisplayDone = false;
let _debriefPlayers = [];
let _missionStartPts = new Map();
let _idleNextAt = -1;
let _idleLineStart = -1;
let _idleCurrentLines = null;
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

  if (justOpened || isBriefing || isDebrief) {
    _idleLineStart = -1;
    _idleCurrentLines = null;
    if (justOpened) _idleNextAt = performance.now() + IDLE_COOLDOWN_MS;
  }

  const countdownActive = session.readyCountdownEnd >= 0 && !isBriefing;
  if (!countdownActive) _countdownRevealAt = -1;
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
    rows.push({ text: 'CHARACTERISTIC', font: `11px ${_PF}`, color: DL, charMs: BCHAR, gapAfter: 200, lineH: 22 });
    rows.push({ text: charStr, font: `11px ${_PF}`, color: B, charMs: BCHAR, gapAfter: 200, lineH: 22 });
    rows.push({ text: '',         font: `11px ${_PF}`, color: DL, charMs: 0,     gapAfter: 0,    lineH: 12 });
    rows.push({ text: 'FAVORITE THING', font: `11px ${_PF}`, color: DL, charMs: BCHAR, gapAfter: 200, lineH: 22 });
    rows.push({ text: fav, font: `11px ${_PF}`, color: B, charMs: BCHAR, gapAfter: 300, lineH: 30 });

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

    // Post-content timing: linger → fade out content → fade in countdown
    const BFADE_LINGER_MS    = 3000;
    const BFADE_CONTENT_MS   = 700;
    const BCLOCK_FADE_IN_MS  = 900;
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

    // 15-second countdown fades in after briefing content fades away
    if (clockAlpha > 0) {
      const remain = Math.max(0, session.briefingEndsAt - Date.now());
      const sec    = Math.ceil(remain / 1000);
      const segW = 36, segH = 68, segT = 7;
      const segY   = S * 0.28;
      const dOnCol  = sec <= 3 ? R : B;
      const dOffCol = 'rgba(0,180,60,0.10)';
      ctx.save();
      ctx.globalAlpha *= clockAlpha;
      _draw7SegClock(ctx, sec, CX, segY, segW, segH, segT, dOnCol, dOffCol);
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
    const LABEL    = 'MISSION QUEUE';
    const CCHAR    = 40;
    const labelChars = Math.min(LABEL.length, Math.floor(cElapsed / CCHAR));
    const labelDone  = labelChars >= LABEL.length;
    _typeTickSound(6000, !labelDone);

    const segW = 36, segH = 68, segT = 7;
    const segY = S * 0.22;
    const offCol = 'rgba(0,180,60,0.12)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `10px ${_PF}`; ctx.fillStyle = labelDone ? DL : G;
    ctx.fillText(LABEL.slice(0, labelChars), CX, segY - 24);
    if (labelDone) {
      const CLOCK_DELAY_MS = 1000;
      const CLOCK_FADE_MS  = 1200;
      const sinceLabel = cElapsed - LABEL.length * CCHAR;
      const clockAlpha = Math.min(1, Math.max(0, (sinceLabel - CLOCK_DELAY_MS) / CLOCK_FADE_MS));
      const secs = Math.max(0, Math.ceil((session.readyCountdownEnd - Date.now()) / 1000));
      ctx.save();
      ctx.globalAlpha = clockAlpha;
      _draw7SegClock(ctx, secs, CX, segY, segW, segH, segT, B, offCol);

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
    }
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
      const secs = Math.max(0, Math.ceil((session.readyCountdownEnd - Date.now()) / 1000));
      ctx.font = `10px ${_PF}`; ctx.fillStyle = DL; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('MISSION QUEUE', CX, y);
      y += 20;
      ctx.font = `22px ${_PF}`; ctx.fillStyle = B;
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
  version: 0,
};
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
let spectateIndex = 0;
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
    net.broadcastPose();
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
    marked: a.marked, markedAt: a.markedAt,
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
    }
    a.x = d.x; a.y = d.y; a.facing = d.facing; a.walkPhase = d.walkPhase;
    a.hp = d.hp; a.alive = d.alive; a.state = d.state;
    a.marked = d.marked; a.markedAt = d.markedAt;
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
    audio.playAt(SFX_GUN_SHOOT, msg.x1, msg.y1, { volume: 0.7 });
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
    || (session.participants?.includes(peerId) ?? false)
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
    // Host is now authoritative for civilian state (broadcastCivs), so we MUST
    // flip alive=false here or the next civ broadcast would resurrect the victim
    // on all peers. Also stop velocity so the corpse doesn't slide.
    const c = civilians.find(c => c.id === msg.id);
    if (c) { c.alive = false; c.vx = 0; c.vy = 0; }
    // Host tracks penalty — it just re-broadcasts back to the shooter
    net.sendKill({ kind: 'civilianPenalty', shooterId: msg.shooterId });
    // Broadcast civilian death to EVERY participant so their local sim turns
    // that civilian into a ragdoll — otherwise only the shooter sees it die.
    net.sendKill({ kind: 'civilianDeath', id: msg.id, shooterId: msg.shooterId });
    // Immediate civ broadcast so remote peers see alive=false without waiting
    // up to 100ms for the next scheduled tick.
    broadcastCivs();
  }
  // human friendly fire could be added here
});

net.onKill((msg) => {
  if (msg.kind === 'alienKilled') {
    // Everyone: update points if you are the killer
    if (msg.killerId === net.selfId) {
      player.points += msg.points || 0;
      toast(`+${msg.points} · ${msg.archetypeName}`, 'kill');
    } else {
      const peer = net.peers.get(msg.killerId);
      if (peer) peer.points = (peer.points || 0) + (msg.points || 0); // keep debrief accurate without waiting for pose
      const name = (peer && peer.username) || 'hunter';
      toast(`${name} killed ${msg.archetypeName} (+${msg.points})`, 'info');
    }
  } else if (msg.kind === 'civilianPenalty') {
    if (msg.shooterId === net.selfId) {
      player.points = Math.max(0, player.points - CIVILIAN_PENALTY);
      player.civiliansKilled += 1;
      toast(`-${CIVILIAN_PENALTY} · civilian killed`, 'warn');
    } else {
      const peer = net.peers.get(msg.shooterId);
      if (peer) peer.points = Math.max(0, (peer.points || 0) - CIVILIAN_PENALTY);
    }
  } else if (msg.kind === 'civilianDeath') {
    // Mirror the civilian's death locally so non-shooters see the ragdoll.
    const c = civilians.find(c => c.id === msg.id);
    if (c) c.alive = false;
  }
  updateWeaponHUD();
});

function broadcastSession() {
  net.sendSession({ ...session });
  lastSessionBroadcast = Date.now();
}

// ---- Phase transition effects (local to this peer) ----
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
    spectateIndex = 0;

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
    } else {
      // Non-participant: stay in lobby, just track mission state passively.
      // Host still spawns + broadcasts aliens so participants receive them,
      // but the non-participant player sees the lobby room and can't interact with mission.
      if (net.isHost) {
        const comp = session.composition || ['patroller'];
        aliens = spawnFromComposition(session.missionSeed, MISSION_BOUNDS, comp);
        _bonusBossSpawned = false;
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
  { id: 'clear',   label: 'Clear',   weight: 6, tint: null },
  { id: 'night',   label: 'Night',   weight: 2, tint: { r: 0,  g: 10, b: 40, a: 0.35 } },
  { id: 'rain',    label: 'Rain',    weight: 2, tint: { r: 60, g: 80, b: 120, a: 0.18 } },
  { id: 'festival',label: 'Festival',weight: 1, tint: { r: 200,g: 50, b: 60,  a: 0.10 } },
  { id: 'rush',    label: 'Rush',    weight: 1, tint: { r: 255,g: 100,b: 0,   a: 0.08 } },
];

function rollModifier(seed) {
  const rng = makeRng((seed >>> 0) ^ 0xd1a0);
  let total = 0;
  for (const m of MODIFIERS) total += m.weight;
  let r = rng.next() * total;
  for (const m of MODIFIERS) { r -= m.weight; if (r <= 0) return m; }
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
  const base = MISSION_BASE_MS + (session.alienCount || 3) * 10000;
  if (session.modifier?.id === 'rush') return Math.floor(base * 0.6);
  return base;
}

function hostStartMission(nowMs) {
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
    if (nowMs - hostSince > 5000) {
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
    if (nowMs >= session.briefingEndsAt) hostStartMission(nowMs);
  } else if (p === Phase.MISSION) {
    const localDead = localIsParticipant() ? !player.alive : true;
    const peersDead = [...net.peers.entries()].every(([id, pr]) => {
      const inMission = !session.participants || session.participants.includes(id);
      return inMission ? pr.alive === false : true;
    });
    const allHumansDead = localDead && peersDead;
    if (allHumansDead) {
      hostEndMission(nowMs, 'wiped');
    } else if (false && nowMs >= session.missionEndsAt) { // DEV: timer disabled
      hostEndMission(nowMs, 'wiped');
    } else if (aliens.length > 0 && aliens.every(a => !a.alive)) {
      if (session.bonusBossRolled && !_bonusBossSpawned) {
        _bonusBossSpawned = true;
        const boss = spawnBonusBoss(session.missionSeed, MISSION_BOUNDS, session.missionIndex);
        aliens = [...aliens, boss];
        toast('Something else is here.', 'warn');
        broadcastAliens();
      } else {
        hostEndMission(nowMs, 'cleared');
      }
    }
    _gantzMockeryTick(nowMs);
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
    const modId = session.modifier?.id || 'clear';
    const modLabel = session.modifier?.label || 'Clear';
    const modDesc = modId === 'rush' ? 'Timer is shorter than usual.'
      : modId === 'night' ? 'Low light.'
      : modId === 'rain' ? 'Heavy rain reduces visibility.'
      : modId === 'festival' ? 'Streets are packed with civilians.'
      : 'Standard mission.';
    const targetsHtml = session.targets.map((t, i) => `
      <div class="target">
        <canvas class="alien-portrait" id="alien-portrait-${i}" width="140" height="180"></canvas>
        <div class="target-info">
          <strong>${t.name}</strong><span class="target-count"> × ${t.count}</span>
          <div class="target-hint">${t.hint || ''}</div>
        </div>
      </div>`).join('');
    overlayContent.innerHTML = `
      <div class="section">CONDITIONS</div>
      <div class="target conditions-target"><strong>${modLabel.toUpperCase()}</strong><div style="opacity:0.6;font-size:0.78rem;">${modDesc}</div></div>
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
  const modStr = session.modifier && session.modifier.id !== 'clear' ? ` · ${session.modifier.label}` : '';
  missionInfoEl.textContent = `MISSION ${session.missionIndex}${modStr}`;
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
const reconnectBtn = document.getElementById('reconnect-btn');
if (reconnectBtn) reconnectBtn.addEventListener('click', () => location.reload());

let _reconnectTimer = null;
function refreshPeerCount() {
  const n = net.peers.size + 1;
  peersEl.textContent = `${n} online${net.isHost ? ' · host' : ''}`;
  peersEl.classList.toggle('offline', net.status === 'offline');
  // Show reconnect button if alone for more than 30 s after connecting
  if (reconnectBtn) {
    clearTimeout(_reconnectTimer);
    if (net.peers.size === 0 && net.status === 'connected') {
      _reconnectTimer = setTimeout(() => {
        if (net.peers.size === 0) reconnectBtn.style.display = 'block';
      }, 30000);
    } else {
      reconnectBtn.style.display = 'none';
    }
  }
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
  if (name) chat.addSystem(`${name} has left the game.`);
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
const spectatePromptEl = document.getElementById('spectate-prompt');

function updateWorldHtmlOverlays() {
  // localInMission: true only when the player is physically present in the mission.
  // Non-participants remain in the lobby even while session.phase === MISSION.
  const localInMission = session.phase === Phase.MISSION && localIsParticipant();
  if (!localInMission) {
    const d = Math.hypot(player.x - GANTZ_BALL.x, player.y - GANTZ_BALL.y);
    const gantzTalking = (_introStartTime !== -1 && !_introDone) || (_namePromptPhase !== 'idle' && !_namePromptDone) || (!_gantzTalkDone && !!_gantzTalkLines) || (!_gantzExitDone && _gantzExitStart !== -1);
    const countdownActive = session.readyCountdownEnd >= 0 && session.phase !== Phase.BRIEFING && session.phase !== Phase.MISSION;
    const nearBall = d < INTERACT_RADIUS && !menu.isOpen() && !gantzTalking;
    if (nearBall && countdownActive) {
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

  if (localInMission && !player.alive) {
    const targets = spectateTargets();
    if (targets.length > 0) {
      const t = targets[spectateIndex % targets.length];
      spectatePromptEl.textContent = `▼ SPECTATING ${t.name.toUpperCase()} — click to switch`;
      spectatePromptEl.style.display = 'block';
    } else {
      spectatePromptEl.style.display = 'none';
    }
  } else {
    spectatePromptEl.style.display = 'none';
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
        // No target → just fly straight along the crosshair.
        const K = 50; // ≥ BULLET_MAX_DIST so direction dominates
        payload.ex = payload.ox + fwd.x * K;
        payload.ey = payload.oy + fwd.y * K;
        payload.ez = payload.oz + fwd.z * K;
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
    hit.target.alive = false;
    if (shooterId === net.selfId) {
      net.sendHit({ kind: 'civilian', id: hit.target.id, shooterId });
    }
    if (net.isHost) {
      if (shooterId === net.selfId) {
        player.points = Math.max(0, player.points - CIVILIAN_PENALTY);
        player.civiliansKilled += 1;
        missionCivilianKills += 1;
        toast(`-${CIVILIAN_PENALTY} · civilian killed`, 'warn');
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
  const inFightPhase = session.phase === Phase.MISSION || session.phase === Phase.LOBBY;
  if (!inFightPhase || !player.alive) return;
  if (session.phase === Phase.MISSION && !localIsParticipant()) return;
  if (fireCooldown > 0) return;
  const wid = activeWeaponId();
  const w = WEAPONS[wid];
  if (!w) return;
  fireCooldown = w.cooldown;

  // FPS feedback: muzzle flash + screen tint + sound
  scene3d.triggerMuzzleFlash?.();
  _gunFlashEl.classList.remove('active');
  void _gunFlashEl.offsetWidth; // reflow to restart animation
  _gunFlashEl.classList.add('active');
  // Own gunshot: always full volume, no pan — the sound is "in your hands",
  // not in the world from your listener's POV. Remote peers still hear it
  // positionally via the onShot broadcast.
  audio.play(SFX_GUN_SHOOT, 0.7);
  fireId++;
  // Dynamic crosshair: each shot pushes the four ticks outward. Spread decays
  // back to 0 every frame in render() when not firing.
  bumpCrosshairSpread(w.mode === 'spread' ? 28 : 18);

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
    // but rarely exceed 2.5m. Add the target's body radius as a fudge so
    // graze-the-head shots still count. Feet at 0; subtract a little for
    // stance variance.
    const bodyTop =
      t.kind === 'alien' ? 2.5 :
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
  }

  noteActivity();
  updateWeaponHUD();
}

// Weapon slot switching
addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.id === 'chat-input') return;
  if (menu.isOpen()) return;
  if (e.key === '1') { player.activeSlot = 0; updateWeaponHUD(); toast(WEAPONS[player.loadout.weapon1]?.name || '—', 'info'); }
  else if (e.key === '2' && player.loadout.weapon2) { player.activeSlot = 1; updateWeaponHUD(); toast(WEAPONS[player.loadout.weapon2]?.name || '—', 'info'); }
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
  // Spectate cycling if dead in mission — cursor is visible, no lock needed
  if (session.phase === Phase.MISSION && localIsParticipant() && !player.alive) {
    const targets = spectateTargets();
    if (targets.length > 0) {
      if (e.button === 0) spectateIndex = (spectateIndex + 1) % targets.length;
      else if (e.button === 2) spectateIndex = (spectateIndex - 1 + targets.length) % targets.length;
    }
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  tryFire();
});

// Exit pointer lock when modals open so the cursor is available
const chatInputEl = document.getElementById('chat-input');
chatInputEl?.addEventListener('focus', () => {
  if (document.pointerLockElement) document.exitPointerLock();
});


function update(dt) {
  // Flush any pending hits whose bullets have now reached their targets.
  // This must run before AI ticks so a civilian/alien that just died still
  // gets to run its death animation frame this tick.
  processPendingHits();
  // Announce peers the first time their username is known (arrives via pose, not raw join).
  for (const [id, p] of net.peers) {
    if (p.username && !_announcedPeers.has(id)) {
      _announcedPeers.add(id);
      chat.addSystem(`${p.username} has entered the game.`);
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
    player.walkPhase += dt * (sprinting ? 14 : walking ? 6 : 9);
    bobPhase += dt * (sprinting ? 16 : walking ? 7 : 10);
    bob = Math.abs(Math.sin(bobPhase)) * (sprinting ? 0.055 : walking ? 0.02 : 0.035);
  } else {
    player.walkPhase *= Math.pow(0.05, dt);
    bobPhase *= Math.pow(0.05, dt);
    bob *= Math.pow(0.05, dt);
  }

  // Jump
  if (wasPressed(' ') && jumpY === 0 && player.alive) {
    jumpVY = JUMP_SPEED;
    jumpId++;
    jumpMoveFwd  = moveFwd;
    jumpMoveSide = moveSide;
  }
  if (jumpY > 0 || jumpVY > 0) {
    jumpVY -= GRAVITY * dt;
    jumpY = Math.max(0, jumpY + jumpVY * dt);
    if (jumpY === 0) jumpVY = 0;
  }

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
      const humanTargets = []; // DEV: aliens ignore all players for testing
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
        // alien died: award points to killer
        const arch = ARCHETYPES[alien.archetype];
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
          toast(`+${points} · ${arch.name}`, 'kill');
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
    const _canInteract = !player.ready || _countdownNow; // ready players can still open menu during countdown to leave queue
    if (dBall < INTERACT_RADIUS && wasPressed('e') && !menu.isOpen() && !chat.isOpen?.() && !gantzTalking && _canInteract && performance.now() - _menuClosedAt > 250) {
      if (_countdownNow) {
        // During the countdown, pressing E toggles the queue directly — no menu needed.
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
  let focusX = player.x, focusY = player.y;
  if (session.phase === Phase.MISSION && localIsParticipant() && !player.alive) {
    const targets = spectateTargets();
    if (targets.length > 0) {
      const t = targets[spectateIndex % targets.length];
      focusX = t.x; focusY = t.y;
    }
  }
  renderer.setCamera({
    x: cam.x + (focusX - cam.x) * k,
    y: cam.y + (focusY - cam.y) * k,
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
      || (parts ? parts.includes(peerId) : false)
      || (session.phase === Phase.MISSION && !!p.ready);
    if (localInMission !== peerInMission) continue;
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

  const focus = (!player.alive && localInMission) ? (() => {
    const targets = spectateTargets();
    return targets[spectateIndex % Math.max(1, targets.length)] || player;
  })() : player;

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

  // Draw menu content onto the ball surface canvas
  _drawBallMenu();

  // update Gantz-prompt and spectate HTML overlays
  updateWorldHtmlOverlays();

  // Restore the simulation-authoritative player pose so the next update()
  // step runs against the real state, not our interpolated render copy.
  if (_realPx !== undefined) { player.x = _realPx; player.y = _realPy; }
}

function applyDamageToPlayer(amount) {
  if (!player.alive) return;
  player.hp = Math.max(0, player.hp - amount);
  if (player.hp <= 0) {
    player.alive = false;
    spectateIndex = 0;
    toast('You died. Spectating.', 'warn');
    net.broadcastPose();
  } else {
    toast(`-${amount} hp`, 'warn');
  }
  updateWeaponHUD();
}


function spectateTargets() {
  const alive = [];
  if (player.alive) alive.push({ kind: 'self', x: player.x, y: player.y, name: player.username });
  for (const [, p] of net.peers) if (p.alive !== false && p.x != null) {
    alive.push({ kind: 'peer', x: p.renderX, y: p.renderY, name: p.username || '?' });
  }
  return alive;
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
startLoop({ update, render });

// ── DEV: instant-mission button ─────────────────────────────────────────────
// Bypasses briefing countdown so weapon/animation work can be tested quickly.
// The button is removed from index.html before shipping.
document.getElementById('debug-mission-btn')?.addEventListener('click', () => {
  const nowMs = Date.now();
  // Mark local player ready so localIsParticipant() returns true,
  // and collect participants so enterPhase(MISSION) teleports the player.
  player.ready = true;
  session.participants = collectParticipants();
  if (!session.participants.length) session.participants = null;
  hostStartBriefing(nowMs);
  hostStartMission(nowMs);
});

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
