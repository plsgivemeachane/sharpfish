#!/usr/bin/env node
// Real sample decoding/playback with actual WASM gameplay and PGN replay.
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const base = (process.argv[3] || "http://localhost:8096").replace(/\/$/, "");

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
  const context = await browser.newContext(), page = await context.newPage(), errors = [], failed = [];
  await context.addInitScript(() => {
    window.__audioContexts = []; window.__soundStarts = []; window.__soundDecoded = [];
    const Native = window.AudioContext;
    window.AudioContext = function (...args) {
      const audio = new Native(...args); window.__audioContexts.push(audio);
      const decode = audio.decodeAudioData.bind(audio), create = audio.createBufferSource.bind(audio);
      audio.decodeAudioData = async function (data) {
        const buffer = await decode(data); window.__soundDecoded.push(buffer.duration); return buffer;
      };
      audio.createBufferSource = function () {
        const source = create(), start = source.start.bind(source);
        source.start = function (...args) { window.__soundStarts.push({ duration: source.buffer.duration, state: audio.state }); return start(...args); };
        return source;
      };
      return audio;
    };
    window.AudioContext.prototype = Native.prototype;
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && response.url().includes("/sounds/")) failed.push(`${response.status()} ${response.url()}`);
  });
  const count = () => page.evaluate(() => window.__soundStarts.length);
  const clear = () => page.evaluate(() => { window.__soundStarts = []; });
  async function waitForCount(n) { await page.waitForFunction(n => window.__soundStarts.length === n, n, { timeout: 10000 }); }
  async function ready() { await page.waitForFunction(() => window.pos && !pos.pending && game.boards.length > 0); }
  async function clickMove(move) {
    await page.locator(`[data-sq="${move.slice(0, 2)}"]`).click();
    await page.locator(`[data-sq="${move.slice(2, 4)}"]`).click();
  }
  try {
    await page.goto(base + "/variants/classic/"); await ready();
    assert(await page.locator("#chk-sound").isChecked());
    assert.equal(await page.evaluate(() => window.__audioContexts.length), 0, "loading a page is silent");
    await page.locator('.bot[data-id="martin"]').click();
    await page.waitForFunction(() => window.__soundDecoded.length === 7);
    assert(await page.evaluate(() => window.__soundDecoded.every(d => d > 0 && d < 5)), "all shipped samples decode as short audio");
    await page.locator("#sel-time").selectOption("300"); await clear();
    await clickMove("e2e4"); await waitForCount(1);
    await page.waitForFunction(() => game.moves.length === 2 && !pos.pending, null, { timeout: 30000 });
    await waitForCount(2);
    await page.locator("#btn-flip").click();
    await page.evaluate(() => render());
    assert.equal(await count(), 2, "flip and redraw stay silent");
    await page.locator("#btn-undo").click(); await waitForCount(3);
    await page.locator("#btn-new-white").click(); await waitForCount(4);
    await page.locator("#chk-sound").uncheck(); await clear();
    await clickMove("e2e4");
    await page.waitForFunction(() => game.moves.length === 2 && !pos.pending, null, { timeout: 30000 });
    assert.equal(await count(), 0, "muted human and bot moves stay silent");

    await page.goto(base + "/variants/classic/analysis.html");
    assert.equal(await page.locator("#sound-toggle").isChecked(), false, "play and analysis share mute preference");
    await page.locator("#pgn-input").fill("1. e4 d5 2. exd5 Qxd5 3. Nc3 Qe5+ *");
    await page.locator("#analyze").click();
    await page.waitForFunction(() => document.querySelectorAll("#moves li").length === 6, null, { timeout: 30000 });
    if (await page.locator("#cancel").isEnabled()) await page.locator("#cancel").click();
    await page.locator("#grade-toggle").uncheck(); await page.locator("#eval-toggle").uncheck();
    assert.equal(await count(), 0, "import does not play recorded sounds");
    await page.locator("#sound-toggle").check();
    await page.waitForFunction(() => window.__soundDecoded.length === 7);
    await page.locator("#next").click(); await waitForCount(1);
    await page.keyboard.press("ArrowRight"); await waitForCount(2);
    await page.locator("#next").click(); await waitForCount(3); // capture
    await page.locator("#last").click(); await waitForCount(4); // check; jump emits once
    await page.locator("#flip").click(); assert.equal(await count(), 4);
    await page.locator("#prev").click(); await waitForCount(5);
    await page.locator("#first").click(); await waitForCount(6);
    await page.locator("#prev").click({ force: true }); assert.equal(await count(), 6, "no sound at a navigation boundary");
    await page.locator("#sound-toggle").uncheck(); await page.locator("#next").click();
    assert.equal(await count(), 6);
    await page.reload(); assert.equal(await page.locator("#sound-toggle").isChecked(), false);
    for (const slug of ["alternating-colors", "scp-096"]) {
      await page.goto(`${base}/variants/${slug}/`); await ready();
      assert.equal(await page.locator("#chk-sound").isChecked(), false, "mute follows variants");
      await page.locator("#chk-sound").check();
      await page.waitForFunction(() => window.__soundDecoded.length === 7);
      await clickMove(await page.evaluate(() => pos.legal.find(m => m.length === 4)));
      await waitForCount(1);
      await page.locator("#chk-sound").uncheck();
    }
    assert.deepEqual(errors, [], "browser errors"); assert.deepEqual(failed, [], "sound resource errors");
    await page.setViewportSize({ width: 320, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log("PASS real audio decoding/unlock, human/bot moves, mute across pages/variants, takeback/new game, replay/keyboard, silent redraws/import and mobile layout");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
