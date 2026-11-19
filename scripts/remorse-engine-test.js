"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const engine = process.argv[2];
assert(engine, "Usage: node scripts/remorse-engine-test.js <engine.js or native binary>");
const worker = engine.endsWith(".js") ? spawn(process.execPath, [engine]) : spawn(engine);
const lines = createInterface({ input: worker.stdout });
const responses = lines[Symbol.asyncIterator]();
let diagnostics = "";
worker.stderr.on("data", chunk => { diagnostics += chunk; });
worker.stdin.on("error", error => { if (error.code !== "EPIPE") throw error; });
const timeout = setTimeout(() => { worker.kill(); }, 45000);

async function query(command, end) {
  worker.stdin.write(command + "\n");
  const result = [];
  for (;;) {
    const { value, done } = await responses.next();
    if (done) throw Error(`Engine exited during ${command}: ${result.join("\n")}\n${diagnostics.slice(-1000)}`);
    result.push(value.trim());
    if (end.test(value)) return result;
  }
}

async function position(fen, moves = "", depth = 1) {
  const input = fen === "startpos" ? fen : "fen " + fen;
  const out = await query(`position ${input}${moves ? " moves " + moves : ""}\nd\ngo perft ${depth}\nisready`, /^readyok/);
  const field = name => out.find(line => line.startsWith(name + ":"))?.slice(name.length + 1).trim();
  assert(field("Remorse FEN"), out.join("\n"));
  return { fen: field("Fen"), variant: field("Remorse FEN"), key: field("Key"),
    guilty: field("Remorse guilty"), ready: field("Remorse ready"), checkers: field("Checkers"),
    nodes: Number(field("Nodes searched")), legal: out.flatMap(line => line.match(/^([a-h][1-8][a-h][1-8][qrbn]?): \d+$/)?.[1] || []) };
}

async function whiteEval(fen) {
  const out = await query(`position fen ${fen}\neval\nisready`, /^readyok/);
  const value = out.find(line => line.startsWith("Final evaluation"))?.match(/[-+]?\d+\.\d+/);
  assert(value, out.join("\n"));
  return Number(value[0]);
}

async function run() {
  assert.equal((await position("startpos")).nodes, 20);
  assert.equal((await position("startpos", "", 3)).nodes, 8902);

  const rook = "6k1/8/n7/8/p7/8/RB6/7K w - - 0 1";
  const captured = await position(rook, "a2a4 g8f8");
  assert.equal(captured.guilty, "a4");
  assert.equal(captured.ready, "");
  assert(!captured.legal.includes("a4a6"));
  assert(captured.legal.includes("a4a5"));
  const approach = await position(rook, "a2a4 g8f8 a4a3 f8g8");
  assert.equal(approach.guilty, "a3");
  assert.equal(approach.ready, "a3");
  assert(!approach.legal.includes("a3a6"));
  const released = await position(approach.variant, "h1g1 g8f8");
  assert.equal(released.guilty, "");
  assert(released.legal.includes("a3a6"));
  assert.equal((await position(approach.variant, "a3a4")).guilty, "a4");
  assert.equal((await position(approach.variant, "b2c1")).guilty, "a3");
  assert.equal((await position(approach.variant, "a3a2")).guilty, "");
  assert.equal((await position(approach.variant)).key, approach.key);
  assert.notEqual((await position(approach.fen)).key, approach.key);
  assert.equal((await position(approach.variant)).nodes, approach.nodes);

  const near = "7k/8/8/8/Rp6/1B6/8/7K w - - 0 1";
  const nearCapture = await position(near, "a4b4 h8h7");
  assert.equal(nearCapture.guilty, "b4");
  assert.equal(nearCapture.ready, "b4");
  assert.equal((await position(nearCapture.variant, "h1g1")).guilty, "");
  const enemyBishop = await position(near.replace("1B6", "1b6"), "a4b4 h8h7");
  assert.equal(enemyBishop.ready, "");
  assert.equal((await position(enemyBishop.variant, "h1g1")).guilty, "b4");

  const bishop = "7k/8/8/4p3/8/2p5/1B6/7K w - - 0 1";
  const bishopCapture = await position(bishop, "b2c3 h8g8");
  assert.equal(bishopCapture.guilty, "c3");
  assert(!bishopCapture.legal.includes("c3e5"));
  assert(bishopCapture.legal.includes("c3d4"));
  const bishopAfter = await position(bishopCapture.variant, "c3d4 g8h8");
  assert.equal(bishopAfter.guilty, "");
  assert(bishopAfter.legal.includes("d4e5"));
  const together = "7k/8/8/8/8/8/RB6/N6K w - - 0 1 guilt=301";
  assert.equal((await position(together)).ready, "a1 a2 b2");
  assert.equal((await position(together, "h1g1")).guilty, "");
  const blackCapture = await position("7k/1b6/2P5/8/4P3/8/8/7K b - - 0 1", "b7c6 h1g1");
  assert.equal(blackCapture.guilty, "c6");
  assert(!blackCapture.legal.includes("c6e4"));
  assert.equal((await position(blackCapture.variant, "h8g8")).guilty, "");
  const king = await position("7k/8/8/8/8/8/4p3/4K3 w - - 0 1", "e1e2");
  assert.equal(king.guilty, "e2");

  const ep = "7k/8/8/3pP3/8/8/8/7K w - d6 0 2";
  assert((await position(ep)).legal.includes("e5d6"));
  assert.equal((await position(ep, "e5d6")).guilty, "d6");
  assert(!(await position(ep + " guilt=1000000000")).legal.includes("e5d6"));
  const promotion = "r6k/1P6/8/8/8/8/8/7K w - - 0 1";
  const promoted = await position(promotion, "b7a8b h8g8");
  assert.equal(promoted.guilty, "a8");
  assert.equal(promoted.ready, "a8");
  assert.equal((await position(promoted.variant, "h1g1")).guilty, "");
  assert.equal((await position(promotion, "b7b8n")).guilty, "");

  const check = "4k3/8/8/8/8/8/4p3/K3R3 w - - 0 1";
  const noCheck = await position(check, "e1e2");
  assert.equal(noCheck.guilty, "e2");
  assert.equal(noCheck.checkers, "");
  assert(noCheck.legal.includes("e8e7"));
  const recoveryCheck = "4k3/8/8/8/8/8/3B4/K3R3 w - - 0 1 guilt=10";
  assert.equal((await position(recoveryCheck, "a1a2")).checkers, "e1");
  const discovery = "4k3/8/8/8/8/8/4Bp2/K3R3 w - - 0 1";
  assert.equal((await position(discovery, "e2f3")).checkers, "e1");
  const pin = "k3r3/8/8/8/8/8/4N3/4K3 w - - 0 1";
  assert(!(await position(pin)).legal.includes("e2g3"));
  assert((await position(pin + " guilt=1000000000000000")).legal.includes("e2g3"));
  const castle = "k4r2/8/8/8/8/8/8/4K2R w K - 0 1";
  assert(!(await position(castle)).legal.includes("e1g1"));
  const guiltCastle = castle + " guilt=2000000000000080";
  assert((await position(guiltCastle)).legal.includes("e1g1"));
  assert.equal((await position(guiltCastle, "e1g1")).guilty, "f1 f8");
  const mate = "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1";
  assert.equal((await position(mate)).nodes, 0);
  assert.equal((await position(mate)).checkers, "g7");
  const escapedMate = await position(mate + " guilt=40000000000000");
  assert.equal(escapedMate.checkers, "");
  assert.deepEqual(escapedMate.legal, ["h8g8"]);
  const actualStalemate = await position("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(actualStalemate.nodes, 0);
  assert.equal(actualStalemate.checkers, "");

  // Same layout, different guilt mask: NNUE alone cannot distinguish these positions.
  const whiteRooks = "7k/8/8/8/R5R1/1B6/8/7K w - - 0 1";
  const whiteFree = await whiteEval(whiteRooks);
  const whiteNear = await whiteEval(whiteRooks + " guilt=1000000");
  const whiteFar = await whiteEval(whiteRooks + " guilt=40000000");
  assert(whiteFree > whiteNear && whiteNear > whiteFar);
  const blackRooks = "7k/8/1b6/r5r1/8/8/8/7K b - - 0 1";
  const blackFree = await whiteEval(blackRooks);
  const blackNear = await whiteEval(blackRooks + " guilt=100000000");
  const blackFar = await whiteEval(blackRooks + " guilt=4000000000");
  assert(blackFree < blackNear && blackNear < blackFar);

  // From the reported bot game: 14...Bd6 pulls the bishop away from two
  // ready pieces. At the same search budget, the bot should let both recover.
  const played = "g1f3 d7d5 d2d4 g8f6 c2c4 d5c4 b1c3 e7e5 f3e5 b8c6 f2f4 d8d4 d1d4 c6d4 e2e3 d4c2 c1d2 c8f5 a1c1 e8c8 g2g4 f6g4 e3e4 c2d4 e4f5 f8c5 c3a4";
  const beforeRecovery = await position("startpos", played);
  assert.match(beforeRecovery.ready, /\bc4 d4\b/);
  await query("ucinewgame\nisready", /^readyok/);
  const recoverySearch = await query(`position startpos moves ${played}\ngo nodes 25000`, /^bestmove /);
  const recoveryMove = recoverySearch.at(-1).split(" ")[1];
  assert(beforeRecovery.legal.includes(recoveryMove));
  const recovered = await position("startpos", played + " " + recoveryMove);
  for (const sq of ["c4", "d4"]) {
    const destination = recoveryMove.startsWith(sq) ? recoveryMove.slice(2, 4) : sq;
    assert(!recovered.guilty.split(" ").includes(destination), `${recoveryMove} missed recovery at ${sq}`);
  }

  for (const settings of ["", "setoption name UCI_LimitStrength value true\nsetoption name UCI_Elo value 600\n"]) {
    const result = await query(`${settings}position fen ${approach.variant}\ngo depth 5`, /^bestmove /);
    const move = result.at(-1).split(" ")[1];
    assert(approach.legal.includes(move), `Bot returned illegal move ${move}`);
  }
  assert.equal((await position(approach.variant, "", 3)).key, approach.key);
  console.log("PASS Remorse captures, recovery timing, checks, castling, promotions, en passant, position round-trips, guilt-aware evaluation and legal bot search");
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  clearTimeout(timeout);
  worker.stdin.end("quit\n");
});
