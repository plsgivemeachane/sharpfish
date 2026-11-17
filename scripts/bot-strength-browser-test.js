#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const base = (process.argv[3] || "http://127.0.0.1:37801").replace(/\/$/, "");

(async () => {
  const browser = await chromium.launch();
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 } });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      await page.goto(base);
      await page.waitForFunction(() => typeof pos !== "undefined" && pos && !pos.pending && pos.legal.length === 20);
      await page.evaluate(() => {
        window.__strengthCommands = [];
        const post = engine.worker.postMessage.bind(engine.worker);
        engine.worker.postMessage = command => { __strengthCommands.push(command); post(command); };
        document.getElementById("sel-delay").value = "0";
        document.getElementById("sel-time").value = "2000";
        chooseBot(customBot(1800));
      });
      await page.locator('[data-sq="e2"]').click();
      await page.locator('[data-sq="e4"]').click();
      await page.waitForFunction(() => game.moves.length === 2 && pos && !pos.pending, null, { timeout: 15000 });
      const rated = await page.evaluate(() => ({ commands: __strengthCommands, profile: botSearchConfig(bot).profile,
        saved: historyRecord().meta.bot, timeline: historyRecord().meta.botProfiles,
        overflow: document.documentElement.scrollWidth > innerWidth }));
      assert(rated.commands.includes("go nodes 100000 movetime 2000"));
      assert(rated.commands.includes("setoption name UCI_Elo value " + rated.profile.engineElo));
      assert.equal(rated.saved.engineElo, rated.profile.engineElo);
      assert.equal(rated.saved.ratingVersion, rated.profile.version);
      assert.equal(rated.timeline.length, 1);
      assert.equal(rated.timeline[0].ply, 1);
      assert.equal(rated.timeline[0].profile.engineElo, rated.profile.engineElo);
      assert.equal(rated.overflow, false);
      const next = await page.evaluate(() => {
        chooseBot(findBot("lena"));
        return pos.legal.find(move => move.length === 4);
      });
      await page.locator(`[data-sq="${next.slice(0, 2)}"]`).click();
      await page.locator(`[data-sq="${next.slice(2, 4)}"]`).click();
      await page.waitForFunction(() => game.moves.length === 4 && pos && !pos.pending, null, { timeout: 15000 });
      const changed = await page.evaluate(() => historyRecord().meta.botProfiles);
      assert.equal(changed.length, 2, "mid-game bot changes retain both actual profiles");
      assert.equal(changed[0].profile.engineElo, rated.profile.engineElo);
      assert.equal(changed[1].profile.engineElo, 1350);
      assert.equal(changed[1].ply, 3);
      await page.evaluate(() => { chooseBot(customBot(null)); __strengthCommands.length = 0; newGame("b", false, true); });
      await page.waitForFunction(() => game.moves.length === 1 && pos && !pos.pending, null, { timeout: 15000 });
      const full = await page.evaluate(() => __strengthCommands);
      assert(full.includes("setoption name Skill Level value 20"));
      assert(full.includes("setoption name UCI_LimitStrength value false"));
      assert(full.includes("go movetime 2000"));
      assert(!full.some(command => command.startsWith("go nodes")));
      await page.reload();
      await page.waitForFunction(() => typeof pos !== "undefined" && pos && !pos.pending);
      assert.equal(await page.evaluate(() => bot.elo), null, "Full survives reload");
      await page.evaluate(() => { chooseBot(findBot("lena")); newGame("w", false, true); });
      await page.waitForFunction(() => pos && !pos.pending && game.moves.length === 0);
      await page.reload();
      await page.waitForFunction(() => typeof pos !== "undefined" && pos && !pos.pending);
      assert.equal(await page.evaluate(() => bot.id), "lena", "named configuration survives reload");
      assert.deepEqual(errors, []);
      await context.close();
      console.log("PASS " + (mobile ? "390px / 4x CPU throttling" : "desktop") + ": rated/Full WASM replies, controls, saved provenance, reload and overflow");
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
