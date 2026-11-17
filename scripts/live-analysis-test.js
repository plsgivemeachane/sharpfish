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
      grade(record, index, options) { return new Promise((resolve, reject) => { this.reject = reject; pending.push({ index, options, resolve }); }); }
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
  console.log("PASS latest-first live grading, ordinary-grade toggle, persistence and cancellation");
})().catch(error => { console.error(error); process.exitCode = 1; });
