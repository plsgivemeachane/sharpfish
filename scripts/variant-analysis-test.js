#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const core = require("../site/analysis-core.js");
const scp = fen => ({ variant: { slug: "scp-096", supported: false }, moves: ["e2e4"], boards: [{ fen }] });
const remorse = (guilty, ready) => ({ variant: { slug: "remorse", analysisMode: "standard-snapshot" }, moves: ["e2e4"], boards: [{ fen: core.START_FEN, guilty, ready }] });
const fen = "rnbqkbnr/pppppppp/8/3*4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
assert(core.supportsRecord(scp(fen)), "old saved SCP records must become analyzable");
assert(core.supportsRecord({ variant: { slug: "alternating-colors", supported: false } }));
assert(core.supportsRecord({ variant: { slug: "sufferfish", supported: false } }));
assert.equal(core.supportsRecord({ variant: { slug: "unknown-custom", supported: false } }), false);
assert(core.supportsRecord(remorse(["e4"], ["a1"])));
assert(core.snapshotAnalysis(remorse([], [])));
const remorseEp = { variant: { slug: "remorse" }, moves: ["d7d5"], boards: [null, {
  fen: "7k/8/8/3pP3/8/8/8/7K w - - 0 2", guilty: ["e5"]
}] };
assert.equal(core.analysisFen(remorseEp, 1), "7k/8/8/3pP3/8/8/8/7K w - d6 0 2", "stock analysis can consider an en passant capture barred by guilt");
assert.throws(() => core.analysisFen({ variant: { slug: "remorse" }, boards: [{
  fen: "4k3/8/8/8/8/8/4R3/K7 w - - 0 2", guilty: ["e2"]
}] }, 0), /check/i, "stock analysis must not receive an orthodox position with the wrong king in check");
assert.equal(core.analysisFen(scp(fen), 0), core.START_FEN, "remove SCP and merge empty squares");
assert.equal(core.analysisFen(scp("4k3/8/8/8/8/8/4P3/4K3 w KQkq e6 0 10"), 0), "4k3/8/8/8/8/8/4P3/4K3 w - - 0 10", "repair absent rooks and stale EP");
assert.throws(() => core.analysisFen(scp("8/8/8/8/8/8/4P3/4K2* b - - 0 1"), 0), /king/i);
assert.throws(() => core.analysisFen(scp("4k3/8/4*3/8/8/8/4R3/4K3 w - - 0 1"), 0), /check/i, "removing the blocker cannot leave the other king already checked");
assert.throws(() => core.analysisFen(scp("4k3/8/4?3/8/8/8/4P3/4K3 w - - 0 1"), 0), /FEN/i);
const a = scp(fen), b = scp(fen.replace("3*4", "4*3"));
assert.notEqual(core.historyKey(a, 1), core.historyKey(b, 1), "same UCI moves with a different variant snapshot cannot share grades");
assert.notEqual(core.historyKey(remorse(["e4"], []), 1), core.historyKey(remorse(["d4"], []), 1), "guilt state changes history identity");
assert.equal(a.boards[0].fen, fen, "projection never edits recorded replay");
const grades = Array.from({ length: 10 }, () => ({ side: "b", legalMoveCount: 20, qualityLossCp: 0 }));
const performance = core.performanceSummary({ moves: Array(10).fill("e2e4"), boards: Array(10).fill({ turn: "w", legal: ["e2e4"] }) }, grades);
assert.equal(performance.b.analyzed, 10, "performance uses analysis-side metadata");
assert.equal(performance.b.decisions, 10, "performance uses standard legal choices");
assert.equal(performance.b.elo, 2800);
console.log("PASS legacy variant support, SCP projection/validation, metadata repair, immutable snapshots, distinct fingerprints and standard performance decisions");
