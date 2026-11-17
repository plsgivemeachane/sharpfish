#!/usr/bin/env node
// node scripts/live-history-browser-test.js /path/to/playwright-tools http://localhost:8096
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const origin = (process.argv[3] || "http://localhost:8080").replace(/\/$/, "");
(async () => {
  const browser = await chromium.launch(), context = await browser.newContext(), page = await context.newPage();
  const errors = [], failed = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  try {
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.pos && !window.pos.pending, null, { timeout: 30000 });
    const move = await page.evaluate(() => pos.legal[0]);
    await page.locator(`[data-sq="${move.slice(0, 2)}"]`).click();
    await page.locator(`[data-sq="${move.slice(2, 4)}"]`).click();
    await page.waitForFunction(() => window.game && game.moves.length >= 2 && !pos.pending, null, { timeout: 30000 });
    const records = await page.evaluate(async () => SFHistory.list());
    assert.equal(records.length, 1, "a played game is saved once");
    const id = records[0].id;
    assert.equal(records[0].moves.length, 2);
    await page.locator("#chk-grade").check();
    await page.waitForFunction(() => document.querySelector(".move-grade"), null, { timeout: 120000 });
    const graded = await page.evaluate(async id => SFHistory.get(id), id);
    assert(Object.keys(graded.grades || {}).length >= 1, "completed live grade persisted");
    await page.locator("#history-link").click();
    await page.waitForURL(/analysis\.html\?game=/, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 2, null, { timeout: 30000 });
    assert.equal(await page.locator("#grade-toggle").isChecked(), false, "history tools start independently off");
    await page.locator("#eval-toggle").check();
    await page.waitForFunction(() => { const t = document.getElementById("eval-label").textContent; return t && t !== "…" && t !== "?"; }, null, { timeout: 45000 });
    await page.locator("#grade-toggle").check();
    await page.waitForFunction(() => [...document.querySelectorAll(".move-label")].some(e => e.textContent !== "Pending"), null, { timeout: 120000 });
    const after = await page.evaluate(async id => SFHistory.get(id), id);
    assert.equal(after.id, id);
    assert.equal(after.moves.length, 2, "review analysis does not change recorded line");
    assert.equal(after.createdAt, records[0].createdAt, "review does not reorder/create a game");
    const retention = await page.evaluate(async () => {
      const created = [];
      for (let i = 0; i < 51; i++) created.push(await SFHistory.save({ id: "browser-cap-" + i, createdAt: i + 1, moves: ["e2e4"], san: ["e4"], revision: 1, result: "*", grades: {} }));
      const rows = await SFHistory.list();
      const before = rows.find(row => row.id === "browser-cap-50");
      await SFHistory.save({ ...before, grades: { 0: { label: "Good" } }, revision: 1 });
      return { count: (await SFHistory.list()).length, oldestPresent: rows.some(row => row.id === "browser-cap-0"), updatedCreatedAt: (await SFHistory.get("browser-cap-50")).createdAt };
    });
    assert.equal(retention.count, 50, "history retains exactly 50 records");
    assert.equal(retention.oldestPresent, false, "history evicts the oldest record");
    assert.equal(retention.updatedCreatedAt, 51, "updating a record preserves original creation order");
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    assert.deepEqual(failed, [], `failed resources: ${failed.join("; ")}`);
    console.log("PASS local history, live grading, saved grade, history review evaluation/grading and immutable game line");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
