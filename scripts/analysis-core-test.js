#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const core = require("../site/analysis-core.js");

assert.equal(core.VERSION, "1.0.0");
const parsed = core.parsePgn('[Event "Test"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0');
assert.deepEqual(parsed.tokens, ["e4", "e5", "Nf3", "Nc6"]);
assert.equal(parsed.result, "1-0");
assert.equal(parsed.headers.Event, "Test");
assert.equal(core.parsePgn("1. d4 {comment} d5 (1... Nf6) 2. c4 $1 *").tokens.join(" "), "d4 d5 c4");
assert.throws(() => core.parsePgn("[SetUp \"1\"]\n\n1. e4 *"), /FEN/);
assert.throws(() => core.parseBoard("8/8/8/8/8/8/8/8 w - - 0 1"), /king/);
assert.equal(core.expectedScore({ wdl: [500, 300, 200] }), 0.65);
assert.equal(core.expectedScore({ cp: 0 }), 0.5);
assert.equal(core.classify({ best: { wdl: [650, 250, 100] }, played: { wdl: [600, 300, 100] } }).label, "Good");
assert.equal(core.classify({ loss: 0.06 }).label, "OK");
assert.equal(core.classify({ loss: 0.09, difficulty: { discoverability: "very-hard", naturalness: "very-unnatural", delayed: true } }).label, "Good");
assert.equal(core.classify({ loss: 0.04, difficulty: { discoverability: "very-easy", naturalness: "very-natural", immediate: true } }).label, "OK");
assert.equal(core.classify({ loss: 0, brilliant: true }).label, "Brilliant");
assert.equal(core.classify({ loss: 0.01, great: true }).label, "Great");
assert.equal(core.classify({ loss: 0.09, difficulty: { discoverability: "hard" } }).label, "OK");
assert.equal(core.classify({ loss: 0.06, difficulty: { naturalness: "very-natural" } }).label, "OK", "naturalness alone cannot downgrade");
assert.equal(core.classify({ loss: 0.03, difficulty: { discoverability: "very-hard", naturalness: "very-unnatural" } }).label, "Excellent", "difficulty cannot promote a suboptimal move to Best");
assert.equal(core.classify({ best: { wdl: [0, 1000, 0] }, played: { wdl: [800, 200, 0] }, side: "b" }).label, "Blunder");
assert.throws(() => core.classify({}), /incomplete/);
assert.throws(() => core.parsePgn("1.e4 }"), /comment/);
assert.throws(() => core.parsePgn('1. e4 *\n[Event "Second"]\n1. d4 *'), /one game/);
assert.throws(() => core.parsePgn('[Variant "Atomic"]\n1. e4 *'), /Unsupported/);
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
console.log("PASS analysis core parser, expected score, labels, asymmetric difficulty adjustments");
