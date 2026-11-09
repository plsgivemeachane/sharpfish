#!/usr/bin/env node
// Quick check that a built engine starts, lists legal moves and finds a move.
// Usage: node scripts/smoke-test.js site/engine/stockfish-19-lite-single.js
"use strict";

var spawn = require("child_process").spawn;
var engineFile = process.argv[2];
if (!engineFile) {
    console.error("Usage: node scripts/smoke-test.js <engine.js>");
    process.exit(2);
}

var child = spawn(process.execPath, [engineFile], {stdio: "pipe"});
var out = "";
var started = Date.now();

function fail(msg) {
    console.error("FAIL: " + msg + "\n--- engine output ---\n" + out);
    child.kill();
    process.exit(1);
}

var timer = setTimeout(function () { fail("timed out"); }, 30000);

child.stdout.on("data", function (d) {
    out += d;
    var best = out.match(/bestmove (\S+)/);
    if (best) {
        clearTimeout(timer);
        var name = (out.match(/id name (.*)/) || [])[1];
        var perft = (out.match(/Nodes searched: (\d+)/) || [])[1];
        console.log("Engine:      " + name);
        console.log("Legal moves: " + perft + " from the start position (stock chess: 20)");
        console.log("Best move:   " + best[1] + " (" + (Date.now() - started) + " ms total)");
        console.log("PASS");
        child.stdin.end("quit\n");
    }
});

child.stdin.write("uci\nisready\nposition startpos\ngo perft 1\ngo movetime 1000\n");
