// The bots you can play, grouped by level. Each one is the same engine set to
// a UCI_Elo (in steps of 50, 0..3150), so this works for every variant.
//
// Martin (250) and Stockfish (full strength) are fixed: keep their names,
// Elo and avatars. Every other bot can be renamed, re-rated or re-drawn.
// Avatars: DiceBear 9.x "avataaars" by Pablo Stanley (free for personal and
// commercial use), saved in avatars/. Martin: Chess.com portrait; see avatars/README.md.
"use strict";

var FULL = null; // elo for full strength (no limit)

var BOT_GROUPS = [
  { name: "Beginner", bots: [
    { id: "pebble", name: "Pebble", elo: 0 },
    { id: "noodle", name: "Noodle", elo: 100 },
    { id: "martin", name: "Martin", elo: 250, fixed: true, avatar: "avatars/martin.png" },
    { id: "sunny",  name: "Sunny",  elo: 400 },
    { id: "milo",   name: "Milo",   elo: 550 },
  ] },
  { name: "Novice", bots: [
    { id: "juno",  name: "Juno",  elo: 700 },
    { id: "tobi",  name: "Tobi",  elo: 800 },
    { id: "rosa",  name: "Rosa",  elo: 900 },
    { id: "felix", name: "Felix", elo: 1000 },
    { id: "nadia", name: "Nadia", elo: 1100 },
  ] },
  { name: "Intermediate", bots: [
    { id: "omar",  name: "Omar",  elo: 1200 },
    { id: "lena",  name: "Lena",  elo: 1350 },
    { id: "kenji", name: "Kenji", elo: 1450 },
    { id: "priya", name: "Priya", elo: 1600 },
    { id: "hugo",  name: "Hugo",  elo: 1750 },
  ] },
  { name: "Advanced", bots: [
    { id: "aria",   name: "Aria",   elo: 1900 },
    { id: "viktor", name: "Viktor", elo: 2050 },
    { id: "mei",    name: "Mei",    elo: 2200 },
    { id: "dario",  name: "Dario",  elo: 2350 },
    { id: "sasha",  name: "Sasha",  elo: 2500 },
  ] },
  { name: "Master", bots: [
    { id: "ingrid",  name: "Ingrid",  elo: 2650 },
    { id: "rafael",  name: "Rafael",  elo: 2800 },
    { id: "zara",    name: "Zara",    elo: 2950 },
    { id: "nikolai", name: "Nikolai", elo: 3100 },
  ] },
  { name: "Engine", bots: [
    { id: "stockfish", name: "Stockfish", elo: FULL, fixed: true, avatar: "stockfish-logo.png" },
  ] },
];

BOT_GROUPS.forEach(function (g) {
  g.bots.forEach(function (b) { b.avatar = b.avatar || "avatars/" + b.id + ".svg"; });
});

var ELO_MIN = 0, ELO_MAX = 3150, ELO_STEP = 50;

// A bot for any Elo picked with the slider (FULL = full strength).
function customBot(elo) {
  if (elo === FULL) return findBot("stockfish");
  return { id: "custom", name: "Stockfish", elo: elo, avatar: "avatars/custom.svg", custom: true };
}

function findBot(id) {
  for (var i = 0; i < BOT_GROUPS.length; i++)
    for (var j = 0; j < BOT_GROUPS[i].bots.length; j++)
      if (BOT_GROUPS[i].bots[j].id === id) return BOT_GROUPS[i].bots[j];
  return null;
}

function botRating(bot) { return bot.elo === FULL ? "3000+" : String(bot.elo); }
