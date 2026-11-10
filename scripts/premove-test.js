#!/usr/bin/env node
// Focused regression checks for the browser premove queue.  The app is a
// browser script, so these tests evaluate only the premove declarations in a
// small VM with the DOM/engine calls replaced by recording stubs.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("site/app.js", "utf8");

function declaration(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, `site/app.js must define ${name}()`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated declaration: ${name}`);
}

const names = [
  "canMove", "canPremove", "premoveBoard", "premoveMoves", "queuePremove",
  "runPremove", "clearPremoves"
];
const context = {
  console,
  FILES: "abcdefgh",
  premoves: [],
  selected: null,
  thinking: false,
  drag: null,
  game: { playerColor: "w", turn: "w", over: null, view: null },
  pos: { turn: "w", legal: [], board: {}, pending: false },
  rendered: 0,
  played: [],
  render() { context.rendered++; },
  playMove(move) { context.played.push(move); },
  isWhite(piece) { return piece && piece === piece.toUpperCase(); },
  $(id) { return id === "promo" ? context.promo : null; },
  promo: { hidden: true },
  document: { body: { contains() { return false; } } }
};
vm.createContext(context);
for (const name of names) vm.runInContext(declaration(name), context);

function reset(opts = {}) {
  context.premoves.length = 0;
  context.selected = null;
  context.thinking = false;
  context.drag = null;
  context.rendered = 0;
  context.played.length = 0;
  context.game = { playerColor: "w", over: null, view: null };
  context.pos = { turn: "w", legal: [], pending: false, board: {
    a1: "R", e1: "K", h1: "R", e2: "P", e7: "p", e8: "k", a8: "r"
  } };
  Object.assign(context, opts);
}

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}

test("queues more than one move and clears the complete queue", () => {
  reset();
  context.queuePremove("e2e4");
  context.queuePremove("e4e5");
  assert.deepEqual([...context.premoves], ["e2e4", "e4e5"]);
  context.clearPremoves();
  assert.equal(context.premoves.length, 0);
  assert.equal(context.selected, null);
  assert.equal(context.promo.hidden, true);
});

test("projects consecutive premoves for the same piece", () => {
  reset();
  context.premoves.push("e2e4", "e4e5");
  const board = context.premoveBoard();
  assert.equal(board.e2, undefined);
  assert.equal(board.e4, undefined);
  assert.equal(board.e5, "P");
});

test("projects castling rook movement and a promoted piece's next move", () => {
  reset({ pos: { turn: "w", legal: [], pending: false, board: {
    e1: "K", h1: "R", e7: "P"
  } } });
  context.premoves.push("e1g1");
  let board = context.premoveBoard();
  assert.equal(board.e1, undefined);
  assert.equal(board.g1, "K");
  assert.equal(board.h1, undefined);
  assert.equal(board.f1, "R");

  context.premoves.push("e7e8q", "e8e5");
  board = context.premoveBoard();
  assert.equal(board.e7, undefined);
  assert.equal(board.e8, undefined);
  assert.equal(board.e5, "Q");
});

test("generates black pawn direction and all promotion choices", () => {
  reset({ game: { playerColor: "b", over: null, view: null }, pos: {
    turn: "b", legal: [], pending: false, board: { e7: "p", e8: "k" }
  } });
  const black = context.premoveMoves("e7");
  assert.deepEqual(new Set(black), new Set(["e7e6", "e7e5", "e7d6", "e7f6"]));
  context.game.playerColor = "w";
  context.pos.board = { e7: "P" };
  const promotions = context.premoveMoves("e7");
  for (const suffix of ["q", "r", "b", "n"])
    assert(promotions.includes("e7e8" + suffix), `missing e7e8${suffix}`);
});

test("runs one legal premove and retains the rest", () => {
  reset();
  context.premoves.push("e2e4", "e4e5");
  context.pos.legal = ["e2e4"];
  assert.equal(context.runPremove(), true);
  assert.deepEqual(context.played, ["e2e4"]);
  assert.deepEqual([...context.premoves], ["e4e5"]);
});

test("drops an illegal move and its dependent suffix", () => {
  reset();
  context.premoves.push("e2e4", "e4e5");
  context.pos.legal = ["d2d4"];
  assert.equal(context.runPremove(), false);
  assert.equal(context.premoves.length, 0);
  assert.equal(context.played.length, 0);
});

test("does not run while thinking, reviewing, or after game over", () => {
  for (const opts of [
    { thinking: true },
    { game: { playerColor: "w", over: null, view: 1 } },
    { game: { playerColor: "w", over: "Checkmate", view: null } }
  ]) {
    reset(opts);
    context.premoves.push("e2e4");
    context.pos.legal = ["e2e4"];
    assert.equal(context.runPremove(), false);
    assert.deepEqual(context.played, []);
    assert.deepEqual([...context.premoves], ["e2e4"]);
  }
});

test("allows premoves only during the opponent turn", () => {
  reset({ pos: { turn: "b", legal: [], pending: false, board: {} } });
  assert.equal(context.canMove(), false);
  assert.equal(context.canPremove(), true);

  context.pos.turn = "w";
  assert.equal(context.canPremove(), false);
  assert.equal(context.canMove(), true);

  context.pos.pending = true;
  assert.equal(context.canMove(), false);
  assert.equal(context.canPremove(), false);
  context.pos.pending = false;
  context.game.view = 1;
  assert.equal(context.canPremove(), false);
  context.game.view = null;
  context.game.over = "Checkmate";
  assert.equal(context.canPremove(), false);
});

if (process.exitCode) process.exit(process.exitCode);
