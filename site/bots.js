// The bots you can play, grouped by displayed target rating. Engine controls
// come from the versioned profile below; numbers are engine-scale estimates.
// Keep roster identities and artwork stable when updating rating profiles.
// Avatars: DiceBear 9.x "avataaars" by Pablo Stanley (free for personal and
// commercial use), saved in avatars/. Martin: Chess.com portrait; see avatars/README.md.
"use strict";

var FULL = null; // elo for full strength (no limit)
var ELO_MIN = 0, ELO_MAX = 3150, ELO_STEP = 50;

// Conditional estimates from independent engine matches; see the calibration report.
var BOT_CALIBRATION = {
  "version": "sharpfish-engine-2026-11-17-v1",
  "status": "estimated-from-engine-matches",
  "provenance": {
    "scale": "historical-Stash-CCRL-anchors; not Chess.com or FIDE",
    "games": 2400,
    "openings": 20,
    "nodes": 100000,
    "sourceRevision": "c9c4a8d0c6b02aaf78fc0f046b9adbd6a5eacd25",
    "report": "calibration/2026-11-17/report.json",
    "measurement": "native lite NNUE; browser time cap may truncate search"
  },
  "nodes": 100000,
  "supportedRange": [250, 3100],
  "knots": [
    [0, 0],
    [50, 0],
    [100, 0],
    [150, 0],
    [200, 0],
    [250, 0],
    [300, 0],
    [350, 100],
    [400, 100],
    [450, 100],
    [500, 250],
    [550, 250],
    [600, 400],
    [650, 400],
    [700, 550],
    [750, 550],
    [800, 700],
    [850, 700],
    [900, 800],
    [950, 800],
    [1000, 800],
    [1050, 900],
    [1100, 900],
    [1150, 1000],
    [1200, 1000],
    [1250, 1200],
    [1300, 1400],
    [1350, 1400],
    [1400, 1450],
    [1450, 1450],
    [1500, 1550],
    [1550, 1550],
    [1600, 1600],
    [1650, 1700],
    [1700, 1700],
    [1750, 1750],
    [1800, 1750],
    [1850, 1750],
    [1900, 2000],
    [1950, 2000],
    [2000, 2200],
    [2050, 2200],
    [2100, 2200],
    [2150, 2300],
    [2200, 2350],
    [2250, 2350],
    [2300, 2400],
    [2350, 2500],
    [2400, 2550],
    [2450, 2600],
    [2500, 2600],
    [2550, 2600],
    [2600, 2700],
    [2650, 2700],
    [2700, 2700],
    [2750, 2800],
    [2800, 2800],
    [2850, 2800],
    [2900, 2900],
    [2950, 2900],
    [3000, 3000],
    [3050, 3100],
    [3100, 3100],
    [3150, 3100]
  ]
};

function normalizeTargetElo(elo) {
  if (elo === FULL) return FULL;
  // Old saved custom values are displayed ratings, never engine controls.
  if ((typeof elo !== "number" && typeof elo !== "string") ||
      (typeof elo === "string" && !elo.trim()) || !Number.isFinite(Number(elo))) return 250;
  return Math.max(ELO_MIN, Math.min(ELO_MAX, Math.round(Number(elo))));
}

// Piecewise linear, monotonic interpolation. Reject malformed calibration
// data rather than silently introducing a reversed or uncovered rating range.
function interpolateEngineElo(target, knots) {
  if (!Array.isArray(knots) || knots.length < 2) throw new RangeError("Rating knots require both endpoints");
  knots.forEach(function (knot, i) {
    if (!Array.isArray(knot) || knot.length !== 2 || !knot.every(Number.isFinite) ||
        knot[0] < ELO_MIN || knot[0] > ELO_MAX || knot[1] < ELO_MIN || knot[1] > ELO_MAX ||
        (i && (knot[0] <= knots[i - 1][0] || knot[1] < knots[i - 1][1])))
      throw new RangeError("Rating knots must be bounded and monotonic");
  });
  if (knots[0][0] !== ELO_MIN || knots[knots.length - 1][0] !== ELO_MAX)
    throw new RangeError("Rating knots must cover 0..3150");
  target = normalizeTargetElo(target);
  if (target === FULL) return FULL;
  for (var i = 1; i < knots.length; i++) {
    if (target <= knots[i][0]) {
      var left = knots[i - 1], right = knots[i];
      return left[1] + (right[1] - left[1]) * (target - left[0]) / (right[0] - left[0]);
    }
  }
}

function ratingProfile(target, calibration, engineElo) {
  calibration = calibration || BOT_CALIBRATION;
  target = normalizeTargetElo(target);
  var control = engineElo === undefined ? interpolateEngineElo(target, calibration.knots) : engineElo;
  if (target !== FULL && !Number.isFinite(control)) throw new RangeError("Engine Elo must be finite");
  var range = calibration.supportedRange || [ELO_MIN, ELO_MAX];
  var supported = target === FULL || (target >= range[0] && target <= range[1]);
  return {
    version: calibration.version,
    target: target,
    engineElo: target === FULL ? FULL : Math.max(ELO_MIN, Math.min(ELO_MAX,
      Math.round(control / ELO_STEP) * ELO_STEP)),
    nodes: target === FULL ? null : calibration.nodes,
    estimated: target !== FULL,
    supported: supported,
    nearestRatedTarget: target === FULL ? FULL : Math.max(range[0], Math.min(range[1], target)),
    status: target === FULL ? "unrestricted" : calibration.status,
    provenance: calibration.provenance
  };
}

// Both UCI limits apply: a short safety cap can stop a rated search before its
// node budget. A rating estimate is conditional on that cap and calibration.
function botSearchConfig(selectedBot, movetime) {
  // Named opponents retain their measured engine configuration after relabeling;
  // custom opponents map a requested rating through the inverse calibration.
  var profile = ratingProfile(selectedBot.elo, null, selectedBot.engineElo);
  var time = Number(movetime);
  time = Number.isFinite(time) && time >= 1 ? Math.floor(time) : 2000;
  var commands = ["setoption name Skill Level value 20",
    "setoption name UCI_LimitStrength value " + (profile.target !== FULL)];
  if (profile.target !== FULL) commands.push("setoption name UCI_Elo value " + profile.engineElo);
  return {
    profile: profile,
    commands: commands,
    limits: { nodes: profile.nodes, movetime: time },
    go: "go " + (profile.nodes === null ? "" : "nodes " + profile.nodes + " ") + "movetime " + time
  };
}

var BOT_GROUPS = [
  { name: "Beginner", bots: [
    { id: "pebble", name: "Pebble", elo: 250, previousElo: 0, engineElo: 0 },
    { id: "noodle", name: "Noodle", elo: 450, previousElo: 100, engineElo: 100 },
    { id: "martin", name: "Martin", elo: 550, previousElo: 250, engineElo: 250, fixed: true, avatar: "avatars/martin.png" },
    { id: "sunny",  name: "Sunny",  elo: 650, previousElo: 400, engineElo: 400 },
    { id: "milo",   name: "Milo",   elo: 700, previousElo: 550, engineElo: 550 },
  ] },
  { name: "Novice", bots: [
    { id: "juno",  name: "Juno",  elo: 800, previousElo: 700, engineElo: 700 },
    { id: "tobi",  name: "Tobi",  elo: 950, previousElo: 800, engineElo: 800 },
    { id: "rosa",  name: "Rosa",  elo: 1050, previousElo: 900, engineElo: 900 },
    { id: "felix", name: "Felix", elo: 1200, previousElo: 1000, engineElo: 1000 },
    { id: "nadia", name: "Nadia", elo: 1250, previousElo: 1100, engineElo: 1100 },
  ] },
  { name: "Intermediate", bots: [
    { id: "omar",  name: "Omar",  elo: 1250, previousElo: 1200, engineElo: 1200 },
    { id: "lena",  name: "Lena",  elo: 1250, previousElo: 1350, engineElo: 1350 },
    { id: "kenji", name: "Kenji", elo: 1450, previousElo: 1450, engineElo: 1450 },
    { id: "priya", name: "Priya", elo: 1600, previousElo: 1600, engineElo: 1600 },
    { id: "hugo",  name: "Hugo",  elo: 1800, previousElo: 1750, engineElo: 1750 },
  ] },
  { name: "Advanced", bots: [
    { id: "aria",   name: "Aria",   elo: 1900, previousElo: 1900, engineElo: 1900 },
    { id: "viktor", name: "Viktor", elo: 1900, previousElo: 2050, engineElo: 2050 },
    { id: "mei",    name: "Mei",    elo: 2100, previousElo: 2200, engineElo: 2200 },
    { id: "dario",  name: "Dario",  elo: 2200, previousElo: 2350, engineElo: 2350 },
    { id: "sasha",  name: "Sasha",  elo: 2350, previousElo: 2500, engineElo: 2500 },
  ] },
  // Engine presets are unrestricted; a displayed rating must never limit them.
  { name: "Engine", bots: [
    { id: "stockfish", name: "Stockfish", elo: FULL, engineElo: FULL, fixed: true, avatar: "stockfish-logo.png" },
  ] },
];

BOT_GROUPS.forEach(function (g) {
  g.bots.forEach(function (b) {
    b.avatar = b.avatar || "avatars/" + b.id + ".svg";
    b.profile = ratingProfile(b.elo, null, b.engineElo);
  });
});

// A bot for any Elo picked with the slider (FULL = full strength).
function customBot(elo) {
  elo = normalizeTargetElo(elo);
  return { id: "custom", name: "Stockfish", elo: elo, profile: ratingProfile(elo),
    avatar: "avatars/custom.svg", custom: true };
}

function findBot(id) {
  if (id === "stockfish-full") id = "stockfish";
  for (var i = 0; i < BOT_GROUPS.length; i++)
    for (var j = 0; j < BOT_GROUPS[i].bots.length; j++)
      if (BOT_GROUPS[i].bots[j].id === id) return BOT_GROUPS[i].bots[j];
  return null;
}

function botRating(bot) {
  if (bot.elo === FULL) return "Full";
  var profile = ratingProfile(bot.elo, null, bot.engineElo);
  return bot.custom && !profile.supported ? "≈" + profile.nearestRatedTarget : String(bot.elo);
}

function botMetadata(bot) {
  if (!bot) return null;
  var profile = ratingProfile(bot.elo, null, bot.engineElo);
  return { id: bot.id, name: bot.name, elo: bot.elo, engineElo: profile.engineElo,
    ratingVersion: profile.version, searchNodes: profile.nodes };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FULL: FULL, ELO_MIN: ELO_MIN, ELO_MAX: ELO_MAX, ELO_STEP: ELO_STEP,
    BOT_CALIBRATION: BOT_CALIBRATION, BOT_GROUPS: BOT_GROUPS, normalizeTargetElo: normalizeTargetElo,
    interpolateEngineElo: interpolateEngineElo, ratingProfile: ratingProfile,
    botSearchConfig: botSearchConfig, customBot: customBot, findBot: findBot, botRating: botRating,
    botMetadata: botMetadata };
}
