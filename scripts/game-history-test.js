#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
global.localStorage = (() => {
  const data = new Map();
  return { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, v) };
})();
const history = require("../site/game-history.js");
(async () => {
  const base = { id: "one", createdAt: 1, revision: 1, moves: ["e2e4"], san: ["e4"], grades: {}, result: "*" };
  const saved = await history.save(base);
  assert.equal(saved.id, "one");
  assert.equal((await history.get("one")).moves.length, 1);
  const stale = await history.save({ ...base, revision: 0, moves: ["d2d4"] });
  assert.deepEqual(stale.moves, ["e2e4"]);
  const merged = await history.updateGrades("one", 1, { 0: { label: "Good", historyKey: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1|e2e4" } });
  assert.equal(merged.grades[0].label, "Good");
  assert.equal((await history.list()).length, 1);
  const altered = await history.save({ ...base, createdAt: 1000, moves: ["d2d4"] });
  assert.deepEqual(altered.moves, ["e2e4"], "the same revision cannot overwrite a different line");
  assert.equal(altered.createdAt, 1);
  for (let i = 0; i < 51; i++) await history.save({ id: "g" + i, createdAt: i + 2, revision: 1, moves: ["e2e4"] });
  const rows = await history.list();
  assert.equal(rows.length, 50);
  assert.equal(rows.some(row => row.id === "g0"), false);
  console.log("PASS game history revision safety and fallback persistence");
})().catch(err => { console.error(err); process.exitCode = 1; });
