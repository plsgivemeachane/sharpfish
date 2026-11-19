#!/usr/bin/env node
// Run against a native executable or the generated .js Worker in Node.
"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const file = path.resolve(process.argv[2] || "src/stockfish");
const sent = [];
class EngineWorker {
  constructor(engine) {
    this.child = engine.endsWith(".js") ? spawn(process.execPath, [engine]) : spawn(engine, []);
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += chunk;
      const lines = buffer.split("\n"); buffer = lines.pop();
      lines.forEach(data => { if (this.onmessage) this.onmessage({ data }); });
    });
    this.child.stderr.on("data", data => { this.stderr = (this.stderr || "") + data; });
    this.child.on("error", error => { if (this.onerror) this.onerror(error); });
    this.child.on("exit", code => { if (code && this.onerror) this.onerror(new Error("Engine exited " + code + ": " + this.stderr)); });
    this.child.stdin.on("error", () => {});
  }
  postMessage(command) { sent.push(command); this.child.stdin.write(command + "\n"); }
  terminate() { this.child.kill(); }
}
global.Worker = EngineWorker;
const core = require("../site/analysis-core.js");

(async () => {
  const analyzer = new core.Analyzer(file, { atomic: true });
  try {
    const opening = await analyzer.replay('[Variant "Atomic"]\n1. e4 d5 2. exd5 *');
    assert.equal(opening.boards.length, 4);
    assert.equal(opening.boards[3].board.d5, undefined);
    assert.equal(opening.boards[3].board.e4, undefined);
    assert.equal(Object.keys(opening.boards[3].board).length, 30);
    const openingEval = await analyzer.evaluate(opening, 2, { movetime: 120 });
    assert(openingEval.depth > 0);
    assert(opening.boards[2].legal.includes(openingEval.pv[0]));
    const startFen = "7k/6p1/8/8/8/8/8/K5R1 w - - 0 1";
    const winning = await analyzer.replay('[Variant "Atomic"]\n[SetUp "1"]\n[FEN "' + startFen + '"]\n1. Rxg7# 1-0');
    assert.deepEqual(winning.moves, ["g1g7"]);
    assert.equal(winning.san[0], "Rxg7#");
    assert.equal(winning.result, "1-0");
    assert.equal(winning.boards[1].atomicResult, "white");
    assert.equal(winning.boards[1].legal.length, 0);
    assert.equal(winning.boards[1].board.h8, undefined);
    const terminal = await analyzer.evaluate(winning, 1, { movetime: 100 });
    assert.equal(terminal.mateWinner, "w");
    assert.equal(terminal.mate, 0);
    const best = await analyzer.evaluate(winning, 0, { movetime: 250, multiPV: 2 });
    assert.equal(best.pv[0], "g1g7");
    assert.equal(best.mateWinner, "w");
    const grade = await analyzer.grade(winning, 0, { movetime: 1000, specialMoves: true });
    assert.equal(grade.playedMove, "g1g7");
    assert.equal(grade.label, "Best");
    assert.equal(grade.config.atomic, true);
    assert.equal(grade.config.specialMoves, false);
    assert.equal(grade.specialEvidence, null);
    assert.equal(grade.difficulty && Object.keys(grade.difficulty).length || 0, 0);
    assert(core.isValidGrade(grade, winning, 0, file, true, 1000));
    await assert.rejects(analyzer.replay('[Variant "Atomic"]\n[FEN "' + startFen + '"]\n1. Rxg7# 0-1'), /Result/);
    await assert.rejects(analyzer.replay('[Variant "Atomic"]\n1. e4# *'), /suffix/);
    await assert.rejects(analyzer.replay('[Variant "Atomic"]\n1. e4+ *'), /suffix/);
    await assert.rejects(analyzer.replay('[Variant "Atomic"]\n[FEN "' + startFen + '"]\n1. Rxg7# Kh7 *'), /Illegal/);
    assert(sent.includes("setoption name UCI_LimitStrength value false"));
    assert(sent.includes("setoption name Skill Level value 20"));
    assert(sent.some(command => /searchmoves/.test(command)) || best.alternatives.length >= 2);
    console.log("PASS Atomic real-engine PGN replay, explosions, evaluation, MultiPV, objective grading and result validation");
  } finally { analyzer.dispose(); }
  const wrong = new core.Analyzer(path.resolve("site/stock-engine/stockfish-stock.js"), { atomic: true });
  try { await assert.rejects(wrong.replay('[Variant "Atomic"]\n1. e4 *'), /identity/); }
  finally { wrong.dispose(); }
  console.log("PASS Atomic analysis refuses an ordinary Stockfish worker");
})().catch(error => { console.error(error); process.exitCode = 1; });
