#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const core = require("../site/analysis-core.js");

assert.equal(core.VERSION, "1.5.1");
const parsed = core.parsePgn('[Event "Test"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0');
assert.deepEqual(parsed.tokens, ["e4", "e5", "Nf3", "Nc6"]);
assert.equal(parsed.result, "1-0");
assert.equal(parsed.headers.Event, "Test");
assert.equal(core.parsePgn("1. d4 {comment} d5 (1... Nf6) 2. c4 $1 *").tokens.join(" "), "d4 d5 c4");
assert.throws(() => core.parsePgn("[SetUp \"1\"]\n\n1. e4 *"), /FEN/);
assert.throws(() => core.parseBoard("8/8/8/8/8/8/8/8 w - - 0 1"), /king/);
assert.equal(core.expectedScore({ wdl: [500, 300, 200] }), 0.65);
assert.equal(core.expectedScore({ cp: 0 }), 0.5);
assert.equal(core.classify({ best: { cp: 80 }, played: { cp: 40 } }).label, "Good");
assert.equal(core.classify({ loss: 60 }).label, "OK");
assert.equal(core.classify({ loss: 90, difficulty: { discoverability: "very-hard", naturalness: "very-unnatural", delayed: true } }).label, "Good");
assert.equal(core.classify({ loss: 40, difficulty: { discoverability: "very-easy", naturalness: "very-natural", immediate: true } }).label, "OK");
assert.equal(core.classify({ loss: 0, brilliant: true }).label, "Brilliant");
assert.equal(core.classify({ loss: 15, great: true }).label, "Great");
assert.equal(core.classify({ loss: 90, difficulty: { discoverability: "hard" } }).label, "OK");
assert.equal(core.classify({ loss: 60, difficulty: { naturalness: "very-natural" } }).label, "OK", "naturalness alone cannot downgrade");
assert.equal(core.classify({ loss: 30, difficulty: { discoverability: "very-hard", naturalness: "very-unnatural" } }).label, "Excellent", "difficulty cannot promote a suboptimal move to Best");
assert.equal(core.classify({ best: { cp: -100 }, played: { cp: 300 }, side: "b" }).label, "Blunder", "Black scores normalize correctly");
assert.equal(core.classify({ loss: 500 }).label, "Blunder");
assert.equal(core.classify({ loss: 501 }).label, "Disaster");
assert.equal(core.classify({ loss: 900 }).label, "Disaster", "numerical collapse alone cannot create Catastrophe");
for (const [best, played] of [[1500, 600], [-600, -1500]]) {
  const grade = core.classify({ best: { cp: best, wdl: [1000, 0, 0] }, played: { cp: played, wdl: [1000, 0, 0] } });
  assert.equal(grade.label, played >= 500 ? "Inaccuracy" : "Disaster", "retained decisive wins are capped; losses in lost positions remain visible");
  assert.equal(grade.lossCp, 900);
  assert.equal(grade.lossPoints, 9);
}
const qf3 = core.classify({ best: { cp: 3098 }, played: { cp: 1819 }, side: "w" });
assert.equal(qf3.lossCp, 1279, "retain the raw score loss for inspection");
assert(qf3.qualityLossCp > 50 && qf3.qualityLossCp < 75);
assert.equal(qf3.objectiveLabel, "OK", "Qf3 retains an overwhelming win and is not Disaster");
assert.equal(core.classify({ best: { cp: -3098 }, played: { cp: -1819 }, side: "b" }).objectiveLabel, "OK", "Black gets the same logarithmic scale");
assert.equal(core.classify({ best: { cp: 2400 }, played: { cp: 1200 } }).objectiveLabel, "Inaccuracy");
const edgeA = core.classify({ best: { cp: 1500 }, played: { cp: 300 } });
const edgeB = core.classify({ best: { cp: 1500 }, played: { cp: 299 } });
assert(Math.abs(edgeB.qualityLossCp - edgeA.qualityLossCp - 1) < 1e-9, "scale stays continuous at the threshold");
assert.equal(core.classify({ best: { cp: 2400 }, played: { cp: 0 } }).objectiveLabel, "Disaster", "losing a decisive win is still a severe error");
assert.equal(core.classify({ best: { mate: 3, mateWinner: "w" }, played: { cp: 1800 }, side: "w" }).objectiveLabel, "Inaccuracy", "missing a forced win still leaves a winning position");
assert.equal(core.classify({ best: { cp: 400 }, played: { cp: 398 }, brilliant: true }).label, "Brilliant", "a sound sacrifice is judged by evaluation, not lost material");
assert.notEqual(core.classify({ loss: 900, brilliant: true }).label, "Brilliant", "unsound material offers cannot earn Brilliant");
const shortMate = {
  side: "w", best: { cp: 0, depth: 22 }, played: { mate: -5, mateWinner: "b", depth: 22 },
  mateEvidence: { winner: "b", distance: 5, depth: 12, bestDepth: 11, confirmed: true }
};
assert.equal(core.classify(shortMate).label, "Catastrophe", "M5 is included");
assert.equal(core.classify({ ...shortMate, played: { mate: -1, mateWinner: "b" }, mateEvidence: { ...shortMate.mateEvidence, distance: 1 } }).label, "Catastrophe", "M1 is included");
assert.equal(core.classify({ ...shortMate, mateEvidence: null }).label, "Disaster", "unconfirmed mate is not Catastrophe");
assert.equal(core.classify({ ...shortMate, mateEvidence: { ...shortMate.mateEvidence, confirmed: false } }).label, "Disaster");
assert.equal(core.classify({ ...shortMate, mateEvidence: { ...shortMate.mateEvidence, distance: 6 } }).label, "Disaster", "M6 is excluded");
assert.equal(core.classify({ ...shortMate, played: { mate: -6, mateWinner: "b" } }).label, "Disaster", "both searches must confirm M5 or shorter");
assert.equal(core.classify({ ...shortMate, best: { mate: -5, mateWinner: "b" } }).label, "Best", "preserving the best mate distance does not create a new catastrophe");
assert.equal(core.classify({ ...shortMate, best: { mate: -8, mateWinner: "b" } }).label, "Catastrophe", "accelerating an already forced mate is still worse");
assert.equal(core.classify({ ...shortMate, best: { cp: -1500 } }).label, "Catastrophe", "a newly allowed short mate is recognized even in a lost CP position");
assert.equal(core.classify({ ...shortMate, side: "b", played: { mate: 5, mateWinner: "w" }, mateEvidence: { ...shortMate.mateEvidence, winner: "w" } }).label, "Catastrophe", "Black uses the same short-mate boundary");
assert.equal(core.classify({ ...shortMate, best: { mate: 5, mateWinner: "w" }, played: { mate: 5, mateWinner: "w" } }).label, "Best", "delivering mate never receives a losing-move tier");
assert.equal(core.classify({ ...shortMate, difficulty: { discoverability: "hard" } }).label, "Disaster", "short mate can still be difficult to discover");
assert.equal(core.classify({ ...shortMate, difficulty: { discoverability: "very-hard", naturalness: "very-unnatural" } }).label, "Blunder", "very hidden mate earns two-step forgiveness");
assert.equal(core.classify({ loss: 900, difficulty: { discoverability: "very-easy", naturalness: "very-natural", immediate: true } }).label, "Disaster", "ease cannot create Catastrophe without mate");
assert.equal(core.centipawnLoss({ mate: 3, mateWinner: "w" }, { mate: 1, mateWinner: "w" }, "b"), null, "mate distances are not artificial centipawns");
assert.throws(() => core.classify({ best: { cp: 0 }, played: { cp: 100 } }), /conflict/);
assert.throws(() => core.classify({ best: { wdl: [1000, 0, 0] }, played: { wdl: [1000, 0, 0] } }), /incomplete/, "WDL alone cannot determine the new grade");
const cachedRecord = { moves: ["e2e4"] };
const cachedGrade = { version: core.VERSION, model: "centipawn", depth: 8, historyKey: core.historyKey(cachedRecord, 1), config: { model: "centipawn", movetime: 2000, specialMoves: true, engine: "test-engine" } };
assert(core.isValidGrade(cachedGrade, cachedRecord, 0, "test-engine"));
const deeperGrade = { ...cachedGrade, config: { ...cachedGrade.config, movetime: 5000 } };
assert(core.isValidGrade(deeperGrade, cachedRecord, 0, "test-engine", true, 5000));
assert(!core.isValidGrade(deeperGrade, cachedRecord, 0, "test-engine", true, 2000), "analysis time is part of cache identity");
assert(!core.isValidGrade(cachedGrade, cachedRecord, 0, "test-engine", false), "special-grade settings are part of the cache identity");
assert(core.isValidGrade({ ...cachedGrade, config: { ...cachedGrade.config, specialMoves: false } }, cachedRecord, 0, "test-engine", false));
for (const broken of [
  { ...cachedGrade, version: "1.4.0" }, { ...cachedGrade, version: "1.5.0" },
  { ...cachedGrade, version: "1.0.0" }, { ...cachedGrade, depth: 0 }, { ...cachedGrade, model: "expected-score" },
  { ...cachedGrade, config: { ...cachedGrade.config, movetime: 100 } }, { ...cachedGrade, config: { engine: "test-engine" } },
  { ...cachedGrade, historyKey: "another game" }
]) assert.equal(core.isValidGrade(broken, cachedRecord, 0, "test-engine"), false);
assert.equal(core.isValidGrade(cachedGrade, cachedRecord, 0, "other-engine"), false);
assert.throws(() => core.classify({}), /incomplete/);
assert.throws(() => core.parsePgn("1.e4 }"), /comment/);
assert.throws(() => core.parsePgn('1. e4 *\n[Event "Second"]\n1. d4 *'), /one game/);
assert.equal(core.parsePgn('[Variant "Atomic"]\n1. e4 *').atomic, true);
assert.equal(core.parsePgn('1.e4 e5 2.Nf3 *').tokens.length, 3);
assert.throws(() => core.parseBoard("7k/8/8/8/8/8/8/K7 w K - 0 1"), /castling/);
assert.throws(() => core.parseBoard("7k/8/8/8/8/8/8/K7 w - e6 0 1"), /en-passant/);
const info = core.parseInfo([
  "info depth 8 multipv 1 score cp 40 wdl 100 890 10 pv e7e5",
  "info depth 8 multipv 2 score cp 10 wdl 30 950 20 pv d7d5",
  "info depth 9 multipv 1 score cp 90 lowerbound wdl 300 700 0 pv e7e5"
], "b", 2);
assert.equal(info.depth, 8);
assert.equal(info.cp, -40);
assert.deepEqual(info.wdl, [10, 890, 100]);
assert.equal(info.pv[0], "e7e5");
assert.equal(info.alternatives.length, 2);
console.log("PASS analysis parser, centipawn grading, saturated positions, mate boundaries and asymmetric difficulty");
