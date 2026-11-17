#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const origin = (process.argv[3] || "http://localhost:8096/variants/classic").replace(/\/$/, "");

(async () => {
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(origin + "/analysis.html");
    assert(await page.locator("#performance").isHidden());
    assert.match(await page.locator("#elo-estimate-note").innerText(), /single match only/);
    await page.evaluate(() => {
      window.__gradeAttempts = []; window.__evalBudgets = []; window.__failedOnce = false;
      const Original = SFAnalysis.Analyzer;
      SFAnalysis.Analyzer = function (file) {
        const analyzer = new Original(file), evaluate = analyzer.evaluate;
        analyzer.evaluate = function (record, ply, options) { window.__evalBudgets.push(options.movetime); return evaluate(record, ply, options); };
        analyzer.grade = async function (record, index, options) {
          window.__gradeAttempts.push({ index, movetime: options.movetime });
          if (index === 8 && !window.__failedOnce) { window.__failedOnce = true; throw new Error("temporary search failure"); }
          return { ...SFAnalysis.classify({ loss: index % 2 ? 50 : 20 }), depth: 12,
            bestMove: record.moves[index], historyKey: SFAnalysis.historyKey(record, index + 1),
            config: { model: "centipawn", movetime: options.movetime, specialMoves: options.specialMoves, engine: file } };
        };
        return analyzer;
      };
    });
    await page.locator("#pgn-input").fill('[White "Player <one>"]\n[Black "Player two"]\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. Nc3 d6 6. O-O O-O *');
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.getElementById("performance-progress").textContent === "All 12 moves analyzed.");
    assert.equal(await page.locator("#performance-white-accuracy").innerText(), "90.5%");
    assert.equal(await page.locator("#performance-black-accuracy").innerText(), "77.9%");
    assert.equal(await page.locator("#performance-white-elo").innerText(), "≈ 2050");
    assert.equal(await page.locator("#performance-black-elo").innerText(), "≈ 1550");
    assert.equal(await page.locator("#performance-white-name").innerText(), "Player <one>");
    assert.equal(await page.locator("#performance-white-name one").count(), 0);
    assert.equal(await page.evaluate(() => __gradeAttempts.filter(a => a.index === 8).length), 2, "review retries the failed move automatically");
    const original = await page.evaluate(async () => (await SFHistory.list())[0]);
    await page.locator("#grade-toggle").uncheck();
    assert.equal(await page.locator("#performance-white-accuracy").innerText(), "90.5%", "pausing grading retains completed metrics");
    await page.evaluate(() => SFReviewHooks.setGrade(11, null));
    assert.match(await page.locator("#performance-progress").innerText(), /11 \/ 12.*provisional/);
    assert.equal(await page.locator("#performance-black-elo").innerText(), "—", "incomplete coverage withholds Elo");
    await page.evaluate(grade => SFReviewHooks.setGrade(11, grade), original.grades[11]);
    await page.locator("#flip").click();
    assert.equal(await page.locator("#performance-white-accuracy").innerText(), "90.5%", "flip never swaps summary identities");
    await page.locator("#eval-toggle").uncheck();
    await page.locator("#analysis-time").selectOption("5000");
    assert.match(await page.locator("#performance-progress").innerText(), /0 \/ 12/, "old-budget results cannot masquerade as deeper analysis");
    await page.locator("#grade-toggle").check();
    await page.waitForFunction(() => document.getElementById("performance-progress").textContent === "All 12 moves analyzed.");
    assert.equal(await page.evaluate(() => __gradeAttempts.at(-1).movetime), 5000);
    await page.locator("#eval-toggle").check();
    await page.waitForFunction(() => __evalBudgets.includes(5000));
    await page.locator("#eval-toggle").uncheck();
    await page.waitForFunction(() => !SFReviewHooks.state().grading);
    const stored = await page.evaluate(async id => SFHistory.get(id), original.id);
    assert.deepEqual([stored.moves, stored.san, stored.boards, stored.result], [original.moves, original.san, original.boards, original.result]);
    assert(Object.values(stored.grades).every(g => g.config.movetime === 5000));
    await page.reload();
    await page.waitForFunction(() => document.getElementById("performance-white-accuracy").textContent === "90.5%");
    assert.equal(await page.locator("#analysis-time").inputValue(), "5000", "thinking time persists and saved metrics restore");
    await page.locator("#eval-toggle").uncheck();
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "summary and settings fit at " + width);
      if (process.argv[4]) await page.screenshot({ path: path.join(process.argv[4], "performance-" + width + ".png"), fullPage: true });
    }
    await page.locator("#analysis-time").selectOption("1000");
    await page.locator("#pgn-input").fill("1. e4 e5 *");
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 2);
    await page.locator("#grade-toggle").uncheck();
    assert.equal(await page.locator("#performance-white-elo").innerText(), "—", "short games do not invent precise ratings");
    const unsupportedId = await page.evaluate(async () => {
      const record = (await SFHistory.list())[0];
      record.variant = { slug: "unregistered-custom", supported: false }; record.revision++;
      await SFHistory.save(record); return record.id;
    });
    await page.goto(origin + "/analysis.html?game=" + encodeURIComponent(unsupportedId));
    await page.waitForFunction(() => document.getElementById("grade-toggle").disabled);
    assert(await page.locator("#performance").isHidden());
    assert(await page.locator("#analysis-time").isDisabled());
    assert.deepEqual(errors, []);
    console.log("PASS accuracy/Elo, partial coverage, score independence, automatic review retry, thinking-time propagation/cache/persistence, history immutability, mobile layout and unsupported variants");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
