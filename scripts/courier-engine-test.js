"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const engine = spawn(process.execPath, [process.argv[2] || "site/engine/stockfish-19-lite-single.js"],
  { stdio: ["pipe", "pipe", "inherit"] });
engine.stdin.on("error", error => {
  if (error.code !== "EPIPE") throw error;
});
const lines = createInterface({ input: engine.stdout })[Symbol.asyncIterator]();
const timeout = setTimeout(() => {
  console.error("Courier engine test timed out");
  process.exitCode = 1;
  engine.kill();
}, 15000);

async function query(command, end) {
  engine.stdin.write(command + "\n");
  const output = [];
  while (true) {
    const { value, done } = await lines.next();
    assert(!done, "Engine exited before replying to " + command);
    output.push(value);
    if (end.test(value)) return output.join("\n");
  }
}

async function bestMove(position, depth) {
  const output = await query("ucinewgame\n" + position + "\ngo depth " + depth, /^bestmove /);
  return output.match(/^bestmove (\S+)/m)[1];
}

async function expectDefense(position, advance, label) {
  const move = await bestMove(position, 6);
  const continuation = position + (position.includes(" moves ") ? " " : " moves ") + move;
  const replies = await query(continuation + "\ngo perft 1", /Nodes searched:/);
  assert.doesNotMatch(replies, advance, label + ": " + move + " allowed a one-step approach to the exit");
  console.log("PASS " + label + ": " + move);
}

async function run() {
  await query("isready", /^readyok$/);
  const white = await bestMove("position fen 7k/8/8/8/4P3/8/8/K7 w - - 0 1 courier=e4", 1);
  assert.match(white, /^e4[def]5$/, "White advances toward rank 8");
  const black = await bestMove("position fen k7/8/8/4p3/8/8/8/7K b - - 0 1 courier=e5", 1);
  assert.match(black, /^e5[def]4$/, "Black advances toward rank 1");
  console.log("PASS White and Black each advance toward their own exit");

  await expectDefense(
    "position fen r1bqk1pr/ppp2Ppp/2n2n2/2b1p3/3p4/8/PPPPP1PP/RNBQKBNR b KQkq - 0 6 courier=f7,g8",
    /^f7[efg]8:/m, "Black blocks the screenshot escape");

  const game = "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 courier=e2,g7" +
    " moves e2e3 c7c5 e3e4 g8f6 e4e5 d7d5 e5e6 d8a5 e6d6 b8c6 d6c7";
  await expectDefense(game, /^c7[bcd]8:/m, "Black blocks the reported PGN escape");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(timeout);
  if (!engine.killed) engine.stdin.end("quit\n");
});
