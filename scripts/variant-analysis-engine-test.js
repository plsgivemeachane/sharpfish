#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const commands = [];
global.Worker = class {
  constructor(file) {
    this.child = spawn(process.execPath, [path.resolve(file)], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop();
      lines.forEach(line => { if (this.onmessage) this.onmessage({ data: line }); });
    });
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", () => {});
    this.child.on("error", error => { if (this.onerror) this.onerror(error); });
  }
  postMessage(command) { commands.push(command); this.child.stdin.write(command + "\n"); }
  terminate() { this.child.kill(); }
};
const core = require("../site/analysis-core.js");
(async () => {
  const analyzer = new core.Analyzer(process.argv[2] || "site/stock-engine/stockfish-stock.js");
  try {
    const before = "rnbqkbnr/1ppppppp/p7/3*4/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 2";
    const after = "rnbqkbnr/1ppppppp/p7/8/4P3/5N2/PPPP1PPP/*NB1KB1R b kq - 1 2";
    const record = { id: "scp", revision: 1, variant: { slug: "scp-096", supported: false }, moves: ["e2e4", "a7a6", "g1f3"],
      boards: [{ fen: core.START_FEN }, {}, { fen: before, legal: ["a2a3"], turn: "w" }, { fen: after, legal: [], turn: "b" }] };
    const snapshot = JSON.stringify(record), fen = core.analysisFen(record, 2), start = commands.length;
    const grade = await analyzer.grade(record, 2, { movetime: 1000, specialMoves: false });
    assert.equal(grade.unavailable, undefined);
    assert.equal(grade.beforeFen, fen); assert(!Object.values(core.parseBoard(grade.beforeFen).board).includes("Q"), "already-eaten queen is not restored");
    assert.equal(grade.side, "w"); assert(grade.legalMoveCount > 1); assert(grade.analysisLegalMoves.includes("g1f3"));
    assert(core.isValidGrade(grade, record, 2, process.argv[2] || "site/stock-engine/stockfish-stock.js", false, 1000));
    const gradedCommands = commands.slice(start);
    assert(gradedCommands.includes("position fen " + fen + " moves g1f3"), "reply analysis applies only the recorded ordinary move");
    assert(!gradedCommands.some(c => c.startsWith("position ") && c.includes("*")));
    assert(!gradedCommands.some(c => c.includes("moves e2e4 a7a6")), "never reconstruct a ghost no-SCP history");
    assert(!gradedCommands.includes("position fen " + core.analysisFen(record, 3)), "automatic SCP eating does not affect grading the ordinary move");
    assert.equal(JSON.stringify(record), snapshot);
    await analyzer.evaluate(record, 3, { movetime: 100 });
    assert(commands.includes("position fen " + core.analysisFen(record, 3)), "eval uses the selected actual snapshot minus SCP");
    const pinned = { variant: record.variant, moves: ["e2d2"], boards: [{ fen: "4r2k/8/8/8/4*3/8/4R3/4K3 w - - 0 1", legal: ["e2d2"] }] };
    const unavailable = await analyzer.grade(pinned, 0, { specialMoves: false });
    assert.equal(unavailable.unavailable, true, "variant-only legal move is not given a fabricated grade");
    assert(core.isValidGrade(unavailable, pinned, 0, process.argv[2] || "site/stock-engine/stockfish-stock.js", false));
    const terminal = { variant: record.variant, moves: [], boards: [{ fen: "7k/8/8/8/8/8/8/4*3 w - - 0 1" }] };
    const first = commands.length;
    await assert.rejects(analyzer.evaluate(terminal, 0), error => error.name === "AnalysisUnavailableError");
    assert.equal(commands.slice(first).filter(c => c.startsWith("position ")).length, 0, "missing-king FEN never reaches Stockfish");
    const ordinary = await analyzer.replay("1. e4 e5 *");
    assert((await analyzer.evaluate(ordinary, 2, { depth: 6 })).depth >= 6, "worker remains usable after an unavailable variant position");
    console.log("PASS actual WASM snapshot analysis, no ghost pieces/SCP, ordinary legal moves, independent after-position, unavailable decisions/terminal safety and recovery");
  } finally { analyzer.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
