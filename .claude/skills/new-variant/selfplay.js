#!/usr/bin/env node
// Self-play check for a "Stockfish but <rule>" variant.
// A random player (normal chess) plays the variant engine, with the engine on
// each color. It checks that:
//   - the player's legal moves always equal stock Stockfish's (the rule binds
//     the engine only)
//   - every engine move is legal chess and in the variant's own legal list
//   - optional: your rule, via --check <file.js> exporting check(ctx)
//
// node .claude/skills/new-variant/selfplay.js [--check rule.js] [--games 2]
//      [--plies 60] [--movetime 100] [--color w|b|both]
//      [--engine site/engine/x.js] [--stock site/stock-engine/stockfish-stock.js]
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const args = { games: 2, plies: 60, movetime: 100, color: "both" };
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];

function defaultEngine() {
  const m = fs.readFileSync(path.join(ROOT, "site/engine-file.js"), "utf8").match(/ENGINE_FILE = "([^"]+)"/);
  return path.join(ROOT, "site", m[1]);
}
const engineFile = args.engine ? path.resolve(args.engine) : defaultEngine();
const stockFile = path.resolve(args.stock || path.join(ROOT, "site/stock-engine/stockfish-stock.js"));
const check = args.check ? require(path.resolve(args.check)).check : null;

function engine(file) {
  const c = spawn(process.execPath, [file], { stdio: "pipe" });
  let buf = "", wait = null;
  c.stdout.on("data", d => {
    buf += d;
    if (wait && wait.re.test(buf)) { const out = buf, f = wait.f; buf = ""; wait = null; f(out); }
  });
  return {
    kill: () => c.kill(),
    ask: (cmd, re) => new Promise(f => { wait = { f, re }; buf = ""; c.stdin.write(cmd); }),
  };
}

const legal = async (e, pos) =>
  (await e.ask(pos + "\ngo perft 1\n", /Nodes searched: \d+/)).match(/^[a-h][1-8][a-h][1-8][qrbn]?(?=:)/gm) || [];
const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));

async function game(V, K, engineColor) {
  const moves = [], engineMoves = [], errors = [];
  await V.ask("ucinewgame\nisready\n", /readyok/);
  for (let ply = 0; ply < Number(args.plies); ply++) {
    const pos = "position startpos" + (moves.length ? " moves " + moves.join(" ") : "");
    const color = ply % 2 === 0 ? "w" : "b";
    const inCheck = /Checkers: \S/.test(await V.ask(pos + "\nd\nisready\n", /readyok/));
    const stock = await legal(K, pos);
    if (!stock.length) break; // mate or stalemate in normal chess

    if (color === engineColor) {
      const best = (await V.ask(pos + "\ngo movetime " + args.movetime + "\n", /bestmove \S+/)).match(/bestmove (\S+)/)[1];
      const own = await legal(V, pos); // after "go", so the engine's side is known
      if (best === "(none)") { console.log(`  engine has no allowed move at ply ${ply} (in check: ${inCheck})`); break; }
      if (!stock.includes(best)) errors.push(`ply ${ply}: engine move ${best} is not legal chess`);
      if (!own.includes(best)) errors.push(`ply ${ply}: engine move ${best} is not in its own legal list`);
      if (check) {
        const r = check({ move: best, moves: moves.slice(), ply, color, inCheck, engineMoves: engineMoves.slice(), allowed: own });
        if (r !== true) errors.push(`ply ${ply}: ${best}: ${r}`);
      }
      engineMoves.push({ move: best, ply, inCheck });
      moves.push(best);
    } else {
      const mine = await legal(V, pos);
      if (!same(mine, stock)) errors.push(`ply ${ply}: player's moves differ from stock chess (${mine.length} vs ${stock.length})`);
      moves.push(stock[Math.floor(Math.random() * stock.length)]);
    }
  }
  return { moves, errors };
}

(async () => {
  const V = engine(engineFile), K = engine(stockFile);
  const name = ((await V.ask("uci\n", /uciok/)).match(/id name (.*)/) || [])[1];
  await K.ask("uci\n", /uciok/);
  console.log("Engine: " + name);
  const colors = args.color === "both" ? ["w", "b"] : [args.color];
  let failed = 0;
  for (const c of colors)
    for (let g = 0; g < Number(args.games); g++) {
      const { moves, errors } = await game(V, K, c);
      console.log(`Engine as ${c === "w" ? "White" : "Black"}, game ${g + 1}: ${moves.length} plies, ${errors.length ? errors.length + " problem(s)" : "ok"}`);
      console.log("  " + moves.join(" "));
      errors.slice(0, 10).forEach(e => console.log("  ✗ " + e));
      failed += errors.length;
    }
  console.log(failed ? "FAIL" : "PASS");
  V.kill(); K.kill();
  process.exit(failed ? 1 : 0);
})();
