#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const core = require("../site/analysis-core.js");

function record(count, initial = "w", forced = false) {
  return { moves: Array.from({ length: count }, (_, i) => String(i)),
    boards: Array.from({ length: count }, (_, i) => ({ turn: i % 2 ? initial === "w" ? "b" : "w" : initial, legal: forced ? ["one"] : ["one", "two"] })) };
}
const game = record(12);
const grades = game.moves.map((_, i) => core.classify({ loss: i % 2 ? 50 : 20 }));
const result = core.performanceSummary(game, grades);
assert(Math.abs(result.w.accuracy - 100 * Math.exp(-0.1)) < 1e-9);
assert(result.w.elo > result.b.elo, "better decisions produce a higher performance estimate");
assert.equal(result.w.averageLossCp, 20);
assert.equal(result.b.averageLossCp, 50);
assert.equal(result.w.analyzed, 6);
assert.equal(result.w.decisions, 6);
assert(Number.isInteger(result.w.elo / 50));
assert.deepEqual(core.performanceSummary(game, grades.map(g => ({ ...g, label: "Brilliant", adjustment: 2 }))), result,
  "human forgiveness and special labels do not inflate accuracy or Elo");
const incomplete = core.performanceSummary(game, grades.slice(0, 10));
assert.equal(incomplete.w.analyzed, 5);
assert.equal(incomplete.w.elo, null, "partial coverage never produces a finished Elo estimate");
assert(incomplete.w.accuracy > 0, "partial accuracy is available with explicit coverage");
for (const missing of [null, {}, { lossCp: NaN }, { lossCp: -1 }]) {
  assert.equal(core.performanceSummary(record(1), [missing]).w.analyzed, 0, "missing scores never become perfect moves");
}
assert.equal(core.performanceSummary(record(1), [{ lossCp: 0 }]).w.accuracy, 100);
assert.equal(core.performanceSummary(record(1), [{ lossCp: 0 }]).w.elo, null, "one move cannot establish Elo");
const perfect = core.performanceSummary(game, grades.map(() => ({ lossCp: 0 })));
assert.equal(perfect.w.accuracy, 100);
assert.equal(perfect.w.elo, 2800);
const forced = core.performanceSummary(record(12, "w", true), grades);
assert.equal(forced.w.elo, null, "forced replies do not create rating evidence");
assert.equal(forced.w.decisions, 0);
assert.equal(core.performanceSummary({ ...game, boards: [] }, grades).w.elo, null, "unknown legal choices are not counted as decisions");
const blackFirst = core.performanceSummary(record(3, "b"), [{ lossCp: 0 }, { lossCp: 100 }, { lossCp: 0 }]);
assert.equal(blackFirst.b.analyzed, 2);
assert.equal(blackFirst.b.accuracy, 100);
assert(blackFirst.w.accuracy < blackFirst.b.accuracy);
const empty = core.performanceSummary({ moves: [] }, []);
assert.equal(empty.w.accuracy, null);
assert.equal(empty.w.elo, null);
const catastrophic = core.classify({ best: { cp: 0 }, played: { mate: -1, mateWinner: "b" }, side: "w",
  mateEvidence: { winner: "b", distance: 1, confirmed: true, depth: 10, bestDepth: 10 } });
catastrophic.raw = { best: { cp: 0 }, played: { mate: -1, mateWinner: "b" } };
const mate = core.performanceSummary(record(1), [catastrophic]);
assert(mate.w.accuracy < 1, "allowing a verified mate counts as a serious error");
const retainedWin = core.classify({ best: { cp: 3098 }, played: { cp: 1819 }, side: "w" });
assert(core.performanceSummary(record(1), [retainedWin]).w.accuracy > 50,
  "accuracy uses the retained-win safeguard rather than repeating raw CP over-penalization");
const collapse = core.performanceSummary(game, grades.map(() => ({ lossCp: 100000 })));
assert.equal(collapse.w.elo, 100);
assert(Number.isFinite(collapse.w.accuracy));
console.log("PASS performance coverage, per-side accuracy, monotonic Elo, forced moves, missing scores, mates, retained wins and label independence");
