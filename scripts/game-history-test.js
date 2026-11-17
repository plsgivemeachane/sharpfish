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

  // A browser can expose IndexedDB while opening or committing it fails
  // (private mode, quota, or a disabled origin). Preserve the game in the
  // local/session fallback instead of rejecting the save.
  delete require.cache[require.resolve("../site/game-history.js")];
  global.indexedDB = { open() { throw new Error("IndexedDB blocked"); } };
  const blockedStorage = new Map();
  global.localStorage = { getItem: key => blockedStorage.get(key) ?? null, setItem: (key, value) => blockedStorage.set(key, value) };
  const blocked = require("../site/game-history.js");
  const fallbackSaved = await blocked.save({ id: "fallback", createdAt: 10, revision: 1, moves: ["e2e4"], boards: [] });
  assert.equal(fallbackSaved._durable, true, "localStorage fallback is still persistent");
  assert.equal((await blocked.get("fallback")).id, "fallback");
  assert.equal((await blocked.list()).length, 1);
  global.localStorage.setItem = () => { throw new Error("quota exceeded"); };
  const quotaSaved = await blocked.save({ ...fallbackSaved, revision: 2, moves: ["e2e4", "e7e5"] });
  assert.equal(quotaSaved._durable, false);
  assert.equal((await blocked.get("fallback")).revision, 2, "stale readable localStorage cannot hide a newer memory-only save");

  // If both persistent stores are blocked, the session copy still supports
  // play and returns an explicit non-durable marker on writes.
  delete require.cache[require.resolve("../site/game-history.js")];
  global.localStorage = { getItem() { throw new Error("storage blocked"); }, setItem() { throw new Error("storage blocked"); } };
  const memoryOnly = require("../site/game-history.js");
  const memorySaved = await memoryOnly.save({ id: "memory", createdAt: 11, revision: 1, moves: ["d2d4"], boards: [] });
  assert.equal(memorySaved._durable, false);
  assert.equal((await memoryOnly.get("memory")).id, "memory");
  assert.equal((await memoryOnly.list()).length, 1);
  const core = require("../site/analysis-core.js");
  const variant = await memoryOnly.save({ id: "snapshot", revision: 1, variant: { slug: "scp-096", supported: false }, moves: ["e2e4"], boards: [{ fen: core.START_FEN }] });
  const fingerprint = core.historyKey(variant, 1);
  const graded = await memoryOnly.updateGrades(variant.id, 1, { 0: { label: "Good", historyKey: fingerprint } });
  assert.equal(graded.grades[0].label, "Good", "storage accepts the shared variant snapshot fingerprint");
  const rejected = await memoryOnly.updateGrades(variant.id, 1, { 0: { label: "Blunder", historyKey: fingerprint + "different-board" } });
  assert.equal(rejected.grades[0].label, "Good", "a mismatched variant board cannot overwrite the grade");
  delete global.indexedDB;
  console.log("PASS game history revision safety and fallback persistence");
})().catch(err => { console.error(err); process.exitCode = 1; });
