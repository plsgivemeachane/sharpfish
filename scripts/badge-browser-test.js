#!/usr/bin/env node
// node scripts/badge-browser-test.js /path/to/playwright-tools http://localhost:8096/variants/classic
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const origin = (process.argv[3] || "http://localhost:8096/variants/classic").replace(/\/$/, "");

async function assertBadgeAssets(page) {
  const assets = await page.evaluate(() => ({
    revision: (window.SHARPFISH_VARIANT || {}).revision,
    images: [...document.querySelectorAll(".move-grade-overlay, .move-grade-list-icon")].map(img => img.src)
  }));
  assert(assets.images.length > 0, "badges are displayed");
  if (assets.revision) assert(assets.images.every(src => src.includes("/assets/" + assets.revision + "/badges/")),
    "list and board badges use the displayed release, bypassing stale image caches");
  await page.waitForFunction(() => [...document.querySelectorAll(".move-grade-overlay, .move-grade-list-icon")]
    .every(img => img.complete && img.naturalWidth > 0));
}

async function assertCornerBadge(page) {
  const box = await page.locator(".move-grade-overlay").evaluate(img => {
    const badge = img.getBoundingClientRect(), square = img.parentElement.getBoundingClientRect();
    return { dx: badge.x + badge.width / 2 - square.right, dy: badge.y + badge.height / 2 - square.top };
  });
  assert(Math.abs(box.dx) < 1 && Math.abs(box.dy) < 1, "badge is centred on the square's top-right corner");
}

(async () => {
  const browser = await chromium.launch(), context = await browser.newContext(), page = await context.newPage();
  try {
    // Old stable image URLs must not be needed by a collection release.
    await context.route(/\/variants\/[^/]+\/badges\/[^/]+\.png(?:\?.*)?$/, route => route.abort());
    await page.goto(`${origin}/analysis.html`);
    await page.locator("#pgn-input").fill("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *");
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 7, null, { timeout: 30000 });
    // Grading starts automatically; stop it so real results cannot race the seeded grades.
    await page.locator("#grade-toggle").uncheck();
    const setup = await page.evaluate(async () => {
      const rec = (await SFHistory.list())[0];
      const grades = {};
      [0, 1, 6].forEach((index, n) => { grades[index] = { label: ["Good", "Excellent", "Catastrophe"][n], objectiveLabel: ["Good", "Excellent", "Catastrophe"][n], version: SFAnalysis.VERSION, model: "centipawn", depth: 20, historyKey: SFAnalysis.historyKey(rec, index + 1), config: { model: "centipawn", movetime: 2000, specialMoves: true, engine: STOCK_ENGINE_FILE } }; });
      await SFHistory.updateGrades(rec.id, rec.revision, grades);
      return { id: rec.id, revision: rec.revision };
    });
    await page.goto(`${origin}/analysis.html?game=${encodeURIComponent(setup.id)}`);
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 7);
    assert.equal(await page.locator("#grade-toggle").isChecked(), true, "reopened review grades by default");
    await page.locator("#moves li").nth(6).click();
    await page.waitForSelector('.move-grade-overlay[src*="catastrophe.png"]');
    assert.equal(await page.locator(".move-grade-overlay").count(), 1);
    assert.equal(await page.locator(".move-grade-overlay").getAttribute("aria-label"), "Catastrophe");
    await assertBadgeAssets(page);
    await assertCornerBadge(page);
    const alignment = await page.locator("#moves li").evaluateAll(rows => rows.map(row => {
      const slot = row.querySelector(".move-grade-slot"), san = row.querySelector("span:nth-child(3)");
      return { slot: slot.getBoundingClientRect().x, san: san.getBoundingClientRect().x };
    }));
    assert(alignment.every(row => row.slot === alignment[0].slot), "grade slots stay fixed");
    assert(alignment.every(row => row.san === alignment[0].san), "SAN stays fixed when labels differ");
    await page.setViewportSize({ width: 320, height: 800 });
    await assertCornerBadge(page);
    const mobileReview = await page.locator("#moves li").nth(6).evaluate(row => {
      const slot = row.children[1].getBoundingClientRect(), san = row.children[2].getBoundingClientRect(), label = row.children[3].getBoundingClientRect();
      return { slotRight: slot.right, sanLeft: san.left, sanRight: san.right, labelLeft: label.left };
    });
    assert(mobileReview.slotRight <= mobileReview.sanLeft + 1, "review icon slot does not overlap SAN");
    assert(mobileReview.sanRight <= mobileReview.labelLeft + 1, "review SAN does not overlap grade label");
    await page.locator("#grade-toggle").uncheck();
    assert.equal(await page.locator(".move-grade-overlay").count(), 0, "turning grading off removes board badge");

    const asyncReview = await context.newPage();
    await asyncReview.goto(`${origin}/analysis.html`);
    await asyncReview.locator("#pgn-input").fill("1. e4 *");
    await asyncReview.locator("#analyze").click();
    await asyncReview.waitForFunction(() => document.querySelectorAll("#moves li").length === 1, null, { timeout: 30000 });
    await asyncReview.locator("#moves li").click();
    assert.equal(await asyncReview.locator("#grade-toggle").isChecked(), true, "imported review grades without a click");
    await asyncReview.waitForSelector(".move-grade-overlay", { timeout: 180000 });
    assert(await asyncReview.locator(".move-grade-overlay").getAttribute("aria-label"), "real async grade appears on selected review move");
    await asyncReview.close();

    const live = await context.newPage();
    await live.goto(`${origin}/`);
    await live.waitForFunction(() => window.pos && !pos.pending);
    const move = await live.evaluate(() => pos.legal.find(m => m.slice(0, 2) === "e2"));
    await live.locator(`[data-sq="${move.slice(0, 2)}"]`).click();
    await live.locator(`[data-sq="${move.slice(2, 4)}"]`).click();
    await live.waitForFunction(() => window.game && game.moves.length === 1 && !pos.pending);
    const liveCell = live.locator('#moves td[data-ply="1"]');
    const beforeGrade = await liveCell.evaluate(el => ({ x: el.getBoundingClientRect().x, slot: el.querySelector(".move-grade-slot").getBoundingClientRect().right }));
    const liveMeta = await live.evaluate(async () => { const rows = await SFHistory.list(); const rec = rows.find(row => row.moves && row.moves.length === 1); if (!rec) throw new Error("live game was not saved"); return { id: rec.id, revision: rec.revision, key: SFAnalysis.historyKey(rec, 1), engine: STOCK_ENGINE_FILE }; });
    await live.locator("#chk-grade").check();
    await live.evaluate(meta => SFAppHooks.setGrade(0, { label: "Good", version: SFAnalysis.VERSION, model: "centipawn", depth: 20, historyKey: meta.key, config: { model: "centipawn", movetime: 2000, specialMoves: true, engine: meta.engine } }, meta.id, meta.revision), liveMeta);
    await live.waitForSelector('.move-grade-overlay[src*="good.png"]');
    assert.equal(await live.locator(".move-grade-overlay").getAttribute("aria-label"), "Good");
    await assertBadgeAssets(live);
    await assertCornerBadge(live);
    const afterGood = await liveCell.evaluate(el => ({ x: el.getBoundingClientRect().x, slot: el.querySelector(".move-grade-slot").getBoundingClientRect().right }));
    assert.deepEqual(afterGood, beforeGrade, "live SAN stays fixed when a grade arrives");
    await live.evaluate(meta => SFAppHooks.setGrade(0, { label: "Catastrophe", version: SFAnalysis.VERSION, model: "centipawn", depth: 20, historyKey: meta.key, config: { model: "centipawn", movetime: 2000, specialMoves: true, engine: meta.engine } }, meta.id, meta.revision), liveMeta);
    await live.waitForSelector('.move-grade-overlay[src*="catastrophe.png"]');
    const afterCatastrophe = await liveCell.evaluate(el => ({ x: el.getBoundingClientRect().x, slot: el.querySelector(".move-grade-slot").getBoundingClientRect().right }));
    assert.deepEqual(afterCatastrophe, beforeGrade, "live SAN stays fixed across grade tiers");
    const destination = move.slice(2, 4);
    assert.equal(await live.locator('.move-grade-overlay').evaluate(el => el.closest('.sq').dataset.sq), destination, "live badge is on the move destination");
    await live.locator("#btn-flip").click();
    assert.equal(await live.locator('.move-grade-overlay').evaluate(el => el.closest('.sq').dataset.sq), destination, "flipping keeps badge on the destination square");
    await live.setViewportSize({ width: 320, height: 800 });
    const mobileBadge = await live.locator('.move-grade-overlay').boundingBox();
    const mobileBoard = await live.locator('#board').boundingBox();
    await assertCornerBadge(live);
    assert(mobileBadge.x + mobileBadge.width <= 320, "mobile corner badge stays inside the viewport");
    await live.locator("#btn-first").click();
    assert.equal(await live.locator(".move-grade-overlay").count(), 0, "start position has no badge");
    await live.locator("#btn-last").click();
    await live.waitForSelector('.move-grade-overlay[src*="catastrophe.png"]');
    await live.locator("#btn-undo").click();
    await live.waitForFunction(() => window.game && game.moves.length === 0 && window.pos && !pos.pending);
    assert.equal(await live.locator(".move-grade-overlay").count(), 0, "takeback clears stale badge");
    await live.locator("#btn-new-white").click();
    assert.equal(await live.locator(".move-grade-overlay").count(), 0, "new game clears stale badge");
    await live.close();
    console.log("PASS review/live release-versioned badge images, board overlays, fixed icon/SAN columns, toggle-off and start-position clearing");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
