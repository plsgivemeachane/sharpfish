#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const atomic = require("../site/atomic.js");

const board = { a1: "K", h8: "k", d4: "B", e5: "n", d5: "P", f5: "p", e4: "r", f6: "Q", g7: "R" };
const blast = atomic.blast(board, "d4e5");
assert.deepEqual(blast.removed.sort(), ["d4", "e4", "e5", "f6"]);
assert.deepEqual(blast.immune.sort(), ["d5", "f5"]);
const next = atomic.project(board, "d4e5");
assert.deepEqual(next, { a1: "K", h8: "k", d5: "P", f5: "p", g7: "R" });
assert.equal(board.e5, "n", "presentation projection does not mutate the engine board");
assert.equal(next.g7, "R", "explosions do not chain");
const ep = { a1: "K", h8: "k", e5: "P", d5: "p", c6: "R", d7: "p", c4: "N" };
assert.deepEqual(atomic.project(ep, "e5d6"), { a1: "K", h8: "k", d7: "p", c4: "N" });
assert.deepEqual(atomic.project({ a1: "K", h8: "k", g7: "P", h8: "r" }, "g7h8q"), { a1: "K" });
assert.deepEqual(atomic.project({ e1: "K", h1: "R", e8: "k" }, "e1g1"), { g1: "K", f1: "R", e8: "k" });
assert.equal(atomic.blast({ e2: "P" }, "e2e4"), null);
assert.equal(atomic.blast({ a1: "R", a2: "p" }, "a1a2").area.length, 6);

const app = fs.readFileSync("site/app.js", "utf8");
const checkStart = app.indexOf("function checkGameOver()");
const checkEnd = app.indexOf("// ---------------------------------------------------------------- Your clock", checkStart);
const context = { ATOMIC: true, game: { repKeys: [] }, pos: null, insufficientMaterial: () => true };
vm.createContext(context);
vm.runInContext(app.slice(checkStart, checkEnd), context);
context.pos = { turn: "b", legal: [], atomicResult: "white", halfmove: 100, lastMove: "e4e5" };
context.checkGameOver();
assert.equal(context.game.over, "Explosion on e5 — White wins", "an explosion outranks draw and stalemate shortcuts");
context.pos = { turn: "w", legal: ["e1e2"], atomicResult: "none", halfmove: 0, board: {} };
context.checkGameOver();
assert.equal(context.game.over, null, "Classic insufficient material does not adjudicate Atomic");
context.pos.legal = []; context.pos.inCheck = true;
context.checkGameOver();
assert.equal(context.game.over, "Checkmate — Black wins");
context.pos.inCheck = false; context.checkGameOver();
assert.equal(context.game.over, "Stalemate — draw");

const botsContext = { window: { SHARPFISH_VARIANT: { slug: "atomic" } } };
vm.createContext(botsContext);
vm.runInContext(fs.readFileSync("site/bots.js", "utf8"), botsContext);
assert.equal(botsContext.botRating(botsContext.findBot("martin")), "Beginner");
assert.equal(botsContext.botRating(botsContext.customBot(null)), "Full");
assert.equal(botsContext.botMetadata(botsContext.findBot("martin")).elo, undefined);
assert.equal(botsContext.botSearchConfig(botsContext.findBot("martin"), 300).go, "go movetime 300");
console.log("PASS Atomic blast presentation, en passant, promotion, castling, result precedence and unrated bot tiers");
