#!/usr/bin/env node
// Integration regression checks against the running site and real engine.
// Install Playwright outside the repo, then run:
// node scripts/premove-browser-test.js /tmp/browser-tools http://localhost:8080
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = process.argv[2]
  ? require(path.resolve(process.argv[2], "node_modules/playwright"))
  : require("playwright");

(async function () {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, hasTouch: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.argv[3] || "http://localhost:8080");
    await page.waitForFunction(() => pos && !pos.pending && pos.turn === "w");
    await page.selectOption("#sel-time", "300");
    async function move(from, to) {
      await page.locator(`[data-sq="${from}"]`).click();
      await page.locator(`[data-sq="${to}"]`).click();
    }
    async function newBlack() {
      await page.locator("#btn-new-black").click();
      await page.waitForFunction(() => thinking && pos && !pos.pending && game.playerColor === "b");
    }
    // Sequential moves from a projected square must execute on separate turns.
    await move("e2", "e4");
    await page.waitForFunction(() => thinking && !pos.pending);
    await move("g1", "f3");
    await move("f3", "g1");
    assert.deepEqual(await page.evaluate(() => premoves), ["g1f3", "f3g1"]);
    assert.equal(await page.locator("#premove-count").textContent(), "2 premoves queued");
    assert.equal(await page.locator(".premove .moving").count(), 0);
    await page.waitForFunction(() => game.moves.length >= 5, null, { timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => [game.moves[2], game.moves[4]]), ["g1f3", "f3g1"]);

    await newBlack();
    await move("g8", "f6");
    await page.locator('[data-sq="a5"]').click({ button: "right" });
    assert.equal(await page.evaluate(() => premoves.length), 1);
    await page.locator('[data-sq="a5"]').click({ button: "middle" });
    assert.equal(await page.evaluate(() => premoves.length), 0);

    // A grab must survive both the bot move and its async confirmation.
    await page.locator("#btn-new-white").click();
    await page.waitForFunction(() => pos && !pos.pending && !thinking && game.playerColor === "w");
    await move("e2", "e4");
    await page.waitForFunction(() => thinking && !pos.pending);
    const from = await page.locator('[data-sq="g1"]').boundingBox();
    const to = await page.locator('[data-sq="f3"]').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 3 });
    await page.waitForFunction(() => game.moves.length === 2 && !pos.pending);
    assert.equal(await page.evaluate(() => drag && drag.from), "g1");
    assert.equal(await page.locator('[data-sq="g1"] .dragging').count(), 1);
    await page.mouse.up();
    await page.waitForFunction(() => game.moves.length === 3 && !pos.pending);
    assert.equal(await page.evaluate(() => game.moves[2]), "g1f3");
    assert.equal(await page.locator(".ghost").count(), 0);

    // A completed short search must still wait before playing its move.
    await page.evaluate(() => {
      window.botStarted = 0;
      window.botElapsed = 0;
      const originalEngineMove = engineMove, originalPlayMove = playMove;
      engineMove = function () { botStarted = performance.now(); return originalEngineMove(); };
      playMove = function (uci) {
        if (pos.turn !== game.playerColor) botElapsed = performance.now() - botStarted;
        return originalPlayMove(uci);
      };
    });
    await newBlack();
    await page.waitForFunction(() => game.moves.length === 1 && !pos.pending);
    assert(await page.evaluate(() => botElapsed > 2000));

    await page.setViewportSize({ width: 375, height: 844 });
    await newBlack();
    for (const sq of ["g8", "f6", "f6", "g8"]) await page.locator(`[data-sq="${sq}"]`).tap();
    assert.equal(await page.evaluate(() => premoves.length), 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "Cancel premoves", exact: true }).click();
    assert.equal(await page.evaluate(() => premoves.length), 0);
    assert.equal(await page.locator("#engine-name").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: multi-premoves, cancellation buttons, uninterrupted grabs, >2s bot delay, mobile touch, and browser errors");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
