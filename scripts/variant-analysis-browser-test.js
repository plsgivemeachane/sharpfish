#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const base = (process.argv[3] || "http://localhost:8096").replace(/\/$/, "");
(async () => {
  const browser = await chromium.launch(), context = await browser.newContext(), page = await context.newPage(), errors = [], failed = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400 && !r.request().headers()["sec-purpose"]) failed.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__stockCommands = [];
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(file, ...args) { super(file, ...args); this.__stock = String(file).includes("stock-engine/"); }
      postMessage(command, ...args) { if (this.__stock) window.__stockCommands.push(command); return super.postMessage(command, ...args); }
    };
  });
  try {
    for (const slug of ["classic", "alternating-colors", "scp-096", "sufferfish"]) {
      await page.goto(`${base}/variants/${slug}/`);
      await page.waitForFunction(() => window.pos && !pos.pending);
      assert.equal(await page.locator("#chk-grade").isDisabled(), false, slug + " enables live grading");
      await page.locator("#chk-special-grades").uncheck(); await page.locator("#chk-grade").check();
      await page.locator("#sel-time").selectOption("300");
      const move = await page.evaluate(async () => {
        const analyzer = new SFAnalysis.Analyzer(STOCK_ENGINE_FILE);
        try {
          const record = { variant: variantInfo(), moves: [], boards: [snapshot(pos, null)] };
          const ordinary = await analyzer.recordPosition(record, 0);
          return pos.legal.find(m => m.length === 4 && ordinary.legal.includes(m));
        } finally { analyzer.dispose(); }
      });
      assert(move);
      await page.locator(`[data-sq="${move.slice(0, 2)}"]`).click(); await page.locator(`[data-sq="${move.slice(2, 4)}"]`).click();
      await page.waitForFunction(() => game.moves.length >= 2 && !pos.pending && game.grades[0], null, { timeout: 45000 });
      assert(await page.evaluate(() => !game.grades[0].unavailable && game.grades[0].depth > 0));
      const id = await page.evaluate(() => game.historyId);
      await page.goto(`${base}/variants/${slug}/analysis.html?game=${encodeURIComponent(id)}`);
      await page.waitForFunction(() => document.querySelectorAll("#moves li").length >= 2);
      assert(await page.locator("#grade-toggle").isChecked()); assert(await page.locator("#eval-toggle").isChecked());
      assert.equal(await page.locator("#grade-toggle").isDisabled(), false);
      await page.waitForFunction(() => !["", "…", "—", "?"].includes(document.getElementById("eval-label").textContent), null, { timeout: 15000 });
      await page.locator("#grade-toggle").uncheck(); await page.locator("#eval-toggle").uncheck();
      if (slug === "scp-096") assert.equal(await page.locator('img[alt="SCP-096"]').count(), 1, "SCP stays visible in actual replay");
      assert(await page.evaluate(() => __stockCommands.filter(c => String(c).startsWith("position ")).every(c => !c.includes("*"))), "stock engine never sees SCP");
      console.log("PASS " + slug + " live grading, saved history, default-on review/evaluation and ordinary engine boundary");
    }
    // Explicitly reproduce discontinuous SCP snapshots, old unsupported flags,
    // a variant-only move, and SCP eating unrelated pieces after the next move.
    const id = await page.evaluate(async () => {
      function snap(fen) {
        const board = {};
        fen.split(" ")[0].split("/").forEach((rank, y) => { let x = 0; for (const c of rank) { if (/\d/.test(c)) x += Number(c); else board["abcdefgh"[x++] + (8 - y)] = c; } });
        return { fen, board, turn: fen.split(" ")[1], legal: ["a2a3"], inCheck: false };
      }
      const record = await SFHistory.save({ variant: { slug: "scp-096", title: "SCP-096", supported: false }, revision: 1, result: "*", moves: ["e2d2", "a7a6", "g1f3"], san: ["Rd2", "a6", "Nf3"], grades: {}, boards: [
        snap("4r2k/8/8/8/4*3/8/4R3/4K3 w - - 0 1"),
        snap("rnbqkbnr/pppppppp/8/3*4/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"),
        snap("rnbqkbnr/1ppppppp/p7/3*4/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 2"),
        snap("rnbqkbnr/1ppppppp/p7/8/4P3/5N2/PPPP1PPP/*NB1KB1R b kq - 1 2")
      ] }); return record.id;
    });
    await page.goto(`${base}/variants/classic/analysis.html?game=${encodeURIComponent(id)}`);
    await page.waitForFunction(() => document.getElementById("progress").textContent.includes("unavailable in ordinary chess"), null, { timeout: 30000 });
    assert.equal(await page.locator(".move-label").first().innerText(), "Unavailable");
    assert(await page.locator("#performance").isVisible());
    assert.match(await page.locator("#performance-progress").innerText(), /1 unavailable/);
    assert.equal(await page.locator("#performance-white-elo").innerText(), "—");
    await page.locator("#eval-toggle").uncheck();
    const original = await page.evaluate(async id => { const r = await SFHistory.get(id); return { moves: r.moves, boards: r.boards, result: r.result }; }, id);
    await page.locator("#last").click();
    assert.equal(await page.locator('img[alt="SCP-096"]').count(), 1);
    assert.equal(await page.locator('.sq[data-sq="a1"] .piece[alt="White rook"]').count(), 0);
    await page.evaluate(async id => {
      const r = await SFHistory.get(id), g = r.grades[2];
      SFReviewHooks.setGrade(2, { ...g, label: "Mistake", bestMove: "b1c3" });
    }, id);
    await page.locator("#alternative-move").click();
    await page.waitForFunction(() => document.getElementById("alternative-move").getAttribute("aria-pressed") === "true");
    assert.equal(await page.locator('img[alt="SCP-096"]').count(), 0, "alternative has no SCP");
    assert.equal(await page.locator('.sq[data-sq="c3"] .piece[alt="White knight"]').count(), 1);
    assert.equal(await page.locator('.sq[data-sq="a1"] .piece[alt="White rook"]').count(), 1, "alternative starts before automatic SCP eating");
    await page.locator("#alternative-move").click();
    assert.equal(await page.locator('img[alt="SCP-096"]').count(), 1);
    const unchanged = await page.evaluate(async id => { const r = await SFHistory.get(id); return { moves: r.moves, boards: r.boards, result: r.result }; }, id);
    assert.deepEqual(unchanged, original);
    const terminalId = await page.evaluate(async () => {
      const analyzer = new SFAnalysis.Analyzer(STOCK_ENGINE_FILE);
      try {
        const r = await analyzer.replay("1. e4 *");
        r.variant = { slug: "scp-096", supported: false }; r.grades = {}; r.revision = 1;
        r.boards[1] = { fen: "7k/8/8/8/4P3/8/8/4*3 b - - 0 1", board: { h8: "k", e4: "P", e1: "*" }, turn: "b", legal: [], inCheck: false };
        return (await SFHistory.save(r)).id;
      } finally { analyzer.dispose(); }
    });
    await page.goto(`${base}/variants/scp-096/analysis.html?game=${encodeURIComponent(terminalId)}`);
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 1);
    await page.locator("#last").click();
    await page.waitForFunction(() => document.getElementById("eval-detail").textContent === "Unavailable");
    assert(await page.locator("#evalbar").evaluate(e => e.classList.contains("off")), "invalid terminal board never retains a stale eval");
    await page.locator("#first").click();
    await page.waitForFunction(() => document.getElementById("eval-detail").textContent !== "Unavailable" && document.getElementById("eval-label").textContent !== "…");
    await page.setViewportSize({ width: 320, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []); assert.deepEqual(failed, []);
    console.log("PASS old custom histories, unavailable-move queue continuation, ordinary alternatives, immutable SCP replay, incomplete performance, terminal eval safety/recovery and mobile layout");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
