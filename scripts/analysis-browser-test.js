#!/usr/bin/env node
// node scripts/analysis-browser-test.js /path/to/playwright-tools http://localhost:8096
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
    await page.goto(`${origin}/analysis.html`);
    await page.locator("#pgn-input").fill('[Event "<unsafe>"]\n[White "Browser"]\n[Black "Test"]\n\n1. e4 e5');
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 2, null, { timeout: 30000 });
    assert.equal(await page.locator("#history-list li").count(), 1);
    assert.equal(await page.locator("body").locator("text=<unsafe>").count(), 0, "metadata must be text-safe");
    // Supported games start with grading, Great/Brilliant and evaluation on.
    assert.equal(await page.locator("#grade-toggle").isChecked(), true, "grading starts on");
    assert.equal(await page.locator("#eval-toggle").isChecked(), true, "evaluation starts on");
    assert.equal(await page.locator("#special-toggle").isChecked(), true, "Great/Brilliant starts on without a stored preference");
    await page.waitForFunction(() => { const t = document.getElementById("eval-label").textContent; return t && t !== "…" && t !== "?"; }, null, { timeout: 45000 });
    await page.waitForFunction(() => { const es = [...document.querySelectorAll(".move-label")]; return es.length === 2 && es.every(e => e.textContent !== "Pending" && e.textContent !== "—"); }, null, { timeout: 120000 });
    assert.notEqual(await page.locator(".move-label").first().innerText(), "Pending");
    await page.locator("#grade-toggle").uncheck();
    assert.equal(await page.locator(".move-label").evaluateAll(es => es.every(e => e.textContent === "—")), true, "disabled grading hides labels");
    await page.locator("#grade-toggle").check();
    assert.equal(await page.locator("#cancel").isEnabled(), false, "completed cached grades need no running job");
    await page.locator("#next").click();
    assert.match(await page.locator("#position-label").innerText(), /Position 1/);
    assert.equal(await page.locator("#eval-toggle").isChecked(), true);
    await page.locator("#eval-toggle").uncheck();
    assert.equal(await page.locator("#evalbar").evaluate(e => e.classList.contains("off")), true, "evaluation can be turned off");
    assert.equal(await page.locator("#eval-readout").evaluate(e => e.classList.contains("off")), true, "score readout hides with evaluation");
    await page.setViewportSize({ width: 320, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator("#pgn-input").fill("1. e4 e5 2. NotAMove *");
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.getElementById("error").textContent.length > 0, null, { timeout: 30000 });
    assert.equal(await page.locator("#history-list li").count(), 1);
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    assert.deepEqual(failed, [], `failed resources: ${failed.join("; ")}`);
    console.log("PASS PGN import, XSS-safe metadata, default-on and independent evaluation/grading, cancellation UI, replay, malformed PGN and mobile layout");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
