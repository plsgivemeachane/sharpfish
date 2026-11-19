"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const origin = process.argv[3] || "http://localhost:8080";

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.stockCommands = [];
      const post = Worker.prototype.postMessage;
      const WorkerClass = window.Worker;
      window.Worker = class extends WorkerClass {
        constructor(url, options) { super(url, options); this.stock = String(url).includes("stock-engine/"); }
        postMessage(command, ...args) {
          if (this.stock && typeof command === "string") window.stockCommands.push(command);
          return post.call(this, command, ...args);
        }
      };
    });
    await page.goto(origin);
    await page.waitForFunction(() => window.pos && !pos.pending);
    assert.equal(await page.locator("#remorse-rules").isVisible(), true);
    await page.evaluate(() => { maybeEngineTurn = () => {}; });
    for (const [index, move] of ["e2e4", "d7d5", "e4d5", "a7a6", "f1c4", "a6a5"].entries()) {
      await page.evaluate(move => {
        if (!pos.legal.includes(move)) throw Error("Illegal fixture: " + move);
        playMove(move);
      }, move);
      await page.waitForFunction(ply => !pos.pending && game.boards.length === ply + 1, index + 1);
    }
    const pawn = page.locator('[data-sq="d5"].remorse-guilty');
    assert.equal(await pawn.locator(".remorse-mark.ready").count(), 1);
    // Phone-first markers: key under the board, distinct shapes, big enough at 390px, clear of grade badges.
    assert.equal(await page.locator("#remorse-key").isVisible(), true);
    const keyBelowBoard = await page.evaluate(() => document.querySelector("#remorse-key").getBoundingClientRect().top - document.querySelector("#board").getBoundingClientRect().bottom);
    assert(keyBelowBoard >= 0 && keyBelowBoard < 120, "marker key should sit just below the board: " + keyBelowBoard);
    const markStyle = await pawn.locator(".remorse-mark").evaluate(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { w: r.width, bg: s.backgroundImage, text: el.textContent }; });
    assert(markStyle.w >= 18, "board marker too small: " + markStyle.w);
    assert.equal(markStyle.text, "");
    const guiltyBg = await page.locator("#remorse-key .remorse-mark:not(.ready)").evaluate(el => getComputedStyle(el).backgroundImage);
    assert.notEqual(markStyle.bg, guiltyBg, "ready and guilty markers must use different shapes");
    assert.equal(await pawn.evaluate(el => getComputedStyle(el, "::after").borderTopStyle), "solid");
    assert.match(await pawn.getAttribute("aria-label"), /guilty: cannot capture, ready to recover/);
    await page.evaluate(() => { selected = "d5"; render(); });
    assert.match(await page.locator('[data-sq="c5"]').getAttribute("aria-label"), /in friendly bishop range/);
    assert.equal(await page.locator('[data-sq="c5"] .remorse-range-mark').isVisible(), true);
    await page.evaluate(() => viewPly(3));
    assert.match(await page.locator("#status").textContent(), /Reviewing move 3.*1 guilty piece/);
    assert.equal(await page.locator(".sq .remorse-range-mark").count(), 0);
    assert.equal(await pawn.locator(".remorse-mark:not(.ready)").count(), 1);
    assert.equal(await pawn.evaluate(el => getComputedStyle(el, "::after").borderTopStyle), "dashed");
    assert.equal(await pawn.evaluate(el => getComputedStyle(el, "::before").inset), "0px");
    await page.evaluate(() => viewPly(6));
    await page.locator("#btn-flip").click();
    assert.equal(await pawn.locator(".remorse-mark.ready").count(), 1);
    await page.locator("#btn-undo").click();
    await page.waitForFunction(() => !pos.pending && game.moves.length === 4);
    assert.equal(await page.locator('[data-sq="d5"].remorse-guilty').count(), 1);
    await page.evaluate(() => persistGame());
    await page.locator("#chk-grade").check();
    await page.waitForFunction(() => game.grades[0] && !game.grades[0].unavailable, null, { timeout: 30000 });
    await page.evaluate(() => viewPly(3));
    await page.waitForFunction(() => document.querySelector('[data-sq="d5"] .move-grade-overlay'), null, { timeout: 30000 });
    const overlap = await page.evaluate(() => {
      const a = document.querySelector('[data-sq="d5"] .remorse-mark').getBoundingClientRect();
      const b = document.querySelector('[data-sq="d5"] .move-grade-overlay').getBoundingClientRect();
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    });
    assert.equal(overlap, false, "guilt marker must not collide with the move grade badge");
    await page.evaluate(() => viewPly(game.boards.length - 1));
    const stock = await page.evaluate(() => stockCommands.filter(command => command.startsWith("position ")));
    assert(stock.length > 0 && stock.every(command => command.startsWith("position fen ") && !command.includes("guilt=")));
    await page.locator("#analyze-link").click();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 4);
    await page.locator("#last").click();
    assert.equal(await page.locator("#remorse-key").isVisible(), true);
    assert.equal(await pawn.locator(".remorse-mark:not(.ready)").count(), 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 4);
    await page.locator("#last").click();
    assert.equal(await page.locator("#remorse-key").isVisible(), true);
    assert.equal(await pawn.locator(".remorse-mark:not(.ready)").count(), 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 760 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "overflow at " + width);
      assert((await pawn.locator(".remorse-mark").boundingBox()).width >= 17, "analysis marker too small at " + width);
    }
    assert.deepEqual(errors, []);
    console.log("PASS Remorse board, guilt, undo, flip, saved replay, mobile layout and stock grading");
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
