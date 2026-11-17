#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const core = require("../site/analysis-core.js");
let terminated = false;
global.Worker = class {
  postMessage(command) {
    if (command === "uci" || command === "isready") setImmediate(() => this.onmessage({ data: command === "uci" ? "uciok" : "readyok" }));
    // A stalled worker never responds to the search.
  }
  terminate() { terminated = true; }
};
(async () => {
  const analyzer = new core.Analyzer("stalled-engine");
  const position = { ...core.parseBoard(core.START_FEN), legal: ["e2e4", "d2d4"], inCheck: false };
  const started = performance.now();
  try {
    await assert.rejects(analyzer.grade({ moves: ["e2e4"], boards: [position] }, 0), /timed out/);
    assert(performance.now() - started < 3000, "a stalled worker must not exceed the shared budget plus transport allowance");
    assert(terminated, "a stalled engine is terminated");
    console.log("PASS stalled grading worker times out near two seconds instead of waiting two minutes");
  } finally { analyzer.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
