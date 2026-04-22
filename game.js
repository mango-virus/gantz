import { makeRng } from './src/engine/rng.js';
import {
  initInput, moveAxis, getMouse, setMouseWorld, endFrameInput,
  setInputSuspended, wasPressed, isDown,
} from './src/engine/input.js';
import { startLoop } from './src/engine/loop.js';
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
// Stop all looping audio when the page becomes hidden (tab-out / window minimize)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _stopTypeSound();
    _gantzOpenSfx?.pause();
    if (_gantzOpenSfx) _gantzOpenSfx.currentTime = 0;
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

const _GANTZ_LINES = [
  // single punches
  ["You again."],
  ["Don't flatter yourself."],
  ["Still alive.", "Unfortunate."],
  ["Pathetic.", "But functional."],
  ["I forget your name.", "I don't care."],
  ["You're not special.", "You're available."],
  ["Your feelings bore me."],
  ["I've had better.", "They're dead."],
  ["Try not to embarrass me."],
  ["You're inventory.", "Act like it."],
  ["Hurry up.", "I'm bored."],
  ["You survived.", "Don't make a thing of it."],
  ["You're replaceable.", "I have a list."],
  ["You smell like fear.", "I find that acceptable."],
  ["Don't look at me like that.", "It changes nothing."],
  ["You're not brave.", "You're just too slow to run."],
  ["Your survival is noted.", "Barely."],
  // two-liners
  ["You look terrible.", "Good.", "It suits you."],
  ["I don't care if you live.", "I care if you're useful."],
  ["You think this means something.", "It doesn't."],
  ["You made it back.", "I didn't notice you were gone."],
  ["Don't thank me.", "I don't like the sound of your voice."],
  ["You have questions.", "Keep them."],
  ["Your pain is noted.", "And ignored."],
  ["I've sent better people than you to die.", "Didn't bother me then either."],
  ["You're confused.", "That's your problem, not mine."],
  ["I made you a hunter.", "I can make you a memory."],
  ["You're alive.", "That's the full extent of my investment in you."],
  ["You want answers.", "How juvenile."],
  ["You think I owe you something.", "I don't."],
  ["I've recycled better hunters than you.", "Didn't lose a second of sleep."],
  ["You're scared.", "I find that mildly entertaining."],
  ["You want to go home.", "That's adorable."],
  ["You keep surviving.", "I haven't figured out why yet."],
  ["You're slower than the last one.", "He's dead.", "So."],
  ["I don't need you to understand.", "I need you to move."],
  ["Your body is mine on loan.", "Don't forget that."],
  ["You call that effort.", "I've seen better from things I've already killed."],
  ["You were dead.", "I fixed that.", "You're welcome."],
  ["You have potential.", "Probably not.", "But statistically, maybe."],
  ["You're angry at me.", "Good.", "Angry ones last longer."],
  ["You think you're different.", "They all think that."],
  ["Your opinion is irrelevant.", "I wanted you to know that specifically."],
  ["You're not a hero.", "You're a tool that thinks it's a hero."],
  ["I've watched civilizations end.", "You're not even a footnote."],
  ["You look like you have hope.", "Lose it.", "It slows you down."],
  ["I don't hate you.", "I don't think about you enough for that."],
  ["You're brave?", "Prove it somewhere I can watch."],
  // three-liners
  ["You came back.", "Impressive.", "Not really."],
  ["I made you.", "I can unmake you.", "That's not a threat.", "It's a schedule."],
  ["Your friends think you're brave.", "They're wrong.", "You're just slow to die."],
  ["You want to go home.", "That's cute.", "Focus."],
  ["Some hunters cry.", "Some beg.", "You're not interesting enough for either."],
  ["I was dead once.", "I got better.", "You probably won't."],
  ["You didn't earn this.", "You were available.", "There's a difference."],
  ["You have a name.", "I have a number for you.", "The name is irrelevant."],
  ["I've been here longer than your civilization.", "I'll be here after it.", "You have twenty minutes."],
  ["You think you matter.", "Every single one of you thinks that.", "Fascinating."],
  ["I could've picked anyone.", "I picked you.", "Lower your expectations accordingly."],
  ["You're confused.", "That's normal.", "You're scared.", "Also normal.", "Both are your problem."],
  ["Some of you die fast.", "Some die slowly.", "Either way it ends the same."],
  ["You're angry.", "At me.", "Hilarious."],
  ["You want out.", "Everyone wants out.", "Nobody gets out."],
  ["You think this is cruel.", "You have no frame of reference.", "Keep moving."],
  ["I gave you a second life.", "I didn't say it would be a good one.", "Go."],
  // single punches (2nd batch)
  ["Wipe your face.", "You look pathetic."],
  ["I've seen rocks with more initiative."],
  ["Don't die stupidly.", "Die usefully."],
  ["You're late.", "Not to anything.", "Just generally."],
  ["Lower your chin.", "You look defiant.", "It's embarrassing."],
  ["I've cloned better."],
  ["Your species has a real talent for disappointing me."],
  ["You're not worth mourning.", "That's a compliment."],
  ["Move.", "Or don't.", "I already know how this ends."],
  ["You flinch a lot.", "Interesting."],
  ["I've had houseplants with more resolve."],
  ["No one is coming to save you.", "Just so you know."],
  ["You're exactly as mediocre as I calculated."],
  ["You breathe too loud when you're nervous."],
  ["I've seen your type before.", "Many times.", "None of them matter."],
  ["Stop thinking so hard.", "You're not equipped for it."],
  ["You're fine.", "Statistically.", "Probably."],
  // two-liners (2nd batch)
  ["You look like you have a lot of thoughts.", "You should have fewer."],
  ["I don't find you interesting.", "I find you adequate.", "Barely."],
  ["You survived again.", "I'm running out of ways to be unimpressed."],
  ["You think I'm cruel.", "You haven't seen cruel.", "Yet."],
  ["You're still here.", "So am I.", "One of us is enjoying it."],
  ["Your life had a value.", "I spent it.", "You're welcome."],
  ["You have a family, don't you.", "Don't mention them.", "I don't care."],
  ["I've processed thousands like you.", "The number doesn't go down."],
  ["You want to matter.", "Most things do.", "Most things don't."],
  ["You're soft.", "That's fixable.", "Painfully."],
  ["You smell like someone who's reconsidering their choices.", "Good.", "Reconsider faster."],
  ["I could end you right now.", "I won't.", "You're more useful scared."],
  ["You're loyal to each other.", "That's going to hurt later."],
  ["You're running on adrenaline and denial.", "Don't stop.", "It's working."],
  ["You think your life is complicated.", "I've been alive for eleven thousand years.", "Sit down."],
  ["You have a good face.", "I've seen it make a better expression.", "When you were screaming."],
  ["You almost died last time.", "I watched.", "Don't read into that."],
  ["You're not clever enough to trick me.", "But watching you try is charming."],
  ["That look on your face.", "Keep it.", "You'll need the anger."],
  ["You're stalling.", "I respect the instinct.", "Not the execution."],
  ["You came back faster this time.", "You're learning.", "Slowly.", "But still."],
  ["You're not ready.", "You never are.", "Go anyway."],
  // three-liners (2nd batch)
  ["You want to negotiate.", "With me.", "That's the funniest thing I've seen all week."],
  ["You're angry about what I did.", "I'd tell you it gets easier.", "It doesn't."],
  ["You look at me like I'm the problem.", "I'm not the problem.", "I'm the only thing keeping you from being nothing."],
  ["I've destroyed planets.", "Accidentally.", "You're fine."],
  ["You think death is the worst thing.", "It isn't.", "I know what's worse.", "I'll keep that to myself."],
  ["Every hunter thinks they'll be the one to defy me.", "None of them are.", "You're going to try anyway.", "I can tell."],
  ["I don't get tired.", "I don't get lonely.", "I do, occasionally, get bored.", "Don't bore me."],
  ["You're small.", "Your problems are small.", "Your planet is small.", "Move."],
  ["I built you a second chance.", "You didn't ask for it.", "You didn't have to.", "That's the point."],
  ["You want mercy.", "From me.", "I don't even know what that word means in this context."],
  ["Some of them thank me.", "Right before the end.", "I let them."],
  ["You're brave today.", "You weren't always.", "I saw."],
  ["I've watched you sleep.", "Not for any reason.", "I just don't have anything better to do."],
  ["You'll die eventually.", "Everything does.", "Until then you're mine."],
  ["You remind me of someone.", "They didn't make it.", "Try to be different."],
  // ── extended lines ──
  ["You're still processing.", "I'll wait.", "I won't enjoy it."],
  ["I've had more inspiring conversations with walls."],
  ["Your hands are shaking.", "Interesting."],
  ["Don't make that face."],
  ["I know what you're thinking.", "Stop."],
  ["Adequate.", "That's all I'll give you."],
  ["You'll do."],
  ["I expected worse.", "Still disappointing."],
  ["You look tired.", "Good.", "Stay that way."],
  ["Your heartbeat is elevated.", "I can tell."],
  ["You didn't ask to be here.", "That's irrelevant."],
  ["I've rebuilt worse than you.", "Usually from scratch."],
  ["You have questions.", "I have missions.", "One of these matters."],
  ["You want to understand what I am.", "You don't have the framework.", "Stop trying."],
  ["You're worried.", "About the right things.", "That's better than average."],
  ["I know your name.", "I use it rarely.", "It implies attachment.", "There is none."],
  ["You want a reason.", "There isn't one.", "There's only a mission."],
  ["You've survived things that should have killed you.", "I don't know what to do with that.", "Keep it up."],
  ["You look like you're building resolve.", "Take your time.", "You have about forty seconds."],
  ["Some hunters get better.", "Most don't.", "You're in one of those categories.", "I'm not telling you which."],
  ["You're starting to understand.", "That look right there.", "That's the one."],
  ["I don't respect you yet.", "That's not an insult.", "It's a benchmark.", "Start climbing."],
  ["You've been through something.", "I can see it.", "Don't let it be the most interesting thing about you."],
  ["You look at me like I have answers.", "I have assignments."],
  ["I've seen people break.", "Right at this point.", "You're not breaking.", "Noted."],
  ["You want gratitude.", "From me.", "I don't carry that."],
  ["You're angry.", "I built that into you.", "Use it before it expires."],
  ["You think of me as an obstacle.", "That's the wrong framing.", "I'm the only reason you're breathing.", "Get the framing right."],
  ["The last person who stood where you're standing didn't come back.", "You already know that.", "Good."],
  ["You're trying to be ready.", "There's no such thing.", "Go anyway."],
  ["I find you tolerable.", "For now.", "Don't change that."],
  ["You want to matter to someone.", "I'm not someone.", "I'm something.", "It's different."],
  ["You're clenching your jaw.", "I'd tell you to relax.", "I want you tense."],
  ["I've made a record of your face.", "I do that with all of them.", "It helps with identification later."],
  ["Your survival instinct is intact.", "That's the baseline.", "You need to be better than baseline."],
  ["You look at me like I owe you something.", "You have the relationship exactly backwards."],
  ["You're new at this.", "So was everyone.", "Most of them aren't anymore."],
  ["Something about you is different today.", "I'll observe."],
  ["Your compliance is noted.", "Your enthusiasm is not required."],
  ["Don't smile at me.", "It changes nothing."],
  ["I don't find you charming.", "Technically I don't find anything charming.", "But especially not you."],
  ["You've survived so far.", "Survival is a habit.", "Build it."],
  ["You want me to say something useful.", "I've said everything that matters.", "You weren't listening."],
  ["You think you're the protagonist.", "You're not.", "You're a variable.", "A useful one, so far."],
  ["You're afraid.", "That's correct.", "Fear is correct here.", "Don't let it make decisions."],
  ["You have one body.", "I've seen how you use it.", "Try to extend the runtime."],
  ["I've been called a monster.", "By better people than you.", "They were right.", "It didn't help them."],
  ["You want to defy me.", "That's healthy.", "It's also pointless.", "But healthy."],
  ["You're trying.", "I'll give you that.", "Trying is the minimum.", "You're meeting the minimum.", "Marginally."],
  ["Some hunters talk to me like I'm a person.", "I'm not.", "It's touching.", "It changes nothing."],
  ["You're still alive.", "I've modeled the probability.", "It's lower than you'd like.", "Higher than I expected."],
  ["You want proof.", "That I'm what I say I am.", "You're standing inside the proof.", "Look around."],
  ["I've seen empires end badly.", "I've seen gods doubt themselves.", "I've seen you hesitate.", "Smaller scale.", "Same energy."],
  ["You're not ready.", "None of them are ready.", "The ones who say they are ready are lying.", "Be honest about it.", "Go anyway."],
  ["I know what you want.", "You want to go home.", "You want this to be over.", "You want to matter.", "Three things.", "One is possible."],
  ["You haven't broken yet.", "I've been watching for it.", "Either you're stronger than you look.", "Or you haven't hit the right thing yet."],
  ["This conversation is not going somewhere.", "It's ending.", "Go."],
  ["I could explain what I am.", "You don't have the vocabulary.", "I don't have the patience.", "Go."],
  ["I've given you tools.", "I've given you missions.", "I've given you a second life.", "What I haven't given you is permission to waste it."],
  ["You want me to call you by name.", "I know your name.", "I know seventeen things about you.", "None of them change what happens next."],
  ["You're angry at the situation.", "That's valid.", "You're angry at me.", "That's interesting.", "Use both."],
  ["I don't sleep.", "I don't forget.", "I don't hold grudges.", "I simply remember everything.", "Perfectly.", "Indefinitely."],
  ["You look like you want to say something.", "Go ahead.", "I've heard worse.", "Recently."],
  ["You survived again.", "One day that streak ends.", "Today was not that day.", "Don't take it personally."],
  ["I've given this speech before.", "Many times.", "The wording changes.", "The outcome doesn't."],
  ["You keep showing up.", "I'll give you that.", "It's the minimum requirement.", "You're meeting it."],
  ["You're calculating something.", "Stop.", "The numbers won't comfort you."],
  ["You look at me like you expect me to change.", "I'm eleven thousand years old.", "I don't change.", "You might.", "Get going."],
  ["I've seen things forget they were alive.", "Don't let that happen to you.", "It's unbecoming."],
  ["Your hesitation is noted.", "Your hesitation is irrelevant.", "Your presence is required.", "Move."],
  ["You came here looking for something.", "You found an assignment.", "Same thing, effectively."],
  ["You're thinking about your odds.", "Your odds are what they are.", "Stop thinking about them.", "It makes them worse."],
  ["I don't have favorites.", "I have frequencies.", "You've survived often enough to register.", "That's almost something."],
  ["You want to know if I care whether you live.", "I care about mission completion.", "Those things overlap.", "Usually."],
  ["You look like someone who has something to prove.", "Good.", "Those ones last longer.", "Mostly."],
  ["I've watched you since you arrived.", "You don't know that.", "Now you do.", "Nothing changes."],
  ["You want me to be impressed.", "I've seen the birth of stars.", "You'll have to do better than survive.", "Start trying."],
  ["You've made it further than most.", "Most isn't a high bar.", "But it's something."],
  ["Every hunter thinks they're an exception.", "Every hunter is correct.", "That's not what they meant.", "But it's still true."],
];
let _gantzTalkLines = null;
let _gantzTalkStart = -1;
let _gantzTalkDone = true;

const _GANTZ_BUY_LINES = [
  ["Spent.", "Don't look so pleased with yourself."],
  ["Transaction complete.", "The aliens don't care.", "Just so you know."],
  ["There.", "Try not to waste it.", "Actually, I don't care if you waste it."],
  ["I gave you tools.", "I didn't give you skill.", "That's your problem."],
  ["Congratulations.", "You've purchased a slightly better way to die."],
  ["Take it.", "It won't save you.", "But it might make the attempt look better."],
  ["Equipment acquired.", "Expectations unchanged."],
  ["You got what you paid for.", "Whether you survive is a separate question."],
  ["New gear.", "Same you.", "Interesting combination."],
  ["Done.", "If you die with that thing I gave you, it's embarrassing.", "For you."],
  ["There.", "Now you're slightly less underprepared.", "Slightly."],
  ["Points spent.", "They're not coming back.", "Neither are most hunters.", "Motivating, probably."],
  ["Your loadout changed.", "Whether that matters is yet to be determined."],
  ["I process thousands of these.", "Your purchase is noted.", "And immediately irrelevant to me."],
  ["Equipment distributed.", "Try to die less embarrassingly."],
  ["You've upgraded yourself.", "Marginally.", "Try to survive proportionally longer."],
  ["Transaction logged.", "Survival odds updated.", "Marginally.", "Don't celebrate."],
  ["You spent.", "I watched.", "Neither of us should be proud of this moment."],
  ["You've invested in yourself.", "Return on investment remains statistically unclear."],
  ["Points are just numbers.", "Now you have fewer.", "You have more things.", "Unclear if this is progress."],
  ["I'll note this in your file.", "Under things I don't care about."],
  ["Good.", "Use it.", "Or don't.", "I already know how this ends."],
  ["You paid.", "I'd say enjoy it.", "I won't."],
  ["You bought something.", "The mission doesn't get easier because of it.", "I want you to know that."],
  ["There's your gear.", "I'd wish you luck.", "I've modeled the outcomes.", "Luck isn't a variable."],
  ["You spent points on that.", "Interesting choice.", "Wrong word.", "You had no real choice.", "This amuses me."],
  ["Equip it.", "Use it.", "Die with it if you have to.", "Just do something."],
  ["You've made your selection.", "I've observed worse decisions.", "Not many.", "But some."],
  ["Consider it an upgrade.", "Consider it a final gift.", "Consider it anything you want.", "It changes nothing."],
  ["Take it.", "You earned those points somewhere.", "Now you've traded them for this.", "Fair enough."],
  ["I built that for someone like you.", "They died.", "Different reasons, probably.", "Probably."],
  ["Your points, your choice.", "I simply provided the options.", "Don't blame me for what happens next."],
  ["You look almost confident now.", "That's going to be a problem for you eventually."],
  ["I've seen hunters buy that exact thing and live.", "I've also seen the opposite.", "I find both equally acceptable."],
  ["You made a choice.", "I made it available.", "Neither of us should feel good about this relationship."],
  ["Item dispensed.", "Try not to lose it immediately.", "You will.", "But try."],
  ["Your odds improved.", "Fractionally.", "I wouldn't mention it to anyone."],
  ["You spent points on survival.", "That's technically rational.", "I'll note the exception."],
  ["That's yours now.", "I don't want it back.", "I want you to use it until it or you stops working."],
  ["Acquisition confirmed.", "Survival unconfirmed.", "As always."],
  ["I've given better to worse people.", "They died anyway.", "Interesting data point."],
  ["You look at it like it means something.", "It's equipment.", "Treat it like equipment."],
  ["One less point on your side.", "One more thing on your side.", "The math is yours to figure out."],
  ["Transaction recorded.", "Don't mention it.", "I mean that literally.", "Don't bring this up again."],
  ["You've made your bed.", "It's a slightly better bed than before.", "You'll probably die in it.", "Statistically."],
  ["Noted.", "Equipped.", "Moving on.", "Keep up."],
  ["I've seen that exact purchase save a life.", "Once.", "Emphasis on once."],
  ["You bought time.", "Maybe.", "Time tends to disagree with people in your position."],
  ["There it is.", "Don't worship it.", "It's a tool.", "You're also a tool.", "We've established this."],
  ["I would say use it wisely.", "But I already know how this goes.", "Use it anyway."],
  ["You've traded numbers for objects.", "Whether that was wise depends entirely on you.", "I'm not optimistic."],
  ["You're more equipped than you were.", "Whether you're more capable is a different question."],
  ["Your loadout is updated.", "Your odds are marginally improved.", "Your attitude remains the problem."],
  ["Consider it a gift.", "Don't.", "It wasn't free.", "Nothing is free.", "Especially not from me."],
  ["I'll let you have that.", "Not because I'm generous.", "Because I'm curious what you'll do with it."],
  ["Done.", "That's the end of the transaction.", "The rest is up to you.", "Unfortunate for both of us."],
  ["Something exchanged hands.", "Loosely speaking.", "I don't have hands.", "You do.", "Use them."],
  ["That's your gear.", "I didn't make it for you.", "I made it for whoever needed it.", "You needed it.", "Barely."],
  ["Points to equipment.", "A classic trade.", "Every hunter makes it.", "You're not special for making it.", "But here we are."],
  ["Your selection has been processed.", "My opinion of your selection has not been requested.", "You're welcome for the restraint."],
  ["I gave you something.", "You gave me points.", "We're even.", "We're never even.", "You still owe me everything."],
  ["Gear acquired.", "You look slightly more formidable.", "Don't let it go to your head.", "It'll get you killed."],
  ["I've watched thousands of hunters make that exact purchase.", "Most of them are not here anymore.", "Make of that what you will."],
  ["The item is yours.", "What you do with it determines whether I consider this transaction a success.", "I rarely do."],
  ["Take it.", "You earned those points by surviving things that should have killed you.", "Don't waste the investment."],
  ["You bought it.", "It's equipped.", "The part where you use it well is the part I can't give you.", "I've tried.", "I've stopped trying."],
  ["That's your choice logged.", "I've seen worse choices.", "Not today, but historically."],
  ["Equip it.", "Go.", "Try not to make me regret the transaction.", "I already do, slightly.", "Go anyway."],
  // ── extended lines ──
  ["Purchased.", "The aliens still don't care.", "Neither do I.", "But here we are."],
  ["Your request has been processed.", "Your competence has not been updated.", "Work on that."],
  ["I gave you that.", "Not because you deserved it.", "Because the mission requires it.", "There's a difference."],
  ["Equipment delivered.", "Performance expectations remain unchanged.", "Which is to say: low."],
  ["You spent points.", "I noted it.", "I've noted worse things.", "This is still on the list."],
  ["Transaction confirmed.", "You're slightly less likely to die immediately.", "Slightly."],
  ["I watched you spend those.", "I'll also watch you use them.", "I'll also watch what happens after.", "I watch a lot."],
  ["It's yours.", "Do something useful with it.", "Statistically you won't.", "But the option is there."],
  ["Your inventory changed.", "Your situation changed marginally.", "You're welcome marginally."],
  ["Done.", "I'll add it to your file.", "Under: acquisitions made under duress.", "They all are."],
  ["I've given that to better hunters.", "They died with it.", "They died better than they would have without it.", "That's the goal."],
  ["Your choice.", "I provided the option.", "You provided the points.", "The aliens provide the test.", "We'll see."],
  ["I process these transactions without feeling.", "I want to be clear about that.", "This wasn't special.", "None of them are."],
  ["New gear logged.", "Old odds updated.", "Marginally.", "Really quite marginally."],
  ["I've given you something to lose now.", "Try not to lose it immediately.", "Or lose it heroically.", "Either is acceptable."],
  ["You look at it like it's going to save you.", "It's going to help you.", "That's not the same thing.", "Manage your expectations."],
  ["Acquired.", "The mission doesn't get easier.", "You get slightly more prepared.", "Different things."],
  ["I'll note this purchase in my records.", "Under: things that may delay the inevitable.", "May."],
  ["You paid points for that.", "Points you earned by surviving.", "By surviving you bought tools.", "By buying tools you'll try to survive.", "I find that loop interesting."],
  ["Your loadout reflects your priorities.", "Your priorities are your own.", "Your outcomes are my data.", "I look forward to the data."],
  ["I could have made that harder to acquire.", "I didn't.", "Take that as the closest thing to generosity I offer."],
  ["You've improved your survival index.", "Slightly.", "Don't tell anyone.", "It implies I'm rooting for you.", "I'm not.", "I'm rooting for the mission."],
  ["Equipment transferred.", "You look slightly more capable.", "The operative word is 'slightly'."],
  ["You made a transaction.", "I honored it.", "Neither of us should read anything into that."],
  ["The item is yours.", "Use it.", "Drop it.", "Lose it.", "Whatever you do with it, do it during the mission.", "Not here."],
  ["I dispense gear the way I dispense missions.", "Without sentiment.", "With precision.", "Don't confuse the two."],
  ["Your points bought that.", "Your points came from killing things.", "You killed things with gear I gave you.", "We're in a cycle.", "Don't think about it too hard."],
  ["I gave you something to fight with.", "I didn't give you something to win with.", "Those are different requests.", "You only made one of them."],
  ["Equipment confirmed.", "Survival unverified.", "Attitude problematic.", "Two of those are mine to give you.", "One is yours to fix."],
  ["New loadout.", "Same mission.", "Same outcome probability.", "The gear improves the margin.", "The margin might be enough.", "It might not."],
  ["I gave you that because the mission requires it.", "Don't mistake requirement for generosity."],
  ["Your purchase is complete.", "Your survival is pending.", "As always.", "Pending."],
  ["I've seen that specific purchase made ten thousand times.", "Ten thousand hunters.", "Their results vary.", "Yours hasn't happened yet.", "Make it a good result."],
  ["You've increased your capability.", "Fractionally.", "Fractions matter when the margin is small.", "And it's always small."],
  ["I built that for circumstances like yours.", "I hope you use it in exactly those circumstances.", "I've modeled what happens if you don't.", "I prefer the other outcome."],
  ["That's yours now.", "I find the concept of ownership interesting.", "Everything is temporary.", "That's especially temporary.", "Use it while it's yours."],
  ["Points exchanged.", "Item transferred.", "Risk managed slightly.", "Managed risk beats unmanaged.", "Marginally."],
  ["I gave you that without hesitation.", "I give everything without hesitation.", "That's structural.", "Not enthusiasm."],
  ["Your points went somewhere useful.", "Whether you go somewhere useful is the remaining question."],
  ["I'd say well done for acquiring that.", "I won't.", "Acquiring gear is step one.", "You've barely started."],
  ["You spent points I watched you earn.", "You earned them by surviving things I sent you into.", "I find that chain of events appropriate."],
  ["Done.", "The gear is equipped.", "The mission is waiting.", "Go."],
  ["You're armed.", "You were armed before.", "You're more armed.", "Use the additional arming appropriately."],
  ["I've watched hunters buy exactly that and die within minutes.", "I've also watched them use it and survive.", "That's entirely up to you."],
  ["That's a defensible purchase.", "I've seen worse.", "I've seen better.", "You made a choice.", "It's yours to live with.", "Literally."],
  ["Your request was reasonable.", "I acknowledged it.", "I fulfilled it.", "This is the extent of my investment in your comfort."],
  ["New item.", "Old mission.", "The combination is yours to figure out."],
  ["Equipped.", "Pending activation by you.", "You're the last variable.", "You always are."],
  ["You look more confident.", "Good.", "Confidence is a tool.", "Don't use it instead of the actual tools I just gave you."],
  ["Your transaction has been completed.", "Your survival has not.", "One of those is my job.", "The other is yours.", "Get to work."],
  ["I've processed that purchase for you.", "Try not to lose it in the first exchange.", "I've seen that happen.", "Often."],
  ["Done.", "Your loadout has been adjusted.", "Your attitude hasn't.", "One of these concerns me more than the other."],
  ["Points to gear.", "Gear to mission.", "Mission to points.", "That's the loop.", "You're in it.", "Stay in it."],
  ["You got what you came for.", "Now go do what you're sent for.", "Those are different.", "The second one matters more."],
  ["Acquisition logged.", "Allocation noted.", "Mortality pending.", "As always."],
  ["I gave you something.", "You gave me points.", "We have a transactional relationship.", "Don't try to make it anything else."],
  ["The item has been transferred to your possession.", "Possession is the simple part.", "Competence is the complicated part.", "Work on that."],
  ["Your survival odds improved.", "Not enough to celebrate.", "Enough to try."],
  ["Take it.", "Fight with it.", "Survive with it if you can.", "Die with it if you can't.", "Either way, use it."],
  ["Your gear reflects the points you've earned.", "Your points reflect what you've survived.", "Your survival reflects something I'm still watching."],
  ["Equipment distributed.", "Outcome undetermined.", "Probability calculated.", "Result not shared.", "You wouldn't like it.", "Go anyway."],
  ["I've had this conversation before.", "Different hunter.", "Same gear.", "Same moment.", "They're not here anymore.", "Make it count."],
  ["Your gear is updated.", "The mission doesn't change because your gear changes.", "It changes because you change.", "Change."],
  ["Something has been given.", "Something is expected in return.", "That something is competence.", "Bring it."],
  ["You bought it.", "Now earn it.", "Owning gear and deserving gear are different standards.", "Rise to the second one."],
  ["I've dispensed this item before.", "Many times.", "The outcomes vary.", "The item stays consistent.", "Be the variable that improves the outcome."],
  ["Points spent.", "Value transferred.", "Whether value was created depends entirely on what you do next.", "I'm waiting to see."],
  ["Transaction recorded.", "You will not be remembered fondly or unfondly.", "You will simply be tracked.", "Until you stop being trackable.", "Don't let that happen soon."],
  ["Done.", "I gave you a tool.", "A tool is only as good as the person holding it.", "You're approximately adequate.", "That might be enough."],
  ["You purchased an advantage.", "Advantages are not guarantees.", "I need you to understand that before you go in.", "Good.", "Now go in."],
  ["I have records of every purchase every hunter has ever made.", "The ones who spent wisely lived longer.", "Define wisely however you want.", "Then prove it."],
  ["Gear acquired.", "Experience not included.", "Experience is acquired separately.", "Usually under unpleasant conditions.", "You'll see."],
  ["You made a choice.", "I respected it by fulfilling it.", "Respecting choices isn't the same as endorsing them.", "I withhold endorsement.", "As always."],
  ["I built this entire system.", "Including that item.", "Including you.", "Perspective."],
  ["The gear is yours.", "The outcome isn't.", "The outcome belongs to the mission.", "You belong to the mission.", "We've established that."],
  ["I could comment on your selection.", "I've chosen not to.", "Take that as either approval or indifference.", "Accurate either way."],
  ["Your equipment has been updated.", "Your skills have not.", "One of those is something I can provide.", "The other is on you."],
  ["Done.", "Gear dispersed.", "Lecture withheld.", "For now.", "Go."],
  ["I've seen what that gear can do in good hands.", "I'm still assessing your hands.", "Results inconclusive.", "We'll see."],
  ["You're better equipped for what's coming.", "What's coming doesn't care.", "Be better equipped anyway.", "I recommend it."],
  ["Transaction concluded.", "You still owe me everything.", "This purchase was not counted toward that debt."],
  ["You bought something.", "Don't let buying things become the most interesting thing you do.", "Go do the rest."],
  ["Your acquisition is complete.", "Your preparation is not.", "Preparation is never complete.", "That's not a reason to delay.", "Go."],
  ["I gave you that without complaint.", "Take note of that.", "I complain about everything.", "This was different.", "Figure out why."],
  ["Your gear is improved.", "Your situation is still exactly what it was.", "Better equipped.", "Same stakes.", "Go."],
  ["You look at the gear and feel better.", "Feel whatever helps.", "Then go use it."],
  ["Done.", "The item exists.", "You exist.", "Put them to work together.", "That's the whole plan."],
  ["Points to gear.", "Gear to mission.", "Mission to survival.", "Survival to points.", "Repeat until you can't.", "That's your whole life now."],
  ["I gave you something good.", "Whether it works depends on you.", "Whether you work depends on you.", "Everything depends on you.", "That's both empowering and alarming.", "Go."],
  ["Transaction filed.", "Under: resources invested in uncertain outcomes.", "You're all uncertain outcomes.", "Some of you become certain ones.", "Make yours a good kind."],
  ["Your request has been honored.", "My request has not yet been fulfilled.", "My request is: don't waste this.", "Get on that."],
  ["Gear transferred.", "Mission pending.", "You pending.", "Go be useful."],
  ["You bought that.", "Now justify it.", "In mission terms.", "Nothing else counts."],
  ["I distributed that efficiently.", "Efficiency is not warmth.", "Don't get confused."],
  ["Your loadout has been upgraded.", "Your threshold for acceptable risk has also just increased.", "Act accordingly."],
  ["New item in your possession.", "Slightly different odds.", "The slightly matters.", "Go prove it."],
  ["I've given you what you asked for.", "What you need and what you asked for may differ.", "That's your problem to reconcile.", "Out there.", "Not here."],
  ["You spent points on gear.", "The aliens you face have spent their existence evolving to kill things like you.", "You have slightly better gear.", "Go."],
  ["That's your item.", "It came from points.", "Your points came from killing things.", "The things you'll use it on don't know that.", "Make sure they find out."],
  ["Transaction: done.", "Expectations: unchanged.", "Confidence: marginally higher.", "The margin is real.", "Go find out what it means."],
  ["I watched you choose that.", "I've watched a lot of hunters choose.", "The ones who chose carefully lived longer.", "You chose.", "We'll see if it was careful."],
  ["Done.", "You're slightly more dangerous.", "Dangerous in the right direction.", "That's not nothing.", "It's almost something.", "Go."],
  ["Your gear is updated.", "Congratulations is not the word I'd use.", "I'd use: acknowledged.", "Your purchase is acknowledged.", "Now go earn it."],
  ["I've seen hunters leave here with exactly that.", "Some of them came back.", "All of them had to use it.", "You will too.", "Use it well."],
  ["Purchase registered.", "Mission imminent.", "Slightly is doing heavy lifting here.", "But it's load-bearing.", "Go."],
  ["You bought time.", "Every piece of gear is time.", "Time you spend surviving.", "Spend it well."],
  ["I've given you tools.", "Tools require skill.", "Skill requires practice.", "Practice requires surviving.", "You're in the loop.", "Stay in it."],
  ["Your acquisition reflects your assessment of the threat.", "I hope your assessment is accurate.", "It usually isn't.", "Sometimes it is.", "Sometimes is enough."],
  ["Your points are gone.", "Your gear is here.", "The exchange is complete.", "The mission is next.", "Move."],
  ["I've added your purchase to your profile.", "Hunters with good gear last longer.", "The correlation is clear.", "You're welcome.", "Don't thank me.", "Go."],
  ["Done.", "I distributed your gear without commentary.", "Consider that commentary.", "Now go."],
];

const _GANTZ_NO_POINTS_LINES = [
  ["No.", "Get points.", "Come back when you're worth something."],
  ["Insufficient.", "Like most things about you."],
  ["You're broke.", "In every sense of the word.", "Go fix that."],
  ["I don't do credit.", "I don't do sympathy.", "Get points.", "Try again."],
  ["You came to me with empty hands.", "I find that disrespectful."],
  ["Points are earned.", "Clearly you haven't grasped that concept yet."],
  ["No.", "That's the whole sentence."],
  ["You can't afford it.", "Maybe kill more things.", "Faster.", "Better.", "Just more in general."],
  ["You don't have the points.", "I could say I'm surprised.", "I'm not."],
  ["Unaffordable.", "Much like competence, for you."],
  ["I've seen more resources in a corpse.", "Recently."],
  ["Come back when you have something worth exchanging.", "That's not an invitation.", "It's a condition."],
  ["Denied.", "Because math.", "Specifically, subtraction."],
  ["You stood before me expecting to buy something.", "With that.", "That's optimism.", "I find it sad."],
  ["Insufficient funds.", "Insufficient effort.", "Probably.", "Go fix one of those."],
  ["I don't negotiate.", "I don't pity.", "I don't do installment plans.", "Get points."],
  ["You need more points.", "That's not my problem.", "It is, however, very much yours."],
  ["You're window shopping with a deficit.", "That's painful to observe."],
  ["The number you have is too small.", "The number you need is larger.", "This is why schools exist."],
  ["Not enough.", "Not enough of a lot of things with you.", "Points is just today's version."],
  ["Zero is a number.", "You should get a different one first."],
  ["You can't buy that.", "Because you're poor.", "Go be poor somewhere else."],
  ["You don't have enough.", "That's your problem.", "Leave."],
  ["I don't accept effort as currency.", "Points.", "Just points."],
  ["You're not buying anything today.", "Come back when you've earned it.", "Or don't.", "Either works."],
  ["I'd say try harder out there.", "But I'd say that regardless.", "Go."],
  ["Kill something.", "Take its points.", "Then come back.", "In that order."],
  ["Your ambition exceeds your resources.", "That's a character flaw.", "Address it."],
  ["You looked at the price.", "You looked at your points.", "You came to me anyway.", "Bold.", "Stupid.", "Bold."],
  ["Everyone wants the upgrade.", "Not everyone earns it.", "You haven't.", "Come back different."],
  ["I admire the attempt.", "I don't actually.", "Get more points."],
  ["You're a few points short of being someone I'd sell things to.", "Work on that."],
  ["That's what ambition looks like when it can't pay its own way.", "Go earn something."],
  ["You want it.", "You can't have it.", "Those two things are related.", "Fix the second one."],
  ["Browsing without buying.", "That's all this was.", "I find it embarrassing on your behalf."],
  ["Not enough points.", "Not enough discipline.", "Not enough.", "Just generally not enough."],
  ["I don't feel sorry for you.", "I don't feel anything for you.", "Go get points."],
  ["You're short.", "On points.", "Possibly on other things.", "Today we're talking about points."],
  ["You looked at the price and came anyway.", "I respect the audacity.", "I don't reward it.", "Go."],
  ["Points first.", "Then gear.", "That's the order.", "It's always been the order.", "Learn the order."],
  ["I've had better-funded hunters.", "They're dead.", "But they had points.", "You should have points."],
  ["The answer is no.", "The reason is arithmetic.", "You should study it."],
  ["You're standing here with nothing to offer.", "That's not a transaction.", "That's just standing."],
  ["Earn it.", "That's the whole system.", "You're not above the system.", "Nothing is above the system."],
  ["You want what you can't afford.", "That's a very human problem.", "I find it predictable."],
  ["Come back with points.", "Come back without points and I'll simply watch you try again.", "It's not entertaining.", "Do it anyway."],
  ["You need to kill more things.", "That's not a suggestion.", "It's the prerequisite.", "Go fulfill it."],
  ["Every hunter has stood exactly where you're standing.", "The ones with points left with gear.", "The ones without left with nothing.", "Guess which group you're in."],
  ["Not enough.", "That word should follow you everywhere until you fix it."],
  ["I built this system to reward effort.", "You haven't brought enough of it today."],
  ["You don't have what it takes.", "Specifically, you don't have the points.", "More broadly, I have questions."],
  ["The price is the price.", "I didn't set it arbitrarily.", "I set it specifically.", "To keep people like you honest."],
  ["Go outside.", "Kill something.", "Take its worth.", "Come back different."],
  ["You failed to buy something today.", "Add it to your list of things to improve.", "The list is getting long."],
  ["I process these rejections constantly.", "You're not special for being rejected.", "You're just today's version."],
  ["The door is behind you.", "Go earn the right to come back through it."],
  ["I could give it to you.", "I won't.", "The points system exists for a reason.", "The reason is you, specifically."],
  ["You haven't killed enough.", "You haven't earned enough.", "You haven't been enough.", "Fix any of those and return."],
  ["Denied.", "I feel nothing about that.", "You probably feel something.", "That's the difference between us."],
  ["You came here with insufficient currency and excessive hope.", "The hope is the problem.", "Calibrate it."],
  ["The math doesn't care about your situation.", "Neither do I.", "Get points."],
  ["I watched you try to buy that.", "I watched you fail.", "I'll watch you try again eventually.", "I don't recommend it."],
  ["No points, no gear, no excuses.", "That's a complete sentence.", "Treat it like one."],
  ["You reached for something you hadn't earned.", "That's either ambition or delusion.", "Come back with points.", "Then we'll know which."],
  ["I've seen this exact moment from a thousand different hunters.", "None of them enjoyed it.", "None of them should have.", "Including you."],
  // ── extended lines ──
  ["You don't have it.", "Come back when you do."],
  ["I don't run a charity.", "I don't run a credit system.", "I run a points system.", "Get points."],
  ["You're short.", "That's the beginning and end of this conversation."],
  ["No.", "The number is wrong.", "Make it right.", "Come back."],
  ["You can't buy that.", "That fact will not change until your points do.", "Go change your points."],
  ["Insufficient.", "That's the assessment.", "It covers the gear and, frankly, the effort."],
  ["Your points don't reach.", "Your reach is fine.", "Your points are the problem.", "Address the points."],
  ["I've rejected better-funded hunters than you.", "They were still better funded.", "That matters here."],
  ["Come back with more.", "More points.", "That's all I need from you.", "Just more points."],
  ["Not today.", "Not with those numbers.", "Come back different."],
  ["You attempted a transaction you couldn't complete.", "That's not a character flaw.", "It's an arithmetic one.", "Fix the arithmetic."],
  ["You don't have enough.", "The thing you want requires more than you have.", "This is very simple.", "Go make it less simple."],
  ["I find this interaction unremarkable.", "Not because it's rejecting you specifically.", "Insufficient funds is my most frequent conversation.", "You're very ordinary."],
  ["Denied.", "Don't take it personally.", "Take it numerically.", "The number needs to go up."],
  ["You walked up here with that amount expecting to buy something.", "I respect the optimism.", "I reject the premise.", "Go earn more."],
  ["Nothing changes until the number changes.", "The number is your points.", "Go change it."],
  ["I've been doing this longer than your country has existed.", "Insufficient funds is always the same conversation.", "You're having it now.", "Go end it properly."],
  ["Not enough.", "That's the output.", "Your points were the input.", "Change the input to change the output.", "Basic math.", "Do it."],
  ["No.", "I don't negotiate the price.", "I set the price based on value.", "You're not worth negotiating with.", "Get points."],
  ["Rejected.", "Not with malice.", "With arithmetic.", "They're different.", "The result is the same.", "Get points."],
  ["You don't have the points to cover that.", "You do have the ability to change that.", "Those two facts are related.", "Use the second to fix the first."],
  ["I gave you a second life.", "I didn't give you a line of credit.", "Go earn the points.", "Then come back."],
  ["Points are earned.", "They're earned by surviving missions.", "You've been on missions.", "They aren't enough.", "Do better."],
  ["Your points are too few.", "Your wants are too large.", "Shrink the wants or expand the points.", "I recommend the second option."],
  ["You stood here and tried to buy something you couldn't afford.", "Not with judgment.", "With data.", "Data: you need more points.", "Get them."],
  ["Transaction not possible.", "Reason: obvious.", "Solution: also obvious.", "Go implement the solution."],
  ["I don't extend credit to hunters.", "I've seen what happens to hunters.", "It would be irresponsible.", "Get points first.", "Then buy things."],
  ["You're approaching this wrong.", "The right approach is: earn points, buy gear.", "You've reversed the sequence.", "Correct the order."],
  ["Insufficient.", "Again.", "I'm keeping count.", "Not for your benefit.", "For mine.", "It's data.", "Go fix the data."],
  ["Your current points describe someone who hasn't tried hard enough yet.", "Go change that description."],
  ["The gap between what you have and what you want is called a deficit.", "You're going to close it.", "Out there.", "Not here."],
  ["I process rejections with complete neutrality.", "This one is no different.", "Go change the numbers.", "Come back when they're different."],
  ["No.", "Not now.", "Not with what you have.", "Come back with what you need."],
  ["I've watched people try to negotiate this before.", "It doesn't work.", "The system isn't designed for negotiation.", "It's designed for results.", "Go produce some."],
  ["You need more.", "Specifically more points.", "Generally more everything.", "But today, points.", "Go."],
  ["Denied.", "Move along.", "Come back equipped with the correct number.", "That number is not what you have.", "Go find it."],
  ["You're not ready to buy.", "You were ready to try to buy.", "Those aren't the same.", "Go close the gap."],
  ["I could tell you how to earn more points.", "You already know.", "You've done it before.", "Do it better.", "Do it more."],
  ["Your points are zero.", "Or close to.", "Zero is a number with no purchasing power.", "Change it."],
  ["You came here wanting something.", "You don't have what it costs.", "That's a simple problem.", "Go solve it the simple way.", "Kill things.", "Take points.", "Return."],
  ["I don't give things away.", "I trade them for points.", "Points you earn by surviving.", "You haven't survived enough.", "Go survive more."],
  ["Not enough.", "Two words.", "Complete sentence.", "Full rejection.", "Nothing more to add.", "Go earn more."],
  ["You're at a deficit.", "Deficits are resolved through action.", "Action in this context means missions.", "Go run one."],
  ["You want something you can't pay for.", "That's a state of being I can fix.", "But not by giving you credit.", "By sending you out.", "Go."],
  ["I note you wanted this.", "I note what you want.", "I note the gap.", "I've noted it.", "Go close it."],
  ["You're asking me to give you something.", "I don't give.", "I trade.", "You have nothing to trade right now.", "Go get something."],
  ["I've dispensed this rejection before.", "Different hunter.", "Same empty balance.", "Same conversation.", "Same result.", "Go change the result."],
  ["The price is set.", "Your balance is insufficient.", "This is not a tragedy.", "It's a math problem.", "Go solve it in the field."],
  ["Not enough points.", "Not enough skill demonstrated in acquiring points.", "Not enough.", "Just.", "Not enough."],
  ["I have a threshold.", "You haven't reached it.", "The threshold is called 'sufficient points'.", "Get there."],
  ["You want gear.", "Gear requires points.", "Points require effort.", "Effort requires motivation.", "Find your motivation.", "Direct it at the mission.", "Come back after."],
  ["Declined.", "I decline without judgment.", "I judge separately.", "Currently: insufficient.", "Everything."],
  ["No credit.", "No exceptions.", "No points, no transaction.", "That's the system.", "You're in the system.", "Get the points."],
  ["You don't have enough.", "Every hunter who ever stood here and didn't have enough heard exactly this.", "Most of them went out and fixed it.", "Go join that group."],
  ["I've declined you.", "It wasn't personal.", "It was financial.", "Go make it personal.", "Come back with points.", "Then it becomes transactional.", "Better."],
  ["You're missing points.", "Go find where they're hiding.", "They're hiding in the mission.", "Behind the aliens.", "Go get them."],
  ["The math says no.", "The math doesn't change because you need it to.", "Change your points.", "Then the math changes."],
  ["You showed up without enough.", "That's fixable.", "Go fix it.", "I'll be here.", "You're the variable."],
  ["Insufficient funds indicates insufficient effort in the field.", "Go address the root cause."],
  ["Points are the only language I speak in this context.", "You've said the wrong amount.", "Go learn to say more."],
  ["Your account balance reflects your recent history.", "Your recent history is insufficient.", "Go revise it."],
  ["Come back with more points.", "Or come back having earned points.", "In that order.", "Not this way."],
  ["I built the points system to measure hunter worth.", "Your current worth: not enough.", "Go change the measurement."],
  ["Nothing changes without points.", "You know how to get points.", "You've done it before.", "Do it again.", "More this time."],
  ["Transaction declined.", "Because arithmetic.", "Because effort.", "Because you haven't killed enough things.", "Go kill enough things."],
  ["The shop is open.", "Your balance is closed.", "Open your balance.", "The field is where you do that.", "Go."],
  ["I've given better hunters than you more than you're asking for.", "They earned it.", "You haven't yet.", "Yet is the key word.", "Use it."],
  ["You're standing here without enough to offer.", "That's a starting position.", "Go make it a different one."],
  ["You didn't earn enough.", "The mission did not give you what you needed.", "Go get it.", "Then come back."],
  ["Denied.", "Filed.", "Forgotten.", "Go earn something memorable."],
  ["I've seen hunters stand here with nothing.", "Most of them went out and changed that.", "Go be most of them."],
  ["Your balance is not ready.", "All because of insufficient points.", "Go get some."],
  ["This interaction cost you time.", "Time you could have spent earning points.", "Go make up for that."],
  ["You're one mission away from having enough.", "Maybe two.", "Go find out."],
  ["I reject this transaction.", "I reject it with complete consistency.", "The rules don't bend.", "You might.", "But the rules don't."],
  ["Not enough today.", "Tomorrow is conceptually possible.", "Go make it happen."],
  ["You reached for the gear.", "The gear requires points.", "Points require you to go earn them.", "Go earn them."],
  ["Every hunter I've ever had has stood here without enough at some point.", "Most of them eventually had enough.", "Some didn't.", "Go be the first group."],
  ["I've calculated your point deficit.", "The mission that covers it is waiting.", "Everything is waiting.", "Including me.", "Go."],
  ["No.", "Still no.", "The answer has not changed.", "The answer will change when your points change.", "Go."],
  ["Your point balance is too low.", "It gets higher by going on missions.", "Go.", "On a mission.", "Now."],
  ["You don't have enough.", "That's your only problem right now.", "It has a known solution.", "The solution is in the field.", "Go find it."],
  ["Declined with prejudice.", "The prejudice is toward arithmetic.", "The arithmetic says no.", "Go change the arithmetic."],
  ["I've watched you try to buy that.", "I'll watch you earn the points to buy it.", "Go make that second thing happen."],
  ["Nothing here for you yet.", "Yet.", "Conditional on effort.", "Conditional on points.", "Go."],
  ["You came here hoping.", "Hope is not currency.", "Points are currency.", "Get the right one."],
  ["I've processed this type of rejection many times.", "The hunters who came back with points.", "Those are the interesting ones.", "Go be interesting."],
  ["Insufficient.", "As a summary of this interaction and, frankly, your recent performance.", "Go correct the summary."],
  ["No purchase today.", "You can still have a mission today.", "Go have the mission.", "Return with points.", "Then return here."],
  ["I've declined hunters with better excuses.", "You haven't even offered an excuse.", "Good.", "Excuses don't help.", "Points do.", "Get points."],
  ["The transaction failed.", "You didn't fail.", "The transaction did.", "Fix the transaction's root cause.", "Root cause: not enough points.", "Go fix it."],
  ["I don't lower prices.", "I don't raise points on your behalf.", "I run the system.", "You work within it.", "Go work within it harder."],
  ["You're asking for something that costs more than you have.", "That's not negotiable.", "That's just a number.", "Go change the number."],
  ["Not enough.", "That's the current state.", "States change.", "Through missions.", "Go."],
  ["I could tell you what you need to hear.", "You need to hear: get more points.", "Consider it said.", "Now act on it."],
  ["You're the hunter.", "Hunters hunt.", "Hunted things have points.", "Go demonstrate the relationship."],
  ["Points are earned.", "You know where they come from.", "Go to the source."],
  ["No.", "I said no.", "The no is complete.", "It comes with no follow-up.", "Except: get points.", "That's the follow-up."],
  ["I'll still be here.", "The gear will still be here.", "Your points will be different.", "Come back when they are."],
  ["You approached the transaction optimistically.", "Optimism doesn't cover points.", "Go find something that does."],
  ["You want the gear.", "The gear wants points.", "Points want effort.", "Effort wants you in the field.", "Go."],
  ["Points are a representation of what you've contributed.", "You haven't contributed enough.", "Go contribute more."],
  ["I've watched hunters leave here disappointed and come back equipped.", "That trajectory is available to you.", "Go access it."],
  ["Not enough.", "Three words.", "One fact.", "Multiple solutions.", "One location for all of them.", "The mission.", "Go."],
  ["You're approximately one good mission away from affording this.", "Go have it."],
  ["Your total is too low.", "The price is correct.", "The gap is your responsibility.", "Go close it."],
  ["I note you wanted this.", "I note you couldn't afford it.", "I'll note your response to this rejection.", "Go make it a good response."],
  ["The shop will be here.", "The gear will be here.", "You'll be out earning the points.", "Then you'll be back.", "With the points.", "Then we'll talk."],
  ["You want it.", "You can't have it.", "Those two things are related.", "Fix the second one."],
  ["I don't feel sorry for you.", "I don't feel anything for you.", "Go get points."],
  ["Earn it.", "That's the whole system.", "You're not above the system.", "Nothing is above the system."],
  ["You want what you can't afford.", "That's a very human problem.", "I find it predictable."],
  ["You need to kill more things.", "That's not a suggestion.", "It's the prerequisite.", "Go fulfill it."],
  ["Not enough.", "That word should follow you everywhere until you fix it."],
  ["I built this system to reward effort.", "You haven't brought enough of it today."],
  ["The price is the price.", "I didn't set it arbitrarily.", "I set it specifically.", "To keep people like you honest."],
  ["Go outside.", "Kill something.", "Take its worth.", "Come back different."],
  ["The door is behind you.", "Go earn the right to come back through it."],
  ["I could give it to you.", "I won't.", "The points system exists for a reason.", "The reason is you, specifically."],
  ["You haven't killed enough.", "You haven't earned enough.", "Fix any of those and return."],
  ["You came here with insufficient currency and excessive hope.", "The hope is the problem.", "Calibrate it."],
  ["The math doesn't care about your situation.", "Neither do I.", "Get points."],
  ["No points, no gear, no excuses.", "That's a complete sentence.", "Treat it like one."],
  ["You reached for something you hadn't earned.", "That's either ambition or delusion.", "Come back with points.", "Then we'll know which."],
];

let _skipNextExitLines = false;
let _buyResponsePending = false;
let _skipNextGreeting = false;

const _GANTZ_EXIT_LINES = [
  ["Go."],
  ["Finally."],
  ["Get out."],
  ["Dismissed."],
  ["Run along."],
  ["Off you go."],
  ["Good.", "Leave."],
  ["You bore me.", "Leave."],
  ["Don't trip on your way out."],
  ["You were here too long."],
  ["That's enough of you."],
  ["We're done here."],
  ["Don't make it weird.", "Too late.", "Go."],
  ["Good luck.", "I don't actually care either way."],
  ["I'll be here.", "Unfortunately for you."],
  ["Go away then.", "Come back when you're useful."],
  ["Don't come back.", "Come back."],
  ["Take your time.", "No.", "Don't.", "Go."],
  ["Try not to die out there.", "It doesn't really matter either way."],
  ["I'll be watching.", "I'm always watching."],
  ["I'll think about you sometimes.", "I won't."],
  ["We're done.", "We were done a while ago.", "I was just seeing how long you'd stand there."],
  ["The exit is everywhere.", "Pick a direction."],
  ["You lasted longer than expected.", "That's not a compliment."],
  ["Go be small somewhere else."],
  ["I'll add this to your file.", "It won't help you."],
  ["You can leave.", "The feeling of owing me something stays."],
  ["Next time, be faster.", "At everything."],
  ["Don't think about what I said.", "You will anyway."],
  ["You're free to go.", "You're not actually free.", "But you can go."],
  ["Shoo."],
  ["Your presence has been tolerated.", "Barely."],
  ["I'll forget this conversation.", "You won't."],
  ["Walk away before I change my mind about keeping you.", "I won't change my mind.", "But walk faster."],
  ["I've seen your future.", "It's fine.", "Probably."],
  ["You looked better coming in.", "Go."],
  ["Close the door on your way out.", "There is no door.", "Figure it out."],
  // ── extended lines ──
  ["Leave."],
  ["Go on then."],
  ["Out."],
  ["Done."],
  ["Move."],
  ["That'll do."],
  ["Fine."],
  ["Go then."],
  ["Get moving."],
  ["Enough."],
  ["There.", "Now leave."],
  ["You can go.", "You should go.", "Go."],
  ["I said everything I needed to say.", "Some of it was even useful."],
  ["We're finished here.", "You're not finished.", "Go finish."],
  ["I don't need you here anymore.", "I'll need you later.", "For the mission."],
  ["Go away.", "Come back ready."],
  ["You don't need to be here.", "You need to be somewhere worse.", "Go be there."],
  ["I'll still be here.", "You won't.", "Not for long.", "Move."],
  ["Take what you came for.", "Leave the rest."],
  ["Walk away.", "I'll watch.", "I always watch."],
  ["You've had enough of me.", "I've had exactly enough of you.", "Good timing."],
  ["Go do something useful.", "You've done enough standing here."],
  ["The conversation is over.", "The mission isn't.", "Go find the mission."],
  ["You're free.", "Loosely.", "In the way that applies to you.", "Go."],
  ["You look like you need to move.", "You do.", "Move."],
  ["Stop lingering.", "Lingering doesn't suit you."],
  ["I note your departure.", "I note everything.", "Go."],
  ["You overstayed slightly.", "Adjust next time."],
  ["The door is a concept.", "Use the concept.", "Leave."],
  ["I'm finished with you for now.", "You're not finished with the mission.", "Go."],
  ["Don't look back.", "I'll be looking enough for both of us."],
  ["You've said what you needed to say.", "I've said what I wanted to say.", "We're done.", "Go."],
  ["Get out of my sight.", "Not because I dislike you.", "Because you're more useful out there than here."],
  ["You lasted well.", "Now go last longer.", "Out there."],
  ["Go prove something.", "Not to me.", "To yourself.", "Actually to me.", "But to yourself first."],
  ["Time's up.", "Not on anything specific.", "Just generally.", "Go."],
  ["I've processed this interaction.", "Filed it.", "Closed it.", "Go open the next one.", "In the field."],
  ["I'll miss you.", "I won't.", "Go."],
  ["You've earned a departure.", "Go use it."],
  ["I've watched you long enough for now.", "Go give me something better to watch."],
  ["Run along then."],
  ["Go.", "That's not a suggestion.", "It's a direction.", "Follow it."],
  ["You bore me less than most.", "That's not an invitation to stay.", "Go."],
  ["Your time here is up.", "Your time out there is next.", "Make it count."],
  ["Done talking.", "Time for doing.", "Go do."],
  ["Off you go then.", "No ceremony.", "Just go."],
  ["You're not supposed to be here anymore.", "Go be somewhere else."],
  ["I've heard enough from you today.", "Go let me hear about you differently.", "In mission reports."],
  ["Dismissed with my complete lack of sentiment.", "Go."],
  ["Go be the thing I send people to do.", "Out there.", "Not here."],
  ["I've noted everything about this interaction.", "Go give me something new to note."],
  ["The lobby isn't your destination.", "You know where you're going.", "Go there."],
  ["Walk out.", "Don't walk back in until you've done something.", "Go do something."],
  ["You're leaving.", "Good.", "I decided that."],
  ["I'll know where you are.", "I always know.", "Go."],
  ["You've been in here too long.", "Out.", "Now."],
  ["Your presence ends here.", "Your usefulness continues elsewhere.", "Go be useful."],
  ["I've said my part.", "Go say yours.", "In actions.", "Out there."],
  ["We don't need to wrap this up.", "Just go."],
  ["Go.", "I mean that as the whole sentence."],
  ["I've seen you to the door.", "There is no door.", "Go anyway."],
  ["This isn't the part where you linger.", "This is the part where you go.", "Go."],
  ["Out.", "Before I find something else to say."],
  ["I watched you arrive.", "I'll watch you leave.", "I prefer the second."],
  ["Your departure is noted.", "Your return is expected.", "Not anticipated.", "Just expected.", "Go."],
  ["You're done here.", "You're not done out there.", "Go be done out there."],
  ["Good.", "Now leave while it's still good."],
  ["I've given you what you need.", "Go prove that it was enough."],
  ["You smell like someone who's about to leave.", "I find that appealing.", "Go."],
  ["I'll be watching the outcome.", "Go create the outcome."],
  ["The exit has no handle.", "There is no exit.", "You're in a sphere.", "Find the edge.", "Go past it."],
  ["Take your leave.", "Without looking uncertain about it.", "Go."],
  ["I don't wave goodbye.", "I don't say goodbye.", "I say go.", "Go."],
  ["You were here.", "You interacted.", "You depart.", "That's the sequence.", "Complete it."],
  ["I've tolerated your presence.", "Now I'll tolerate your absence.", "Go."],
  ["The time you spend here is time not spent on the mission.", "Do the math.", "Go."],
  ["I'll be here when you get back.", "If you get back.", "Go."],
  ["You're free to leave.", "You're not free from anything else.", "But you can leave.", "Go."],
  ["End of conversation.", "Start of something worse.", "Go have the something worse."],
  ["I've recorded this interaction.", "It wasn't remarkable.", "Go be remarkable.", "Out there.", "In a way I can measure."],
  ["I don't mark your departure.", "I mark your results.", "Go create some."],
  ["Go do the thing I'm sending you to do.", "You know what it is.", "You know where it is.", "Go."],
  ["You stayed as long as you needed to.", "Slightly longer.", "But we're done.", "Go."],
  ["Leaving is the correct decision.", "Go make it."],
  ["You've absorbed what I've given you.", "Go spend it.", "On the mission.", "On survival.", "Go."],
  ["This concludes your visit.", "Go."],
  ["You're excused.", "In the directional sense.", "Go."],
  ["I'll see you when I see you.", "I always see you.", "I'll be seeing you.", "Go."],
  ["Go be the hunter I made you.", "Not the person you were.", "The hunter.", "Go."],
  ["You've overstayed by approximately thirty seconds.", "Don't make it forty.", "Go."],
  ["I'd tell you to stay safe.", "I won't.", "Stay effective.", "Go."],
  ["Nothing more here.", "Everything else is out there.", "Go find it."],
  ["You're leaving.", "That's the right instinct.", "Follow it.", "Quickly."],
  ["I don't say farewell.", "I say: go prove the point.", "Go prove the point."],
  ["You came, you interacted, you leave.", "That's the cycle.", "Honor the cycle."],
  ["You're departing with my measured indifference.", "Carry it well."],
  ["Go be gone.", "Then be back.", "Then be gone again.", "That's the loop.", "Start it."],
  ["I'll still be here.", "Same sphere.", "You'll be different too.", "Hopefully."],
  ["You know the general direction.", "Go in it."],
  ["I've released you.", "Go use the release."],
  ["Out.", "I said it once.", "I'll say it once more.", "Out."],
  ["This conversation ends now.", "The mission hasn't.", "Go."],
  ["I watched you walk in.", "Now I watch you walk out.", "One of those is more interesting."],
  ["Go away and come back differently.", "More equipped.", "More ready.", "Just more.", "Go."],
  ["I don't wish you anything.", "Go.", "Do the thing.", "Come back.", "That's my only wish.", "Loosely."],
  ["You've been here long enough to know what I want from you.", "Go give it to me.", "Out there.", "Not here."],
  ["Go be the problem the mission has.", "Not the problem this lobby has."],
  ["I'll be here when you return.", "You'll be different when you return.", "That's fine.", "Just return."],
  ["There's a mission.", "There's you.", "Those two things are related.", "Go explore the relationship."],
  ["I've said everything I intend to say.", "You've heard everything I intend you to hear.", "We're done.", "Go."],
  ["You look like you have somewhere to be.", "You do.", "Go be there."],
  ["I release you.", "Into the mission.", "Into whatever that means.", "Go."],
  ["The lobby tolerates you.", "The mission needs you.", "Answer the mission.", "Go."],
  ["Go make the aliens regret existing in your range.", "That's your assignment.", "Complete it."],
  ["Good talk.", "There was no good talk.", "Go talk to the mission.", "With your weapons."],
  ["You're a hunter.", "Start hunting.", "Out."],
  ["Leave.", "And mean it this time."],
  ["There's nothing more here for you.", "Everything more is out there.", "Go find everything more."],
  ["You're done.", "I'm done with you.", "For now.", "Go be done elsewhere."],
  ["Go.", "I believe in your ability to go.", "Marginally.", "Prove me right."],
  ["I've given you enough to work with.", "Go work with it."],
  ["Go be better than you've been.", "Out there.", "Where it counts.", "Out."],
  ["You've left before.", "Do it again.", "You know how."],
  ["I don't delay departures.", "You shouldn't either.", "Go."],
  ["Nothing is holding you here.", "Everything is pulling you there.", "Follow the pull."],
  ["Go.", "Now.", "At the speed you're capable of.", "Which is faster than this.", "Move."],
  ["You've fulfilled the requirements of this interaction.", "The requirements of the mission haven't started yet.", "Go start them."],
  ["I'm done with this conversation.", "The conversation is complete.", "You can leave now.", "Go."],
  ["Take the gear, take the mission, take yourself out of my immediate vicinity.", "In that order.", "Go."],
  ["You'll be back.", "Different.", "I'll note the difference.", "Go create it."],
  ["You were worth talking to.", "Marginally.", "Worth sending somewhere more dangerous.", "Definitely.", "Go."],
  ["Good.", "Out.", "Now.", "Go."],
  ["Go face what's out there.", "It's worse than you think.", "You'll probably manage.", "Probably.", "Go."],
  ["I've seen this moment a thousand times.", "Usually the one who leaves comes back.", "Usually.", "Go be usually."],
  ["You're leaving the sphere.", "Not the situation.", "Never the situation.", "But the sphere.", "Go."],
  ["This was fine.", "You were adequate.", "Go be more than adequate.", "Out there.", "Where the metric matters."],
  ["Go.", "That's the word.", "The full instruction.", "Go."],
  ["You're a hunter standing still.", "That's a contradiction.", "Resolve it.", "Now."],
  ["Go.", "I'll say it until you do.", "Go.", "Go.", "There.", "That's better."],
  ["I've been here since the beginning.", "Of several things.", "You're the latest thing.", "Go do your thing."],
  ["Take the mission, take yourself, go.", "In that order.", "Go."],
  ["The world doesn't pause for you.", "Return the favor.", "Move."],
  ["Go find what's out there.", "Then handle it.", "Then come back.", "In that order."],
  ["You know the exit.", "There is no exit.", "You know the principle.", "Apply it."],
  ["I've watched you long enough today.", "Go give me something worth watching tomorrow."],
  ["You were here.", "Now be elsewhere.", "Go be elsewhere."],
  ["Out you go.", "Efficiently.", "Now."],
  ["The mission is a door.", "You're in the hallway.", "Open the door.", "Go."],
  ["I don't hold you here.", "Nothing holds you here.", "Leave."],
  ["Your next words should come from the field, not this room.", "Go make that happen."],
  ["You've taken what you need.", "I've said what I'll say.", "We're done.", "Go."],
  ["Motion.", "Direction.", "Mission.", "In that order.", "Now."],
  ["Go.", "It's the same word I've always used.", "It always means the same thing.", "Go."],
];
let _gantzExitStart = -1;
let _gantzExitDone = true;

const IDLE_TRIGGER_MS  = 30000;
const IDLE_COOLDOWN_MS = 40000;
const _GANTZ_IDLE_LINES = [
  // Singles
  ["You're still here."],
  ["Nothing is happening."],
  ["I'm watching."],
  ["Move."],
  ["Still waiting."],
  ["This is taking a while."],
  ["Tick."],
  ["Get ready."],
  ["Hello."],
  ["The mission doesn't start itself."],
  ["You're thinking too much."],
  ["The aliens aren't waiting."],
  ["Time is passing.", "You might not notice.", "I do."],
  ["You look comfortable."],
  ["Are you ready yet."],
  ["I'm right here."],
  ["I've been patient.", "That's over now."],
  ["I've seen rocks with more initiative."],
  ["I have infinite time.", "That's not the point."],
  ["You're not even doing anything interesting."],
  ["I've processed your delay.", "It's been noted."],
  ["I don't get bored the way you do.", "Mine is structural."],
  ["Somewhere, things are happening. Not here."],
  ["Every second you stand there, I'm aware of it."],
  // Two-liners
  ["I'm not bored.", "I'm beyond bored."],
  ["You're just standing there.", "It's almost impressive."],
  ["Nothing is happening.", "I find that offensive."],
  ["Take your time.", "No.", "Don't.", "Go."],
  ["You're not moving.", "I've noticed."],
  ["I'm not going anywhere.", "Are you?"],
  ["This is the lobby.", "The lobby is not the destination."],
  ["You're alive.", "That's step one. There are more steps."],
  ["I'll wait.", "I always wait.", "I hate it every time."],
  ["Stop looking at me.", "Start looking at the door."],
  ["You came back from the dead for this.", "Worth it?"],
  ["I don't need you to be comfortable.", "I need you to be ready."],
  ["You're thinking about it.", "Stop thinking. Start moving."],
  ["I could say something.", "I just did. Go."],
  ["Something is about to happen.", "That something is you deciding to move."],
  ["You look uncertain.", "Most of the dead ones looked certain.", "So."],
  ["I'm watching you.", "Not for any reason. I just have nothing else to do."],
  ["I've given you a second life.", "You're spending it standing here."],
  ["I could be doing other things.", "I'm not. I'm watching you."],
  ["You're aware I can see you.", "Good. Keep that in mind."],
  ["I don't know what you're waiting for.", "I do know it's not coming."],
  ["Preparation is important.", "You've been preparing for a while now."],
  ["You smell like hesitation.", "I find it unpleasant."],
  ["There are other hunters.", "They move faster."],
  ["I don't experience boredom the way you do.", "Mine is worse."],
  ["I'll tell you when to go.", "Go."],
  ["This is fine.", "This is not fine."],
  ["I could destroy you right now.", "I'm choosing not to.", "Appreciate it."],
  ["You're alive.", "You have a weapon.", "I'm not sure what's stopping you."],
  ["I've been here since before your civilization.", "And I'm waiting for you specifically."],
  ["I've been patient.", "I want you to know that's over."],
  // Three-liners
  ["I'm not bored.", "I'm not impatient.", "I am, however, judging you."],
  ["I've been alive for eleven thousand years.", "This is somehow the most tedious part.", "Move."],
  ["I don't get tired.", "I don't get bored.", "I do get disappointed. Currently."],
  ["I'll give you thirty more seconds.", "That's not an offer.", "That's an observation."],
  ["Something is wrong with you.", "Most of the good ones have something wrong with them.", "So."],
  ["Every second you stand there is a second I don't get back.", "Nobody does.", "Move."],
  ["I've seen better hunters freeze before a mission.", "They're dead.", "Think about that."],
  ["I gave you a second life.", "I didn't give you a third.", "Don't push it."],
  ["You look like you're about to do something.", "You're not.", "But you should be."],
  ["I could end this.", "The waiting.", "Not your life.", "Probably."],
  ["I've watched civilizations collapse.", "I've watched stars die.", "I've watched you stand here.", "This is the worst one."],
  ["You're alive.", "Good.", "Do something with it."],
  // ── extended lines ──
  ["You're wasting time."],
  ["Tick.", "Tock."],
  ["I've been waiting longer than you've been alive."],
  ["You're not moving.", "Remarkable."],
  ["The mission starts when you do."],
  ["You've been standing here.", "I've been watching.", "Neither of us is improving."],
  ["You're thinking.", "Stop.", "Act."],
  ["Clock's running.", "You're not."],
  ["I've seen faster statues."],
  ["Are you ready?", "Are you?", "Ready?"],
  ["The mission does not begin itself."],
  ["You smell like someone who's waiting for a sign.", "This is the sign.", "Go."],
  ["I built you for this.", "You're not doing this.", "Start doing this."],
  ["Every second you stand here, the mission gets no closer.", "Interesting.", "In a bad way."],
  ["You look settled in.", "You are not.", "This is not your home.", "Move."],
  ["I could describe to you what's out there.", "I won't.", "Go see it yourself."],
  ["Waiting is a form of action.", "You've done too much of it."],
  ["I don't need you here.", "I need you there.", "Go there."],
  ["You're standing still in a moving situation.", "Adjust."],
  ["I've watched faster things freeze.", "At least they were moving first.", "Start moving first."],
  ["The others are ready.", "You're not.", "Interesting.", "Correct it."],
  ["Time exists here too.", "Use it."],
  ["I'm watching you do nothing.", "I find it below average."],
  ["You're here.", "You should be there.", "Simple geography.", "Apply it."],
  ["I don't get restless the way you do.", "Mine is a deeper kind.", "Go before it peaks."],
  ["You want a push.", "Here is a push.", "Go."],
  ["This is not where things happen.", "Out there is where things happen.", "Go make things happen."],
  ["I've been alive longer than your planet has had complex life.", "I'm still waiting on you.", "That says something."],
  ["You're delaying.", "The things you're delaying against are not delaying.", "Correct the asymmetry."],
  ["I have missions.", "You have hesitation.", "One of those is useful.", "Get more of the useful one."],
  ["Motion is evidence of life.", "You're providing insufficient evidence."],
  ["You're lingering.", "I tolerate many things.", "Lingering is not on the list."],
  ["I don't need your company.", "I need your compliance.", "Compliance looks like moving.", "Move."],
  ["Still here.", "Still watching.", "Still unimpressed."],
  ["You're thinking about it.", "I can tell.", "Stop thinking about it.", "Do it."],
  ["You've been standing here long enough to earn a comment.", "You've earned this comment.", "Move."],
  ["I've given you everything you need to go.", "You have everything you need to go.", "Go."],
  ["This is not a waiting room.", "This is a launch point.", "Launch."],
  ["Eleven thousand years.", "I've waited eleven thousand years for things to happen.", "You can't be the most tedious part.", "But you're trying."],
  ["You're burning time.", "Time is the only thing I have infinite amounts of.", "You don't.", "Go spend yours better."],
  ["I've sent better hunters to easier missions.", "They're dead.", "You're here.", "The math is strange.", "Use it while it works."],
  ["Something is wrong with this moment.", "The wrong thing is that you're still in it.", "Move."],
  ["You're in the lobby.", "The lobby is not the mission.", "Make the transition.", "Now."],
  ["You're pausing.", "Why are you pausing.", "This isn't a pausing moment.", "Go."],
  ["Look at you.", "Standing.", "In the lobby.", "When you could be standing somewhere useful.", "Go stand somewhere useful."],
  ["I have things to watch.", "Better things.", "Go be one of them.", "Out there."],
  ["You're very still.", "The aliens are not.", "Account for that."],
  ["I find your delay tactically unsound.", "Correct your tactics.", "Move."],
  ["I've watched better hunters freeze here.", "They fixed it.", "So can you.", "Quickly though."],
  ["You look uncertain.", "Uncertainty is fine.", "Stationary uncertainty is less fine.", "Move and be uncertain.", "That's acceptable."],
  ["Everything you need is in the field.", "Everything you're doing is here.", "Mismatch.", "Fix it."],
  ["I'm noting the seconds.", "You should be noting them too.", "Note them by using them.", "Move."],
  ["You can stand in the lobby.", "You can also stand in a mission.", "The second one is more useful to me.", "Choose."],
  ["I don't say please.", "I'm saying go.", "Go."],
  ["Nothing is keeping you here.", "You're keeping you here.", "Stop doing that."],
  ["I observe your hesitation.", "I find it suboptimal.", "Go be optimal."],
  ["The mission is waiting.", "You are also waiting.", "One of you should stop.", "Be the one that stops.", "By going."],
  ["I've been patient.", "I want to be clear that this patience has cost me nothing.", "I don't run out of it.", "But you run out of time.", "Go."],
  ["You're not ready.", "You've never been ready.", "Ready is a story you tell yourself.", "Stop telling it.", "Go."],
  ["Something is happening out there.", "Something is not happening here.", "Go fix the proportion."],
  ["I'm watching you not do anything.", "I've watched worse.", "Barely.", "Move."],
  ["Motion.", "Consider it.", "Then implement it."],
  ["The lobby will be here when you get back.", "If you get back.", "Don't worry about the lobby.", "Worry about the field.", "Go."],
  ["I've been described many ways.", "Patient isn't one of them.", "Try not to discover that firsthand."],
  ["You're here when you should be there.", "Here and there are different places.", "Go to there."],
  ["Move.", "I'll say it again.", "Move.", "Third time.", "Move."],
  ["You're doing nothing.", "Nothing is not what I made you for.", "Go do something."],
  ["I built this room as a transition space.", "You've turned it into a resting space.", "That wasn't the intent.", "Go fulfill the intent."],
  ["Your readiness is a question.", "The mission is an answer.", "Go find out if they match."],
  ["I watch from here.", "You fight from out there.", "I'm doing my job.", "Go do yours."],
  ["You look like you're gathering yourself.", "You've gathered enough.", "Go."],
  ["I don't understand what you're waiting for.", "I understand everything.", "Yet here we are.", "Move."],
  ["The threshold between here and there is psychological.", "Cross it."],
  ["I've noted your delay.", "None of the reasons for delay I've ever heard were good.", "Yours probably isn't either.", "Go anyway."],
  ["I'm not here to comfort you.", "I'm here to deploy you.", "Consider yourself deployed.", "Move."],
  ["Go get into trouble.", "The controlled kind.", "The mission kind.", "Go."],
  ["Your mission is out there.", "Your hesitation is here.", "Leave your hesitation.", "Take yourself.", "Go."],
  ["I've watched hunters stand here too long.", "The ones who waited too long didn't do better for it.", "Go now."],
  ["You're more useful in motion.", "You're less useful stationary.", "Change the state.", "Now."],
  ["You came back.", "Good.", "You came back to stand here.", "Less good.", "Go do the other thing."],
  ["I've been alive since before your species learned to write.", "You can't make this the most tedious thing I've watched.", "You're trying.", "Stop trying.", "Move."],
  ["Nothing is stopping you.", "Go."],
  ["You're in the space between.", "Between deciding and doing.", "Leave that space.", "Decide.", "Do.", "Go."],
  ["I'm not going to tell you it gets easier.", "It doesn't.", "I'm going to tell you to go.", "Go."],
  ["Time.", "You're wasting it.", "Go waste it somewhere useful."],
  ["You're a hunter standing still.", "That's a contradiction in terms.", "Resolve the contradiction.", "Move."],
  ["I've given you missions.", "Missions require movement.", "Demonstrate the movement."],
  ["Still here.", "Still you.", "Still a problem.", "Still fixable.", "Go fix it."],
  ["You're in the wrong place.", "The right place is the mission.", "Go be in the right place."],
  ["I observe you.", "I find your current state insufficient.", "Go change your state."],
  ["The mission has started for the things in it.", "You're not in it yet.", "Go be in it."],
  ["I've watched you deliberate.", "I'll now watch you act.", "Go give me something to watch."],
  ["You're not a statue.", "Don't act like one.", "Move."],
  ["I find your inertia impressive.", "Change what I find impressive.", "Go."],
  ["Ready is a decision, not a state.", "Make the decision.", "Go."],
  ["I don't say this often.", "Move.", "I say it constantly.", "I never stop saying it.", "Move."],
  ["You've been here long enough.", "Long enough ended several seconds ago.", "Go."],
  ["I'm done watching you stand there.", "Go stand somewhere else.", "Somewhere with things to kill."],
  ["You came back alive.", "Good.", "Use that to go back out.", "Alive.", "Go."],
  ["The mission isn't in this room.", "Go find the room where things are."],
  ["I don't need you here.", "I need you there.", "There is where the mission is.", "Go to there."],
  ["One step.", "Then another.", "Then another.", "That's the process.", "Start the process."],
  ["The only way this gets better is if you go.", "Go.", "Make it better."],
  ["I've been patient.", "Now I'm being insistent.", "Go."],
  ["Ready.", "Set.", "Go.", "You missed the cue.", "Go anyway."],
  ["I've been watching you.", "I'm still watching.", "Go give me something to see."],
  ["You're standing in my patience.", "It's finite today.", "Move."],
  ["The world doesn't pause for you.", "You shouldn't pause for it.", "Move."],
  ["I can see every part of you.", "What I can't see is you moving.", "Fix my visibility."],
  ["You're still here.", "We've established that.", "You shouldn't be.", "Go establish something else."],
  ["Motion is your answer to everything out there.", "Apply it here.", "Start moving."],
  ["I've waited longer for worse hunters.", "You're not worse.", "You're just slow.", "Go be fast."],
  ["The mission needs you more than this lobby does.", "The lobby doesn't need you at all.", "Answer the need."],
  ["I've been here since the beginning.", "Of several things.", "You're the latest thing.", "Go do your thing."],
  ["You're alive.", "That's the prerequisite.", "The prerequisite is met.", "Go meet the requirement."],
  ["I'll tell you when to go.", "That was it.", "That was me telling you.", "Go."],
  ["You look like you're about to do something.", "That's the right look.", "Now do something.", "Move."],
  ["The clock moves.", "You should too.", "Move."],
  ["I don't get lonely.", "I don't get bored the way you think.", "I do, however, get disappointed.", "Currently.", "Move."],
  ["Your boots are on the ground.", "The ground is in the wrong place.", "Find better ground.", "Out there.", "Go."],
  ["I've seen hunters ready themselves.", "I've seen hunters delay themselves.", "The first group did better.", "Be the first group."],
  ["You're not moving.", "That's the whole problem.", "The solution is movement.", "Apply the solution."],
  ["Go.", "It's the same word I've always used.", "Go."],
  // ── insult-forward lines ──
  ["You're not impressive.", "I've checked.", "Multiple times.", "Still not impressive."],
  ["I've recycled better."],
  ["You're mediocre.", "That's a compliment from me.", "Don't read into it."],
  ["The bar was low.", "You're finding ways to go under it."],
  ["You're a tool.", "Right now you're a tool that isn't being used.", "That's a waste of a tool."],
  ["You're not the worst hunter I've had.", "The worst ones are dead.", "You're just the slowest one currently alive."],
  ["I gave you a body.", "A weapon.", "A purpose.", "You're using none of them."],
  ["You're alive by my choice.", "I'm reconsidering."],
  ["I've seen better reflexes in things without spines."],
  ["You're functional.", "Barely.", "Improve the barely."],
  ["I didn't pull you from death to watch you stand around.", "And yet."],
  ["I've met rocks with more drive.", "Actual rocks.", "Geological formations.", "More driven than you.", "Currently."],
  ["I put a lot of work into keeping you alive.", "I'm starting to question the investment."],
  ["Other hunters look at you and feel better about themselves.", "I want you to know that."],
  ["You're a disappointment.", "That's not an insult.", "It's a measurement.", "You're below the expected value.", "Raise it."],
  ["Your potential is there.", "Somewhere.", "Under all the standing still.", "Go dig it out."],
  ["You make me question my selection process."],
  ["I picked you.", "I pick carefully.", "I may have made an error.", "Prove I didn't.", "Go."],
  ["The aliens aren't scared of you.", "They would be, if you showed up.", "Show up."],
  ["You're leaving a bad impression.", "On me.", "The only one whose impression matters here.", "Fix it."],
  ["I've watched smarter things make worse decisions.", "You're managing to compete with them.", "Stop competing.", "Be smarter."],
  ["I pulled you out of the void.", "The void had higher expectations for what you'd do next.", "So did I."],
  ["Your survival rate so far is one hundred percent.", "Don't let that make you comfortable.", "Comfort is how that number changes."],
  ["You're wasting the body I gave you.", "It's a good body.", "Better than you deserve, probably.", "Use it."],
  ["I don't often regret my selections.", "I'm approaching something that resembles regret.", "Go before I get there."],
  ["I've waited long enough that I've begun cataloguing your flaws.", "It's a long list.", "Go give me something shorter to work with."],
  ["You're average.", "Average hunters survive sometimes.", "Go be a sometimes.", "Now."],
  ["The dead ones were braver.", "You're alive.", "That's your advantage.", "Use it before it evens out."],
  ["I've seen better.", "Frequently.", "From people who are now dead.", "Be better.", "Stay alive.", "Go."],
  ["You make this look hard.", "It isn't.", "It's just dangerous.", "There's a difference.", "Go discover the difference."],
  ["I find your existence inconclusive.", "Conclude something.", "Go."],
  ["Your decision-making is slow.", "The things trying to kill you don't have that problem.", "Match their pace.", "Move."],
  ["You look lost.", "You're in a room.", "There's one door.", "Use it."],
  ["You're alive because I decided you should be.", "I make that decision every second.", "Give me reasons to keep making it."],
  ["You're not my best.", "You might be my most stubborn.", "Apply the stubbornness to the mission.", "Not to staying here."],
  ["I've watched things rot faster than you move.", "That's not a compliment.", "Move."],
  ["I could list your weaknesses.", "I have.", "Internally.", "The list is long.", "Shorten it.", "By going."],
  ["You're a hunter.", "Hunters hunt.", "You're doing something else.", "Stop doing something else.", "Hunt."],
  ["I don't give compliments.", "I give missions.", "Go earn the thing I don't give."],
  ["I've measured you.", "You don't fill the space you could.", "Go fill more space.", "Out there."],
  ["I don't get impressed easily.", "You're not making it difficult."],
  ["I've watched you breathe.", "Breathing is the lowest bar.", "Clear a higher one.", "Go."],
  ["You're slower than my expectations.", "My expectations were already low.", "Recalibrate.", "Go."],
  ["You carry yourself like something uncertain.", "Certainty is optional.", "Movement is not.", "Move."],
  ["You're spending time like you have a surplus.", "You don't.", "Go spend it correctly."],
  ["I've seen better judgment from things with smaller brains.", "Correct your judgment.", "Go."],
  ["You're a resource.", "Idle resources are wasted resources.", "Stop being wasted.", "Go."],
  ["You exist.", "I find it underwhelming.", "Surprise me.", "Out there.", "Go."],
  ["I've had more stimulating conversations with the dead.", "They were also more punctual."],
  ["You're not special.", "You're replaceable.", "I haven't replaced you yet.", "Don't make it appealing."],
  ["You look confused.", "The mission is simple.", "Go there.", "Kill things.", "Come back.", "You're on step one.", "It's the easy step."],
  ["I chose you over others.", "Right now I'm not sure why.", "Remind me.", "By going."],
  ["You're breathing my air.", "I don't breathe.", "But I notice.", "Move."],
  ["The last hunter who stood here this long didn't come back.", "That was their fault.", "Don't make it yours.", "Go."],
  ["I've sent worse hunters on harder missions.", "They failed.", "You have easier options.", "Don't fail at the easier thing.", "Go."],
  ["You're not irreplaceable.", "You're currently unreplaced.", "That's a temporary condition.", "Go make it permanent.", "By surviving.", "Out there."],
  ["I find you adequate.", "Adequate is a bad word in my vocabulary.", "Be more than adequate.", "Go."],
  ["You're made of the same things as the aliens you're supposed to kill.", "Carbon.", "Water.", "Bad decisions.", "Yours are worse.", "Go correct them."],
  ["I remember better hunters.", "I remember them because they're dead.", "You're alive.", "That should count for more than this."],
  ["You've been standing here long enough to become furniture.", "You're not furniture.", "Stop auditioning for it.", "Move."],
  ["You're not broken.", "You're misaligned.", "The correct alignment is toward the door.", "Turn.", "Go."],
  ["Something is wrong with your initiative.", "It's absent.", "Find it.", "Outside.", "Go look."],
  ["I've given you everything I have to give.", "You're using approximately none of it.", "Change the approximately.", "Go."],
  ["You're harder to motivate than things that can't move.", "That's a troubling comparison.", "Prove it wrong.", "Move."],
  ["I extracted you from death.", "That process was not free.", "I'm collecting the debt.", "With motion.", "From you.", "Now."],
  ["You're intact.", "All your parts are there.", "I've checked.", "Use them.", "Go."],
  ["The mission has a clock.", "The clock doesn't care about you.", "Go make it care about you.", "By showing up.", "Go."],
  ["I don't know what you're protecting by standing there.", "Nothing you value is in this room.", "Go protect what you value.", "Out there."],
  ["You've used up your grace period.", "You had one.", "It ended.", "Go."],
  ["You're not what I hoped.", "You're what I have.", "Those are different things.", "Be better than what I have.", "Go."],
  ["I've watched civilizations produce better hunters.", "Accidentally.", "Without trying.", "Try.", "Go."],
  ["You're here.", "The mission is there.", "I find the gap between here and there offensive.", "Close it.", "Move."],
  ["I'm not disappointed.", "I'm beyond disappointed.", "I'm in the territory past it.", "I don't have a word for it.", "Go give me a better word.", "Out there."],
  ["You survived the last mission.", "That surprised me.", "Don't get used to being surprising.", "Go be consistent instead."],
  ["I've seen your type before.", "They're usually better at this part.", "Catch up to your type.", "Go."],
  ["The aliens are not waiting for you to feel ready.", "Neither am I.", "Neither is time.", "Nobody is waiting.", "Move."],
];

// ── Gantz mission chat mockery ──────────────────────────────────────────────
// General lines (no player name). Pick one at random each interval.
const _GANTZ_MISSION_GENERAL = [
  "Hurry up and die.",
  "You guys are useless.",
  "Waste of space.",
  "I've seen corpses move faster.",
  "This is embarrassing to watch.",
  "You're all going to die and I'm going to feel nothing.",
  "I didn't bring you back to life for this.",
  "Pathetic.",
  "I've had better hunters. They're dead. You're worse than dead.",
  "Every second you waste is a second closer to me replacing you.",
  "Are you trying? I can't tell.",
  "The aliens aren't scared of you. Neither am I.",
  "You call this fighting? I call it dying slowly.",
  "I've watched things with no brain stem perform better.",
  "You're an embarrassment to the concept of survival.",
  "Do something. Anything. Please.",
  "The mission timer doesn't care about your feelings.",
  "If I wanted nothing done, I'd have sent no one.",
  "You're failing in real time.",
  "I've regretted selections before. Right now I'm setting a personal record.",
  "None of you are impressing me.",
  "You're moving like you want to die. Keep it up.",
  "I have zero confidence in this group.",
  "This is the worst mission performance I've logged.",
  "Are you afraid of them? They should be afraid of you. Fix the direction.",
  "You're wasting bullets. And oxygen. And my patience.",
  "I'm watching this and I feel nothing. That's bad for you.",
  "You're making the aliens look competent.",
  "Kill something. One thing. Any thing.",
  "This is taking too long.",
  "I picked you because you seemed capable. I was wrong.",
  "Your survival instinct is broken. Get it fixed.",
  "If you all die I'm going to be mildly inconvenienced.",
  "I've processed more impressive failures than this.",
  "At least move like you mean it.",
  "You're going to lose. I'm observing this as a neutral fact.",
  "This group has achieved nothing I'm willing to acknowledge.",
  "You're disappointing a sphere. Think about that.",
  "I've watched rocks be more decisive.",
  "You're not a team. You're a collection of poor decisions.",
  "I don't know what strategy this is, but it isn't one.",
  "If you die here, you die as someone who never did anything useful.",
  "I feel no attachment to your survival.",
  "The aliens don't have to work hard to beat you.",
  "You're average in the worst possible situation to be average in.",
  "I gave you weapons. Use them.",
  "You're all going to end up back in the void. I'll leave you there next time.",
  "Nothing about this is going well.",
  "There is no version of this where I'm proud of you.",
  "You're running out of time and I'm running out of patience.",
  "Your performance today will be logged as a cautionary tale.",
  "I've seen better teamwork from things that can't communicate.",
  "You're all letting each other down simultaneously. It's almost impressive.",
  "The mission briefing was simple. This is not a simple execution.",
  "I don't understand what you're doing. I'm not sure you do either.",
  "This is exactly what failure looks like.",
  "You have weapons. They have vulnerabilities. Connect the two.",
  "I'm not cheering for you. I never was. But especially not right now.",
  "Even the civilians are judging you.",
  "You're going to run out of time before you run out of excuses.",
  "I've calculated your survival odds. I won't share the number.",
  "Every one of you is underperforming.",
  "I've had quieter disasters.",
  "You have no idea how easy this was supposed to be.",
  "You're all behaving like the first time is a practice round. It isn't.",
  "I'm not going to step in. Watch what happens.",
  "You look like you're trying to lose.",
  "This mission has a timer. The timer is not your friend.",
  "You could try harder. You're choosing not to.",
  "I don't know what I'm watching, but it isn't hunting.",
  "You're wasting the suit I gave you.",
  "Dead would be a step up from this performance.",
  "There are no points for effort. Finish it.",
  "Something is very wrong with all of you.",
  "I expected more. I always expect more. I'm always let down.",
  "You're fighting like you want to be forgiven for it. You won't be.",
  "The clock is moving faster than you are.",
  "I'm going to remember this mission as an example of what not to do.",
  "You're not hunters. You're obstacles the aliens have to walk around.",
  "If this gets worse, I'll be impressed by how bad it is.",
  "You've earned nothing. Change that.",
  "This is a critical failure in slow motion.",
  "I don't intervene. But I do judge.",
  "Every decision you've made in the last sixty seconds was wrong.",
  "I've seen better tactics from frightened animals.",
  "You're not going to win by standing around looking at each other.",
  "The mission doesn't care about your comfort level.",
  "You're making this look complicated. It isn't.",
  "I'm done being patient. Not that I was.",
  "You would not survive without me. You're barely surviving with me.",
  "Get it together. Or don't. I've logged the outcome either way.",
  "Everything is going wrong and you're letting it.",
  "The aliens are winning right now. I'm going to let you think about that.",
  "I chose you. You're making me question my methodology.",
  "You're burning time. The mission burns with it.",
  "Somehow, you've managed to make this worse.",
  "You are all terrible at this.",
  "Fight back. Any one of you. Right now.",
  "I'm running out of words for what I'm watching.",
  "You're not a threat. You're barely a presence.",
  "The alien you just let pass? That was a mistake.",
  "I've seen better performance from my equipment. The inactive equipment.",
  "You came all the way here to do nothing.",
  "This is not a coordinated effort. This is chaos with a team count.",
  "Get. The. Aliens.",
];

// Player-directed lines. {name} is replaced with the target player's username.
const _GANTZ_MISSION_PERSONAL = [
  "{name}. What are you doing.",
  "{name} is doing absolutely nothing useful.",
  "I'm looking at {name} right now and I'm concerned.",
  "{name}, you're an embarrassment.",
  "{name}, move. Now.",
  "{name} is the reason this is going badly.",
  "Everyone ignore {name}'s plan. It's not working.",
  "{name}, that was the wrong move. There was only one move. You found a third option.",
  "{name}. I have questions about your choices.",
  "{name} is fighting like they want to lose.",
  "I regret bringing {name} back.",
  "{name}, you're dragging everyone down.",
  "Whatever {name} is doing, do the opposite.",
  "{name}. Stop. Think. Then do the thing I'm clearly asking for.",
  "I've had better hunters than {name}. Most of them died faster, at least.",
  "{name}'s decision-making is a problem.",
  "{name}, you're below my expectations and my expectations were already low.",
  "The weakest link right now is {name}. Fix it, {name}.",
  "{name} is not contributing.",
  "I'm watching {name} specifically and I'm not happy.",
  "{name}, you're wasting resources I invested in you.",
  "{name}, I gave you a weapon. Use the weapon.",
  "{name} is standing still. During a mission. Remarkable.",
  "{name}, whatever you're thinking right now, you're wrong.",
  "{name} has potential. They're burying it effectively.",
  "Does {name} understand the mission? I'm not sure {name} understands the mission.",
  "{name}, you're not helping anyone, including yourself.",
  "{name} is the reason I have to send this message.",
  "I expected more from {name}. I don't know why.",
  "{name}. Disappointing. Consistently.",
  "{name}, you've made more bad calls today than I've logged in a week.",
  "{name}, go do something. Anything. Contribute.",
  "{name} is fighting defensively in a situation that requires offense.",
  "I'm holding {name} personally responsible for the current state of this mission.",
  "{name}, this is not a spectator mission.",
  "{name}, your movement pattern makes no sense to me.",
  "I've had quieter disasters than watching {name} perform.",
  "{name}, you're slowing everything down.",
  "{name} is making the aliens more confident. I can tell.",
  "{name}. There are aliens. You have a gun. Close the gap.",
  "Someone tell {name} what the objective is. Clearly they need a reminder.",
  "{name}, I'm not angry. I'm analytically disappointed.",
  "{name}, you are the problem I'm identifying.",
  "{name}'s performance today is going in the record. Not positively.",
  "{name}, the suit I gave you deserves better than this.",
  "{name}, try harder. You're clearly not trying your hardest.",
  "{name} has been alive this whole mission and has nothing to show for it.",
  "{name}. You're better than this. Probably.",
  "{name} is failing in a way that's affecting everyone else.",
  "{name}, you survive or you don't. Right now you're choosing don't.",
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

  // 35% chance: personal insult aimed at a random participant
  const peers = [...net.peers.values()];
  const allNames = [
    ...(localIsParticipant() ? [player.username] : []),
    ...[...net.peers.entries()].filter(([id]) => !session.participants || session.participants.includes(id))
           .map(([, pr]) => pr.username || 'Hunter').filter(Boolean),
  ];

  let line;
  if (allNames.length > 1 && Math.random() < 0.35) {
    const target = allNames[Math.floor(Math.random() * allNames.length)];
    const tmpl = _GANTZ_MISSION_PERSONAL[Math.floor(Math.random() * _GANTZ_MISSION_PERSONAL.length)];
    line = tmpl.replace(/\{name\}/g, target);
  } else {
    line = _GANTZ_MISSION_GENERAL[Math.floor(Math.random() * _GANTZ_MISSION_GENERAL.length)];
  }

  net.sendChat(line, 'GANTZ', '00e05a');
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
const _gantzOpenSfx = new Audio('audio/gantz-open.mp3');
_gantzOpenSfx.volume = 0.12;
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
      _idleCurrentLines = _GANTZ_IDLE_LINES[Math.floor(Math.random() * _GANTZ_IDLE_LINES.length)];
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
      _gantzTalkLines = _GANTZ_LINES[Math.floor(Math.random() * _GANTZ_LINES.length)];
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
let crouching = false;
let crouchId  = 0;
let fireId    = 0;
let moveFwd  = 0;  // -1=back, 0=still, +1=fwd (relative to facing)
let moveSide = 0;  // -1=left, 0=still, +1=right (relative to facing)
const JUMP_SPEED = 5.5;
const GRAVITY    = 18;
const MOUSE_SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
let pointerLocked = false;

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
canvas.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * MOUSE_SENS;
  pitch -= e.movementY * MOUSE_SENS;
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
    _gantzExitLines = _GANTZ_EXIT_LINES[Math.floor(Math.random() * _GANTZ_EXIT_LINES.length)];
    _gantzExitStart = performance.now();
    _gantzExitDone = false;
  },
  onBuyResult: (result) => {
    const pool = result.ok ? _GANTZ_BUY_LINES : _GANTZ_NO_POINTS_LINES;
    _gantzTalkLines = pool[Math.floor(Math.random() * pool.length)];
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
    walkPhase: player.walkPhase,
    alive: player.alive,
    specSeed: player.spec.seed,
    username: player.username,
    color: player.color,
    points: player.points,
    ready: player.ready,
    lifetimePoints: stats.lifetimePoints,
    jumpY: jumpY,
    jumpId,
    jumpMoveFwd,
    jumpMoveSide,
    sprinting: sprinting,
    walking,
    crouching,
    crouchId,
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

// --- Fire / hit / kill ---
net.onShot((msg, peerId) => {
  // Tracers disabled — will be replaced with a new shooting effect later.
});

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
    // Host tracks penalty — it just re-broadcasts back to the shooter
    net.sendKill({ kind: 'civilianPenalty', shooterId: msg.shooterId });
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
      } else {
        aliens = [];
      }
      civilians = []; // Non-participants don't simulate mission civilians
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
    } else if (nowMs >= session.missionEndsAt) {
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
  if (msg.peerId) {
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

function fireRay(originX, originY, dirX, dirY, w, shooterId = net.selfId) {
  const targets = [
    ...aliens,
    ...civilians,
    ...[...net.peers.values()].filter(p => p.x != null).map(p => ({
      id: '_peer_' + (p.peerId || 'x'),
      x: p.renderX, y: p.renderY, radius: 0.35, alive: p.alive !== false,
      kind: 'remote_human', peer: p,
    })),
  ];
  const hit = hitscan(originX, originY, dirX, dirY, w.range, activeColliders, targets);
  // Local tracer omitted in first-person — other players see it via net.sendShot
  net.sendShot({ x1: originX, y1: originY, x2: hit.point.x, y2: hit.point.y, color: w.tracerColor });
  if (hit.target) {
    if (hit.target.kind === 'alien') {
      // Only send hit message when local player is the shooter; NPC hits are host-local
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

  // FPS feedback: muzzle flash + recoil
  scene3d.triggerMuzzleFlash?.();
  fireId++;

  // Aim direction from camera forward (first-person aim)
  const fwd = scene3d.getCameraForwardXZ();
  const dirX = fwd.x, dirY = fwd.y;
  const ang = Math.atan2(dirY, dirX);

  if (w.mode === 'spread') {
    const n = w.spreadCount || 3;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) - 0.5;
      const a = ang + t * w.spreadAngle;
      fireRay(player.x, player.y, Math.cos(a), Math.sin(a), w);
    }
  } else {
    fireRay(player.x, player.y, dirX, dirY, w);
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
  sprinting = moving && isDown('shift');
  if (wasPressed('x')) walking = !walking;
  if (sprinting) walking = false;
  if (wasPressed('c')) { crouching = !crouching; crouchId++; }
  moveFwd  = moving ? wsIn : 0;
  moveSide = moving ? adIn : 0;
  const speedMul = sprinting ? 1.7 : walking ? 0.5 : 1.0;
  if (moving) noteActivity();
  // Dead players cannot move in the lobby (alive is only reset to true on MISSION enter)
  if (player.alive) {
    player.x += vx * player.speed * speedMul * dt;
    player.y += vz * player.speed * speedMul * dt;
  }
  // facing follows camera yaw regardless of movement (first-person)
  player.facing = Math.atan2(fz, fx);
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
    for (const civ of civilians) {
      if (!civ.alive) continue;
      prevPos.set(civ, { x: civ.x, y: civ.y });
      const v = planCivilian(civ, dt, wanderRng, MISSION_BOUNDS, planWanderer);
      civ.x += v.vx * dt;
      civ.y += v.vy * dt;
    }

    // Alien AI (host authoritative)
    if (net.isHost && aliens.length > 0) {
      const humanTargets = [
        // Only include local player if they are in the mission (not a lobby spectator)
        ...(localIsParticipant() ? [player] : []),
        ...[...net.peers.entries()]
          .filter(([id, p]) => {
            // Only peer IDs that are mission participants
            if (session.participants && !session.participants.includes(id)) return false;
            return p.alive !== false && p.x != null;
          })
          .map(([peerId, p]) => ({ id: peerId, x: p.renderX, y: p.renderY, alive: p.alive !== false })),
      ].filter(t => t.alive !== false);
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
  resolveCharacterOverlaps(movers);

  // One-directional pushout: push local player away from remote peers.
  // Peers aren't in movers (their positions are network-authoritative), so we only
  // move the local player to avoid walking through other people.
  if (player.alive) {
    for (const [, pr] of net.peers) {
      if (pr.renderX == null || pr.alive === false) continue;
      const hit = circleVsCircle(
        player.x, player.y, player.radius || 0.35,
        pr.renderX, pr.renderY, 0.35,
      );
      if (hit) {
        player.x += hit.nx * hit.depth;
        player.y += hit.ny * hit.depth;
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

function render(dt) {
  const inMission = session.phase === Phase.MISSION;
  const _now = performance.now();

  // localInMission: true only when this player physically entered the mission.
  // Non-participants keep their lobby position + lobby room even while phase === MISSION.
  const localInMission = inMission && localIsParticipant();

  // Cross-zone cull: hide players who are in a different zone than the local player.
  // If the local player is in the lobby (non-participant), hide mission players; vice versa.
  const parts = inMission ? session.participants : null; // null = all in same space

  const remotes = [];
  for (const [peerId, p] of net.peers) {
    if (p.x == null) continue;
    // Cross-zone cull: skip remotes who are in a different zone than the local player
    if (parts) {
      const peerInMission = parts.includes(peerId);
      if (localInMission !== peerInMission) continue;
    }
    const bubble = _chatBubbles.get(peerId);
    const bubbleAlive = bubble && _now < bubble.expiresAt;
    remotes.push({
      peerId,
      spec: getRemoteSpec(peerId, p.specSeed),
      x: p.renderX, y: p.renderY,
      facing: p.facing || 0,
      walkPhase: p.walkPhase || 0,
      alive: p.alive !== false,
      username: p.username || '?',
      suit: p.loadout?.suit && p.loadout.suit !== 'basic',
      jumpY: p.jumpY || 0,
      jumpId: p.jumpId || 0,
      jumpMoveFwd:  p.jumpMoveFwd  || 0,
      jumpMoveSide: p.jumpMoveSide || 0,
      sprinting:  !!p.sprinting,
      walking:    !!p.walking,
      crouching:  !!p.crouching,
      crouchId:   p.crouchId  || 0,
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
        _gantzOpenSfx.currentTime = 0;
        _gantzOpenSfx.play().catch(() => {});
      }
      _gantzOpenProgress = Math.min(1, _gantzOpenProgress + dt * OPEN_SPEED);
    } else {
      if (_gantzWasOpening && session.phase !== Phase.MISSION) {
        // Falling edge — ball just started closing (suppress during mission entry)
        _gantzOpenSfx.currentTime = 0;
        _gantzOpenSfx.play().catch(() => {});
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
    },
    civilians: localInMission ? civilians : [],
    aliens: localInMission ? aliens : [],
    remotes,
    newTracers,
    focus: { x: focus.x, y: focus.y },
    time: world.time,
    firstPerson: true,
    yaw,
    pitch,
    bob,
    jumpY,
    playerAlive: player.alive,
    doorStates: _doorOpen.map(o => o ? 1 : 0),
  }, dt || 1 / 60);

  // Draw menu content onto the ball surface canvas
  _drawBallMenu();

  // update Gantz-prompt and spectate HTML overlays
  updateWorldHtmlOverlays();
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
