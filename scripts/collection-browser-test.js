#!/usr/bin/env node
// node scripts/collection-browser-test.js /path/to/playwright-tools [base-url]
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const base = process.argv[3] || "http://localhost:8096";

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const failed = [];
    page.on("response", response => {
      if (response.status() >= 400) failed.push(response.url());
    });
    await page.goto(base);
    const links = await page.locator("a.variant").evaluateAll(elements => elements.map(a => a.getAttribute("href")));
    assert(links.length >= 4);
    await page.locator("a.variant").first().focus();
    assert.equal(await page.locator("a.variant").first().evaluate(el => getComputedStyle(el).outlineStyle), "solid");
    await page.setViewportSize({ width: 320, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "/tmp/sharpfish-home-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "/tmp/sharpfish-home-desktop.png", fullPage: true });
    for (const link of links) {
      await page.goto(`${base}/${link}`);
      await page.waitForFunction(() => typeof pos !== "undefined" && pos && !pos.pending && pos.turn === "w");
      assert(await page.locator("#board .piece").count() >= 32);
      await page.locator('[data-sq="e2"]').click();
      await page.locator('[data-sq="e4"]').click();
      await page.waitForFunction(() => game.moves.length >= 2 && pos && !pos.pending, null, { timeout: 30000 });
      // SCP-096 deliberately disables stock evaluation: its positions include a new piece.
      if (link === "variants/scp-096/") {
        assert(await page.locator("#evalbar").evaluate(el => el.classList.contains("off")));
      } else {
        assert(await page.evaluate(() => !!evalEngine));
        await page.locator("#chk-eval").check();
        await page.waitForFunction(() => document.getElementById("eval-label").textContent !== "");
      }
      console.log(`PASS ${link}: board, human move, bot reply, branch-specific evaluation behavior`);
      await page.getByRole("link", { name: "← All variants" }).click();
      await page.waitForURL(`${base}/`);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    const redirect = await context.request.get(`${base}/${links[0].replace(/\/$/, "")}`, { maxRedirects: 0 });
    assert.equal(redirect.status(), 301);
    const missing = await context.request.get(`${base}/variants/absent/`);
    assert.equal(missing.status(), 404);
    const metadata = await (await context.request.get(`${base}/build-info.json`)).json();
    for (const entry of metadata.variants) {
      const selector = await (await context.request.get(`${base}/variants/${entry.slug}/engine-file.js`)).text();
      const engine = selector.match(/window.ENGINE_FILE = "([^"]+)"/)[1];
      const wasm = await context.request.get(`${base}/variants/${entry.slug}/${engine.replace(/\.js$/, ".wasm")}`);
      assert.equal(wasm.status(), 200);
      assert.match(wasm.headers()["content-type"], /application\/wasm/);
      assert.equal(wasm.headers()["cache-control"], "no-cache");
      const source = await context.request.get(`${base}/variants/${entry.slug}/source.tar.gz`);
      assert.equal(source.status(), 200);
    }
    console.log("PASS navigation, responsive layout, no browser/resource errors, MIME, cache and source downloads");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
