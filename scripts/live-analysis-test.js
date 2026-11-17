#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const pending = [], statuses = [], saved = [], store = new Map();
const context = {
  localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  STOCK_ENGINE_FILE: "test-engine",
  SFAnalysis: {
    historyKey: (record, ply) => record.moves.slice(0, ply).join(" "),
    isValidGrade: (grade, record, index, engine, specialMoves) => !!grade && grade.specialMoves === specialMoves,
    Analyzer: class {
      grade(record, index, options) { return new Promise((resolve, reject) => { this.reject = reject; pending.push({ index, options, resolve, reject }); }); }
      dispose() { if (this.reject) this.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })); }
    }
  },
  SFHistory: { updateGrades: async (id, revision, patch) => saved.push(patch) },
  SFAppHooks: { onGradeStatus: text => statuses.push(text), setGrade: () => {} }
};
context.window = context;
vm.runInNewContext(fs.readFileSync(require.resolve("../site/live-analysis.js"), "utf8"), context);
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const live = context.SFLive;
  assert.equal(live.init(), false);
  assert.equal(live.specialMoves(), true);
  live.schedule({ id: "game", revision: 1, moves: ["a", "b", "c"], grades: {} });
  live.toggle(true);
  assert.equal(pending[0].index, 2, "latest live move is graded before the older backlog");
  pending.shift().resolve({ specialMoves: true });
  await settle();
  assert.equal(pending[0].index, 1, "older moves are filled in afterward");
  live.setSpecialMoves(false);
  await settle();
  assert.equal(pending.at(-1).index, 2);
  assert.equal(pending.at(-1).options.specialMoves, false, "special-grade preference reaches the engine");
  assert.equal(store.get("sharpfish-special-grading"), "0");
  live.toggle(false);
  const count = pending.length;
  await settle();
  assert.equal(pending.length, count, "turning grading off cancels instead of draining the backlog");
  assert(saved.length > 0);
  pending.length = 0;
  live.schedule({ id: "retry-game", revision: 1, moves: ["Be2", "reply"], grades: {} });
  live.toggle(true);
  pending.shift().resolve({ specialMoves: false });
  await settle();
  assert.equal(pending[0].index, 0);
  pending.shift().reject(new Error("temporary engine failure"));
  await settle();
  assert.equal(pending[0].index, 0, "a failed Be2 grade is retried automatically");
  pending.shift().resolve({ specialMoves: false });
  await settle();
  assert.equal(statuses.at(-1), "Moves graded");
  live.cancel();
  live.schedule({ id: "bounded", revision: 1, moves: ["old-line"], grades: {} });
  pending.shift().reject(new Error("persistent failure"));
  await settle();
  pending.shift().reject(new Error("persistent failure"));
  await settle();
  assert.equal(pending.length, 0, "persistent failures stop after two bounded attempts");
  assert.match(statuses.at(-1), /could not be graded/);
  live.schedule({ id: "bounded", revision: 2, moves: ["new-line"], grades: {} });
  assert.equal(pending[0].index, 0, "a failure at the same index on an old line does not skip a new move");
  live.toggle(false);
  await settle();
  live.cancel(); pending.length = 0;
  const delivered = [];
  context.SFAppHooks.setGrade = (index, grade, id, revision) => delivered.push({ index, id, revision });
  let releaseSave;
  context.SFHistory.updateGrades = (id, revision) => revision === 1 ? new Promise(resolve => { releaseSave = resolve; }) : Promise.resolve();
  live.schedule({ id: "save-race", revision: 1, moves: ["Be2"], grades: {} });
  live.toggle(true);
  pending.shift().resolve({ specialMoves: false });
  await settle();
  live.schedule({ id: "save-race", revision: 2, moves: ["Be2", "reply"], grades: {} });
  assert(delivered.some(g => g.index === 0 && g.revision === 2), "a completed grade is delivered to the newer game revision while its original save is pending");
  releaseSave(); await settle();
  live.toggle(false); await settle();
  console.log("PASS latest-first grading, settings, cancellation, bounded retry, changed lines and grade delivery across a concurrent move/save");
})().catch(error => { console.error(error); process.exitCode = 1; });
