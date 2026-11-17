#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

// Exercise the shipped WASM through the same message interface as a browser Worker.
class EngineWorker {
  constructor(file) {
    this.child = spawn(process.execPath, [path.resolve(file)], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (this.onmessage) this.onmessage({ data: line });
    });
    this.child.on("error", error => { if (this.onerror) this.onerror(error); });
    this.child.stderr.on("data", chunk => { this.stderr = (this.stderr || "") + chunk; });
    this.child.stdin.on("error", () => {});
  }
  postMessage(command) { this.child.stdin.write(command + "\n"); }
  terminate() { this.child.kill(); }
}
global.Worker = EngineWorker;
const commands = [];
const sendCommand = EngineWorker.prototype.postMessage;
EngineWorker.prototype.postMessage = function (command) { commands.push(command); sendCommand.call(this, command); };
const core = require("../site/analysis-core.js");

(async () => {
  const analyzer = new core.Analyzer("site/stock-engine/stockfish-stock.js");
  try {
    const record = await analyzer.replay('[Event "Fool\'s mate"]\n1. f3 e5 2. g4 Qh4# 0-1');
    assert.deepEqual(record.moves, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    assert.equal(record.boards.length, 5);
    assert.equal(record.boards[4].turn, "w");
    assert.equal(record.boards[4].inCheck, true);
    assert.equal(record.boards[4].legal.length, 0);
    const losing = await analyzer.grade(record, 2, { depth: 10 });
    assert.equal(losing.label, "Catastrophe", "allowing an immediately obvious mate earns the worst tier");
    assert.equal(losing.mateEvidence.distance, 1);
    assert(losing.raw.mateConfirmation.depth >= 22, "short mate is independently verified after the move");
    assert.equal(losing.playedMove, "g2g4");
    assert(losing.depth >= 20, "requested shallow grade options cannot bypass depth 20");
    assert(losing.raw.best.depth >= 20 && losing.raw.played.depth >= 20);
    assert.equal(losing.config.depth, 20);
    assert(commands.includes("setoption name UCI_LimitStrength value false"));
    assert(commands.includes("setoption name Skill Level value 20"));
    assert(losing.raw && losing.difficulty, "grade must retain engine and practical-difficulty evidence");
    const winning = await analyzer.grade(record, 3, { depth: 10 });
    assert.equal(winning.bestMove, "d8h4");
    assert(["Best", "Great"].includes(winning.label), "Black's mate must be graded from Black's viewpoint");
    const blackLoss = await analyzer.replay("1. e4 f6 2. d4 g5 3. Qh5# 1-0");
    const blackBlunder = await analyzer.grade(blackLoss, 3, { depth: 10 });
    assert.equal(blackBlunder.label, "Catastrophe", "Black blunders must use Black expected score");
    // Reconstructed screenshot: Qh6 permits Qb6#, not merely Bxh6.
    const queenHang = await analyzer.replay('[SetUp "1"]\n[FEN "r1bk3r/3p1ppp/p2Q1N2/2p4q/2B5/5N2/PP3PPP/R1B1R1K1 b - - 0 16"]\n16... Qh6 *');
    const queenGrade = await analyzer.grade(queenHang, 0);
    assert.equal(queenGrade.raw.best.mateWinner, "w");
    assert.equal(Math.abs(queenGrade.raw.best.mate), 3, "best Black defense lasts until M3");
    assert.equal(Math.abs(queenGrade.raw.played.mate), 1, "Qh6 accelerates the loss to M1");
    assert.equal(queenGrade.objectiveLabel, "Catastrophe");
    assert.equal(queenGrade.label, "Catastrophe", "an obvious immediate mate is not forgiven");
    assert.equal(queenGrade.mateEvidence.distance, 1);
    assert.equal(queenGrade.lossCp, null, "mate distance is kept separate from numerical advantage loss");
    assert.equal(queenGrade.raw.mateConfirmation.pv[0], "d6b6", "Qb6# is the actual best punishment");
    const queenCapture = await analyzer.evaluate(queenHang, 1, { depth: 22, searchmoves: "c1h6" });
    assert.equal(queenCapture.mateWinner, "w");
    assert.equal(Math.abs(queenCapture.mate), 3, "Bxh6 wins but is slower than Qb6#");
    const terminal = await analyzer.evaluate(record, 4, { depth: 8 });
    assert.equal(terminal.mate, 0);
    const setup = await analyzer.replay('[SetUp "1"]\n[FEN "7k/8/8/8/8/8/4P3/K7 b - - 0 32"]\n32... Kg8 *');
    assert.equal(setup.moves[0], "h8g8");
    const pawnCapture = await analyzer.replay('[FEN "7k/8/8/8/1B6/2n5/1P6/K7 w - - 0 1"]\n1. bxc3 *');
    assert.equal(pawnCapture.moves[0], "b2c3", "SAN file b is distinct from bishop B");
    const legalMate = await analyzer.replay("1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0");
    const sacrifice = await analyzer.grade(legalMate, 8);
    assert.equal(sacrifice.label, "Brilliant");
    assert(sacrifice.specialEvidence.acceptances.some(a => a.reply === "g4d1" && a.materialChange <= -200), "Brilliant verifies the offered queen and compensation");
    const unsound = await analyzer.replay('[FEN "rnbq1rk1/pppn1ppp/4p3/3pP3/3P4/3B1N2/PPP2PPP/RN1Q1RK1 w - - 0 8"]\n8. Bxh7+ *');
    assert.notEqual((await analyzer.grade(unsound, 0)).label, "Brilliant");
    await assert.rejects(analyzer.replay("1. e4 e5 2. Bh6 *"), /Illegal|illegal/);
    const canceled = analyzer.evaluate(record, 0, { depth: 40 });
    setTimeout(() => analyzer.cancel(), 15);
    await assert.rejects(canceled, /cancel|abort/i);
    const recovered = await analyzer.evaluate(record, 0, { depth: 6 });
    assert(recovered.depth >= 6, "a canceled analyzer must remain reusable");
    console.log("PASS real WASM PGN replay, White/Black grading, immediate mate, FEN start, illegal SAN, cancellation recovery");
  } finally { analyzer.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
