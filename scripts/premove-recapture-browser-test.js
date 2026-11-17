#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const base = (process.argv[3] || "http://localhost:8096").replace(/\/$/, "");

(async () => {
  const browser = await chromium.launch();
  try {
    for (const slug of ["classic", "alternating-colors", "scp-096", "sufferfish"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, hasTouch: true });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(`${base}/variants/${slug}/`);
        await page.waitForFunction(() => pos && !pos.pending && !thinking);
        // Use real stock-engine legality for deterministic capture/non-capture
        // replies, while exercising each variant's actual board input and queue.
        await page.evaluate(async () => {
          window.recaptureAnalyzer = new SFAnalysis.Analyzer(STOCK_ENGINE_FILE);
          window.recaptureFen = "7k/8/3b4/4B3/3P4/8/8/K7 b - - 0 1";
          window.recaptureBefore = await recaptureAnalyzer.position(recaptureFen);
          window.recaptureAfter = await recaptureAnalyzer.position(recaptureFen, ["d6e5"]);
          window.recaptureDeclined = await recaptureAnalyzer.position(recaptureFen, ["d6c7"]);
          window.recapturePlayed = [];
          playMove = function (uci) { recapturePlayed.push(uci); };
        });
        for (const input of ["click", "drag", "touch"]) for (const captured of [true, false]) {
          await page.evaluate(() => {
            $("chk-eval").checked = false; toggleEval();
            $("chk-grade").checked = false;
            if (window.SFLive) SFLive.cancel();
            clearPremoves();
            game.playerColor = "w"; game.botMatch = false; game.view = null; game.over = null;
            game.moves = []; game.san = []; game.grades = {};
            pos = recaptureBefore;
            game.boards = [snapshot(pos, null)];
            thinking = true; recapturePlayed.length = 0;
            render();
          });
          const from = page.locator('[data-sq="d4"]'), to = page.locator('[data-sq="e5"]');
          if (input === "drag") {
            const a = await from.boundingBox(), b = await to.boundingBox();
            await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
            await page.mouse.down();
            await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
            await page.mouse.up();
          } else if (input === "touch") {
            await from.tap(); await to.tap();
          } else {
            await from.click(); await to.click();
          }
          assert.deepEqual(await page.evaluate(() => premoves), ["d4e5"], `${slug} ${input} queues onto friendly bishop`);
          assert.equal(await page.evaluate(() => pos.board.e5), "B", "preview preserves the real bishop");
          assert.equal(await to.locator('.piece').getAttribute("src"), "pieces/wP.svg");
          const result = await page.evaluate(captured => {
            pos = captured ? recaptureAfter : recaptureDeclined;
            thinking = false;
            const ran = runPremove();
            return { ran, played: recapturePlayed, queue: premoves };
          }, captured);
          assert.equal(result.ran, captured);
          assert.deepEqual(result.played, captured ? ["d4e5"] : []);
          assert.deepEqual(result.queue, []);
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${slug}: friendly-square premoves via click/drag/touch; engine-legal recapture or cancellation`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
