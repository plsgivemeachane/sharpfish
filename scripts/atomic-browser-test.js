#!/usr/bin/env node
// node scripts/atomic-browser-test.js /absolute/path/to/playwright-package [base-url]
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2]));
const base = process.argv[3] || "http://127.0.0.1:8127";
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => typeof pos !== "undefined" && pos && !pos.pending);
    assert.equal(await page.evaluate(() => ATOMIC), true);
    assert.equal(await page.locator("#board .piece").count(), 32);
    assert.equal(await page.locator("#chk-special-grades").isVisible(), false);
    await page.locator("#sel-delay").selectOption("0");
    await page.locator("#sel-time").selectOption("300");
    await page.locator("#chk-sound").uncheck();
    await page.locator('[data-sq="e2"]').focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => game.moves.length >= 2 && !pos.pending);
    assert.equal(await page.evaluate(() => game.moves[0]), "e2e4");
    await page.locator("#chk-eval").check();
    await page.waitForFunction(() => document.getElementById("eval-label").textContent.length > 0);
    assert.match(await page.locator("#evalbar").getAttribute("title"), /Atomic/);
    await page.locator("#chk-eval").uncheck();
    assert.equal(await page.evaluate(() => evalEngine.worker === engine.worker), false);
    console.log("PASS keyboard human move, legal bot reply and independent Atomic evaluation");

    // Set up a real engine-backed tactical position without adding a product
    // setup editor. The legal moves and final board still come from C++.
    await page.evaluate(async () => {
      if (thinking) engine.stop();
      ++game.token; thinking = false; stopClock();
      game.moves = []; game.san = []; game.over = null; game.grades = {};
      game.view = null; game.playerColor = "w"; game.botMatch = false;
      game.historyId = null; game.historyRevision = 0;
      positionCmd = function (ply) {
        var moves = game.moves.slice(0, ply == null ? game.moves.length : ply);
        return "position fen 7k/6p1/8/8/8/8/8/K5R1 w - - 0 1" + (moves.length ? " moves " + moves.join(" ") : "");
      };
      pos = await refreshPosition();
      game.repKeys = [pos.repKey]; game.boards = [snapshot(pos, null)];
      selected = null; render();
    });
    await page.locator('[data-sq="g1"]').click();
    await page.locator('[data-sq="g7"]').hover();
    assert.equal(await page.locator(".blast-center").getAttribute("data-sq"), "g7");
    assert.equal(await page.locator('[data-sq="h8"] .blast-marker').textContent(), "×");
    await page.locator('[data-sq="g7"]').click();
    await page.waitForFunction(() => !!game.over && !pos.pending);
    assert.match(await page.locator("#status").textContent(), /Explosion on g7 — White wins/);
    await page.waitForFunction(() => document.querySelectorAll("#board .piece").length === 1);
    assert.equal(await page.evaluate(() => game.san[0]), "Rxg7#");
    assert.match(await page.evaluate(() => pgn()), /Variant "Atomic"/);
    await page.locator("#btn-first").click();
    await page.waitForFunction(() => document.querySelectorAll("#board .piece").length === 4);
    await page.locator("#btn-last").click();
    await page.waitForFunction(() => document.querySelectorAll("#board .piece").length === 1);
    console.log("PASS blast preview, king explosion, terminal result and exact replay");

    await page.goto(base + "/analysis.html");
    await page.locator("#pgn-input").fill('[Variant "Atomic"]\n[SetUp "1"]\n[FEN "7k/6p1/8/8/8/8/8/K5R1 w - - 0 1"]\n1. Rxg7# 1-0');
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.getElementById("moves").textContent.includes("Rxg7"));
    assert.equal(await page.locator("#performance").isVisible(), false);
    assert.equal(await page.locator("#special-toggle").isVisible(), false);
    assert.equal(await page.locator("#elo-estimate-note").isVisible(), false);
    await page.waitForFunction(() => /Best/.test(document.getElementById("moves").textContent), null, { timeout: 30000 });
    assert(!/Brilliant|Great/.test(await page.locator("#moves").textContent()));
    await page.locator("#last").click();
    await page.waitForFunction(() => document.querySelectorAll("#board .piece").length === 1);
    await page.locator("#grade-toggle").uncheck();
    await page.locator("#eval-toggle").uncheck();
    await page.reload();
    await page.waitForFunction(() => document.getElementById("moves").textContent.includes("Rxg7"));
    assert.equal(await page.locator("#performance").isVisible(), false);
    await page.setViewportSize({ width: 320, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "/tmp/sharpfish-atomic-review-mobile.png", fullPage: true });
    await page.goto(base);
    await page.waitForFunction(() => typeof pos !== "undefined" && pos && !pos.pending);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({ path: "/tmp/sharpfish-atomic-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "/tmp/sharpfish-atomic-desktop.png", fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS Atomic PGN import, objective grading, history reload, excluded statistics and 320px layout");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
