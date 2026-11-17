#!/usr/bin/env node
// node scripts/analysis-board-browser-test.js /path/to/playwright-tools http://localhost:8096 [screenshot-dir]
// Review board geometry, replay motion, drawing, flip, default-on analysis,
// Great/Brilliant preference and recorded-game immutability.
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const origin = (process.argv[3] || "http://localhost:8080").replace(/\/$/, "");
const shots = process.argv[4] || null;
const CASTLE = '[White "Board"]\n[Black "Test"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O Nxe4 *';
const PROMOTE = "1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7 5. bxa8=Q *";

async function geometry(page) {
  return page.evaluate(() => {
    const sq = [...document.querySelectorAll("#board .sq")].map(s => s.getBoundingClientRect());
    const pieces = [...document.querySelectorAll("#board .piece:not(.captured)")].map(p => { const r = p.getBoundingClientRect(), c = p.parentElement.getBoundingClientRect(); return [r.width - c.width, r.height - c.height, r.x - c.x, r.y - c.y]; });
    const round = v => Math.round(v * 100) / 100;
    return { count: sq.length, widths: [...new Set(sq.map(r => round(r.width)))], heights: [...new Set(sq.map(r => round(r.height)))],
      pieces: pieces.length, pieceOffsets: pieces.every(o => o.every(v => Math.abs(v) < 0.5)), overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
function assertSquareBoard(g, label) {
  assert.equal(g.count, 64, `${label}: 64 squares`);
  assert.equal(g.widths.length, 1, `${label}: equal files ${g.widths}`);
  assert.equal(g.heights.length, 1, `${label}: equal ranks ${g.heights}`);
  assert.equal(g.widths[0], g.heights[0], `${label}: square cells`);
  assert(g.pieceOffsets, `${label}: pieces fill their square like the play board`);
  assert(g.overflow <= 0, `${label}: no horizontal overflow`);
}
// Running piece animations, ignoring CSS transitions such as the eval bar.
const pieceAnims = page => page.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.classList.contains("piece") && a.playState === "running")
  .map(a => ({ sq: a.effect.target.closest(".sq").dataset.sq, kind: a.effect.target.classList.contains("captured") ? "fade" : a.effect.getKeyframes()[0].transform ? "slide" : "appear" })));
const shape = (page, id) => page.locator(`#shapes g[data-shape="${id}"]`);
function grade(rec, index, label, specialMoves) {
  return { label, objectiveLabel: label, version: SFAnalysis.VERSION, model: "centipawn", depth: 20, historyKey: SFAnalysis.historyKey(rec, index + 1),
    config: { model: "centipawn", movetime: 2000, specialMoves, engine: STOCK_ENGINE_FILE } };
}

// Inject a synthetic grade for the newest saved game, exactly as a finished job would.
const inject = (page, index, label, special) => page.evaluate(([src, index, label, special]) => {
  const make = eval("(" + src + ")");
  return SFHistory.list().then(rows => SFReviewHooks.setGrade(index, make(rows[0], index, label, special)));
}, [grade.toString(), index, label, special]);

(async () => {
  const browser = await chromium.launch(), context = await browser.newContext({ reducedMotion: "no-preference" });
  const page = await context.newPage(), errors = [], failed = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => {
    if (r.status() === 503 && r.headers().server === "cloudflare" && r.request().headers()["sec-purpose"] === "prefetch" && !r.request().isNavigationRequest()) return;
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const snap = async name => { if (shots) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, name + ".png") }); } };
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`${origin}/analysis.html`);
    await page.waitForSelector("#board .sq");
    let g = await geometry(page);
    assertSquareBoard(g, "blank desktop");
    assert.equal(g.pieces, 32, "blank page shows the starting position");
    await snap("blank-desktop");
    await page.setViewportSize({ width: 320, height: 760 });
    assertSquareBoard(await geometry(page), "blank 320px");
    await snap("blank-320");
    for (const width of [640, 820, 900, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assertSquareBoard(await geometry(page), `${width}px layout`);
      const overlap = await page.evaluate(() => {
        const board = document.getElementById("board").getBoundingClientRect(), panel = document.querySelector(".panel").getBoundingClientRect();
        return panel.x < board.right && panel.right > board.x && panel.y < board.bottom && panel.bottom > board.y;
      });
      assert.equal(overlap, false, `${width}px board and controls must not overlap`);
    }
    await page.setViewportSize({ width: 1366, height: 900 });

    await page.locator("#pgn-input").fill(CASTLE);
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 8, null, { timeout: 30000 });
    assert.equal(await page.locator("#grade-toggle").isChecked(), true, "import grades by default");
    assert.equal(await page.locator("#eval-toggle").isChecked(), true, "import evaluates by default");
    await page.waitForFunction(() => window.SFReviewHooks.state().grading, null, { timeout: 5000 });
    await page.waitForFunction(() => { const t = document.getElementById("eval-label").textContent; return t && t !== "…" && t !== "?"; }, null, { timeout: 45000 });
    const original = await page.evaluate(async () => { const rec = (await SFHistory.list())[0]; return { id: rec.id, moves: rec.moves, san: rec.san, createdAt: rec.createdAt }; });
    assertSquareBoard(await geometry(page), "with evaluation bar");
    const readout = await page.locator("#eval-readout").boundingBox(), bar = await page.locator("#evalbar").boundingBox();
    assert(readout.width > bar.width * 3, "score is shown outside the thin bar");
    assert(await page.locator("#moves").isVisible(), "move list is visible");
    const board = await page.locator("#board").boundingBox(), list = await page.locator("#moves").boundingBox();
    assert(list.x > board.x + board.width && list.y < board.y + board.height, "desktop move list sits beside the board");

    // A slide is a real moving transform; grading while it moves neither restarts nor cancels it.
    await page.keyboard.press("ArrowRight");
    let anims = await pieceAnims(page);
    assert.deepEqual(anims, [{ sq: "e4", kind: "slide" }], "first move slides one pawn");
    await page.evaluate(() => { window.__slide = document.getAnimations().find(a => a.effect.target.classList.contains("moving")); window.__slideTime = window.__slide.currentTime; });
    await inject(page, 0, "Best", true);
    const kept = await page.evaluate(() => ({ same: document.getAnimations().includes(window.__slide), state: window.__slide.playState, connected: window.__slide.effect.target.isConnected, advanced: window.__slide.currentTime >= window.__slideTime }));
    assert.deepEqual(kept, { same: true, state: "running", connected: true, advanced: true }, "grade update keeps the moving piece animation");
    await page.waitForSelector('.move-grade-overlay[aria-label="Best"]');
    await page.waitForFunction(() => window.__slide.playState === "finished");
    await inject(page, 0, "Good", true);
    assert.deepEqual(await pieceAnims(page), [], "a stationary grade refresh invents no motion");
    assert.deepEqual(await page.locator(".sq.last").evaluateAll(es => es.map(e => e.dataset.sq).sort()), ["e2", "e4"], "last move highlighted");

    // Castling moves king and rook; capture fades; reverse replays backwards.
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    anims = await pieceAnims(page);
    assert.deepEqual(anims.map(a => a.sq + a.kind).sort(), ["f1slide", "g1slide"], "castling slides king and rook");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    anims = await pieceAnims(page);
    assert.deepEqual(anims.map(a => a.sq + a.kind).sort(), ["e4fade", "e4slide"], "capture slides the knight over a fading pawn");
    await page.waitForTimeout(300);
    await page.locator("#prev").click();
    anims = await pieceAnims(page);
    assert.deepEqual(anims.map(a => a.sq + a.kind).sort(), ["e4appear", "f6slide"], "reverse slides back and restores the capture");
    await page.waitForTimeout(300);
    await page.keyboard.press("Home");
    await page.keyboard.press("End");
    assert.match(await page.locator("#position-label").innerText(), /Position 8 \/ 8/, "quick keyboard navigation lands on the end");
    await page.waitForTimeout(300);
    assert.deepEqual(await pieceAnims(page), [], "quick navigation leaves no stuck animation");
    assertSquareBoard(await geometry(page), "after replay");

    // Arrows and circles persist across grade refresh and flip, clear on navigation.
    const sz = board.width / 8, at = (f, r) => [board.x + sz * (f + 0.5), board.y + sz * (8 - r + 0.5)];
    await page.mouse.move(...at(3, 2)); await page.mouse.down({ button: "right" }); await page.mouse.move(...at(3, 4), { steps: 5 }); await page.mouse.up({ button: "right" });
    await page.mouse.move(...at(5, 6)); await page.mouse.down({ button: "right", modifiers: ["Shift"] }); await page.mouse.up({ button: "right" });
    await page.keyboard.down("Shift"); await page.mouse.click(...at(2, 5), { button: "right" }); await page.keyboard.up("Shift");
    assert.equal(await shape(page, "d2d4").count(), 1, "right-drag draws an arrow");
    assert.equal(await shape(page, "c5c5").count(), 1, "right-click draws a circle");
    assert.equal(await shape(page, "c5c5").locator("circle").getAttribute("stroke"), "#882020", "Shift draws red");
    await inject(page, 7, "Mistake", true);
    assert.equal(await shape(page, "d2d4").count(), 1, "annotations survive a grade refresh");
    const before = await shape(page, "d2d4").locator("polyline").getAttribute("points");
    await page.keyboard.press("f");
    assert.equal(await page.locator("#flip").getAttribute("aria-pressed"), "true");
    const after = await shape(page, "d2d4").locator("polyline").getAttribute("points");
    assert.equal(before.split(" ")[0], "3.500,6.500", "white-side arrow starts on d2");
    assert.equal(after.split(" ")[0], "4.500,1.500", "flipped arrow still starts on d2");
    assert.equal(await page.locator(".sq").first().getAttribute("data-sq"), "h1", "flip puts h1 top-left");
    assert.equal(await page.locator(".move-grade-overlay").evaluate(e => e.closest(".sq").dataset.sq), "e4", "badge stays on destination after flip");
    assert.equal(await page.locator("#evalbar").evaluate(e => e.classList.contains("flipped")), true, "eval bar follows orientation");
    await snap("flipped-drawings");
    await page.locator('.sq[data-sq="a1"]').click();
    assert.equal(await page.locator("#shapes g").count(), 0, "left-click clears drawings");
    await page.locator('.sq[data-sq="c4"]').click({ button: "right" });
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator("#shapes g").count(), 0, "navigating to another position clears drawings");
    await page.keyboard.press("f");

    // Great/Brilliant preference: persisted, cancels stale work, rejects stale results.
    await page.locator("#special-toggle").uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem("sharpfish-special-grading")), "0");
    await page.waitForFunction(() => window.SFReviewHooks.state().grading, null, { timeout: 5000 });
    // Stop the restarted job so a real result cannot race the synthetic ones below.
    await page.locator("#cancel").click();
    await page.waitForFunction(() => !window.SFReviewHooks.state().grading, null, { timeout: 5000 });
    await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
    await inject(page, 0, "Brilliant", true);
    assert.equal(await page.locator('.move-grade-overlay[aria-label="Brilliant"]').count(), 0, "a result made with Great/Brilliant on is not shown while off");
    await inject(page, 0, "Excellent", false);
    await page.waitForSelector('.move-grade-overlay[aria-label="Excellent"]');
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 8, null, { timeout: 30000 });
    assert.equal(await page.locator("#special-toggle").isChecked(), false, "review restores the stored preference");
    await page.locator("#special-toggle").check();
    assert.equal(await page.evaluate(() => localStorage.getItem("sharpfish-special-grading")), "1");

    // Unchanged record after replay, drawing, flipping and grading.
    const stored = await page.evaluate(id => SFHistory.get(id), original.id);
    assert.deepEqual([stored.moves, stored.san, stored.createdAt], [original.moves, original.san, original.createdAt], "recorded game is immutable");

    // Promotion slides the pawn in as a queen while the captured rook fades.
    await page.locator("#pgn-input").fill(PROMOTE);
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 9, null, { timeout: 30000 });
    assert.equal(await page.locator("#shapes g").count(), 0, "a new game starts without drawings");
    await page.keyboard.press("End"); await page.waitForTimeout(300); await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    anims = await pieceAnims(page);
    assert.deepEqual(anims.map(a => a.sq + a.kind).sort(), ["a8fade", "a8slide"], "promotion slides and captures");
    assert.equal(await page.locator('.sq[data-sq="a8"] .piece:not(.captured)').getAttribute("alt"), "White queen");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowLeft");
    anims = await pieceAnims(page);
    assert.deepEqual(anims.map(a => a.sq + a.kind).sort(), ["a8appear", "b7slide"], "reverse promotion slides back as a pawn and restores the rook");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await snap("promotion-desktop");
    await page.setViewportSize({ width: 320, height: 760 });
    assertSquareBoard(await geometry(page), "320px with evaluation");
    const mobileReadout = await page.locator("#eval-readout").boundingBox();
    assert(mobileReadout.x + mobileReadout.width <= 320, "mobile score stays on screen");
    await snap("promotion-320");
    await page.setViewportSize({ width: 1366, height: 900 });

    // Reduced motion: replay jumps without piece animations.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("ArrowLeft");
    assert.deepEqual(await pieceAnims(page), [], "reduced motion disables replay animation");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Unsupported variants replay without stock grading or evaluation.
    const custom = await page.evaluate(async () => { const rec = await SFHistory.save({ moves: ["e2e4"], san: ["e4"], result: "*", revision: 1, grades: {}, variant: { slug: "scp-096", title: "SCP-096", supported: false },
      boards: [{ fen: SFAnalysis.START_FEN, turn: "w" }, { fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", turn: "b" }] }); return rec.id; });
    await page.goto(`${origin}/analysis.html?game=${encodeURIComponent(custom)}`);
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 1);
    for (const id of ["#grade-toggle", "#eval-toggle", "#special-toggle"]) {
      assert.equal(await page.locator(id).isDisabled(), true, `${id} disabled for custom variant`);
    }
    assert.equal(await page.locator("#grade-toggle").isChecked(), false);
    assert.equal(await page.locator("#evalbar").evaluate(e => e.classList.contains("off")), true, "custom variant hides evaluation");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator('.sq[data-sq="e4"] .piece').count(), 1, "custom variant still replays");

    // Live play shares the stored Great/Brilliant preference.
    await page.evaluate(() => localStorage.setItem("sharpfish-special-grading", "0"));
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.pos && !pos.pending, null, { timeout: 30000 });
    assert.equal(await page.locator("#chk-special-grades").isChecked(), false, "live play restores the stored preference");
    await page.locator("#chk-special-grades").check();
    assert.equal(await page.evaluate(() => [localStorage.getItem("sharpfish-special-grading"), SFLive.specialMoves()]).then(String), "1,true");
    await page.evaluate(() => localStorage.removeItem("sharpfish-special-grading"));
    await page.reload();
    await page.waitForFunction(() => window.pos && !pos.pending, null, { timeout: 30000 });
    assert.equal(await page.locator("#chk-special-grades").isChecked(), true, "absent preference means on");

    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    assert.deepEqual(failed, [], `failed resources: ${failed.join("; ")}`);
    console.log("PASS review board geometry (desktop/320px, eval on/off), default-on analysis, slide/castle/capture/promotion/reverse/quick replay, motion survives grading, reduced motion, mouse arrows/circles/clear/flip, Great/Brilliant persistence and stale rejection, immutable record, custom variants, live preference");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
