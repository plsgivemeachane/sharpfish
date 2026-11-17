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
    async function timedGrade(record, index, options) {
      const budget = options && options.movetime || 2000;
      const start = performance.now(), first = commands.length;
      const grade = await analyzer.grade(record, index, Object.assign({ depth: 40 }, options));
      const elapsed = performance.now() - start;
      assert(elapsed < budget + 1000, `grade took ${elapsed.toFixed(0)}ms, exceeding its thinking budget plus transport allowance`);
      const searches = commands.slice(first).filter(c => c.startsWith("go ") && !c.startsWith("go perft"));
      assert(searches.length > 0 && searches.every(c => /^go movetime \d+/.test(c)), "every grading search is time-bounded");
      assert(searches.every(c => !/depth (?:20|22|40)\b/.test(c)), "old depth floors and requested depth do not extend grading");
      assert.equal(grade.config.movetime, budget);
      console.log(`TIMING ply ${index + 1}: ${elapsed.toFixed(0)}ms, ${searches.length} searches, depth ${grade.depth}, ${grade.label}`);
      return grade;
    }
    const losing = await timedGrade(record, 2);
    assert.equal(losing.label, "Catastrophe", "allowing an immediately obvious mate earns the worst tier");
    assert.equal(losing.mateEvidence.distance, 1);
    assert(losing.raw.mateConfirmation.depth > 0 && losing.mateEvidence.confirmed, "short mate is independently verified within the time budget");
    assert.equal(losing.playedMove, "g2g4");
    assert(losing.depth > 0);
    assert.equal(losing.config.depth, undefined);
    assert(commands.includes("setoption name UCI_LimitStrength value false"));
    assert(commands.includes("setoption name Skill Level value 20"));
    assert(losing.raw && losing.difficulty, "grade must retain engine and practical-difficulty evidence");
    const winning = await timedGrade(record, 3);
    assert.equal(winning.bestMove, "d8h4");
    assert(["Best", "Great"].includes(winning.label), "Black's mate must be graded from Black's viewpoint");
    const blackLoss = await analyzer.replay("1. e4 f6 2. d4 g5 3. Qh5# 1-0");
    const blackBlunder = await timedGrade(blackLoss, 3);
    assert.equal(blackBlunder.label, "Catastrophe", "Black blunders must use Black-oriented advantage loss");
    // Reconstructed screenshot: Qh6 permits Qb6#, not merely Bxh6.
    const queenHang = await analyzer.replay('[SetUp "1"]\n[FEN "r1bk3r/3p1ppp/p2Q1N2/2p4q/2B5/5N2/PP3PPP/R1B1R1K1 b - - 0 16"]\n16... Qh6 *');
    const queenGrade = await timedGrade(queenHang, 0);
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
    const sacrifice = await timedGrade(legalMate, 8);
    assert.equal(sacrifice.label, "Brilliant");
    assert(sacrifice.specialEvidence.acceptances.some(a => a.reply === "g4d1" && a.materialChange <= -200), "Brilliant verifies the offered queen and compensation");
    const ordinarySacrifice = await timedGrade(legalMate, 8, { specialMoves: false });
    assert(!["Brilliant", "Great"].includes(ordinarySacrifice.label));
    assert.equal(ordinarySacrifice.specialEvidence, null, "disabling special grades skips sacrifice verification");
    assert.equal(ordinarySacrifice.config.specialMoves, false);
    const clearance = await analyzer.replay('1. e4 c5 2. Nf3 d6 3. c4 e6 4. Nc3 Nf6 5. Bd3 Nc6 6. O-O Nd4 7. Nxd4 cxd4 8. Nb5 e5 9. b3 a6 10. Bb2 axb5 11. cxb5 Bd7 12. Rc1 Rc8 13. Rxc8 Qxc8 14. Qf3 Qd8 15. b6 Ng4 16. h3 h5 17. hxg4 hxg4 18. Qg3 Be7 19. Be2 Bh4 20. Qh2 Bxf2+ 21. Rxf2 Rxh2 22. Kxh2 Qh4+ 23. Kg1 g3 24. Rf1 Qh2# 0-1');
    for (const movetime of [2000, 5000]) {
      const clearanceGrade = await timedGrade(clearance, 39, { movetime });
      assert.equal(clearanceGrade.label, "Brilliant", "Bxf2+ is a sound bishop offer even though Rxh2 immediately wins a queen");
      assert.deepEqual(clearanceGrade.specialEvidence.acceptances.map(a => a.reply).sort(), ["f1f2", "g1f2"], "both rook and king captures must be verified");
      assert(clearanceGrade.specialEvidence.acceptances.every(a => a.offeredMaterialChange === -230 && a.materialChange === 670), "measure the offered bishop separately from the queen won back");
    }
    const exchange = await analyzer.replay('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 *');
    assert.notEqual((await timedGrade(exchange, 6)).label, "Brilliant", "an ordinary bishop-for-knight trade is not a sacrifice");
    const surplusOffer = await analyzer.replay('[FEN "r2qk2r/pp1b1pp1/1P1p4/4p3/3pP1pb/1P6/PB1PBPPQ/5RK1 b k - 5 20"]\n20... Bxf2+ *');
    const surplusOfferGrade = await timedGrade(surplusOffer, 0);
    assert(["Best", "Excellent"].includes(surplusOfferGrade.objectiveLabel), "the bishop offer remains strong with an extra rook");
    assert.notEqual(surplusOfferGrade.label, "Brilliant", "giving material back while already more than a rook ahead is excluded");
    assert.equal(surplusOfferGrade.specialEvidence, null, "surplus material skips sacrifice verification");
    const winningSurplus = await analyzer.replay('[FEN "rnbbk1nr/3p1p2/7p/ppP1N3/4P3/6B1/PPP2PPP/RN1QKB1R w KQkq - 0 10"]\n10. Qf3 *');
    const surplusGrade = await timedGrade(winningSurplus, 0);
    assert(surplusGrade.raw.played.cp > 1000);
    assert(!["Blunder", "Disaster", "Catastrophe"].includes(surplusGrade.label), "Qf3 keeps White completely winning");
    const skipped = await analyzer.replay('1. e4 b6 2. d3 e6 3. Nc3 Bd6 4. Nf3 c5 5. Be2 Be5 6. Nxe5 f6 7. Nf3 f5 *');
    assert.equal((await timedGrade(skipped, 8)).playedMove, "f1e2", "reported Be2 can receive a complete grade");
    const firstCommand = commands.length;
    const deeper = await timedGrade(skipped, 8, { movetime: 5000 });
    assert.equal(deeper.config.movetime, 5000);
    assert(commands.slice(firstCommand).some(c => /^go movetime 2000\b/.test(c)), "increasing the budget scales the actual main search");
    const unsound = await analyzer.replay('[FEN "rnbq1rk1/pppn1ppp/4p3/3pP3/3P4/3B1N2/PPP2PPP/RN1Q1RK1 w - - 0 8"]\n8. Bxh7+ *');
    assert.notEqual((await timedGrade(unsound, 0)).label, "Brilliant");
    await assert.rejects(analyzer.replay("1. e4 e5 2. Bh6 *"), /Illegal|illegal/);
    const canceled = analyzer.evaluate(record, 0, { depth: 40 });
    setTimeout(() => analyzer.cancel(), 15);
    await assert.rejects(canceled, /cancel|abort/i);
    const recovered = await analyzer.evaluate(record, 0, { depth: 6 });
    assert(recovered.depth >= 6, "a canceled analyzer must remain reusable");
    console.log("PASS real WASM PGN replay, White/Black grading, immediate mate, FEN start, illegal SAN, cancellation recovery");
  } finally { analyzer.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
