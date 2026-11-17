#!/usr/bin/env node
// Regenerate original SVG artwork, transparent PNGs, sprite and preview.
// node scripts/export-badges.js /path/to/playwright-tools
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
const output = path.resolve(__dirname, "../site/badges");
const bang = '<path d="M0 18v19" stroke="white" stroke-width="7" stroke-linecap="round"/><circle cy="46" r="3.8" fill="white"/>';
const question = '<path d="M-7 23c0-10 16-10 16 0 0 6-9 6-9 13" fill="none" stroke="white" stroke-width="6.5" stroke-linecap="round"/><circle cy="46" r="3.5" fill="white"/>';
const check = '<path d="m18 32 9 9 20-21" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>';
const badges = [
  ["brilliant", "Brilliant", "#19b9b0", `<g transform="translate(23)">${bang}</g><g transform="translate(41)">${bang}</g>`, "!!"],
  ["great", "Great", "#4c90d0", `<g transform="translate(32)">${bang}</g>`, "!"],
  ["best", "Best", "#82ad40", '<path d="m32 13 5.8 12 13.2 1.9-9.5 9.3 2.2 13.1L32 43.1l-11.7 6.2 2.2-13.1-9.5-9.3L26.2 25Z" fill="white"/>', "star"],
  ["excellent", "Excellent", "#75a34b", '<path d="M13 29h8v22h-8zm12 0 8-11c2-3 2-5 2-7 6-1 9 3 8 8l-2 8h9c5 0 6 3 5 7l-4 13c-1 3-3 4-6 4H25Z" fill="white"/>', "thumbs up"],
  ["good", "Good", "#668c50", check, "check"],
  ["ok", "OK", "#7b8b9e", '<path d="M21 27h22M21 37h22" stroke="white" stroke-width="6" stroke-linecap="round"/>', "equals"],
  ["inaccuracy", "Inaccuracy", "#e5af28", `<g transform="translate(23)">${question}</g><g transform="translate(43)">${bang}</g>`, "?!"],
  ["mistake", "Mistake", "#e58b2c", `<g transform="translate(32)">${question}</g>`, "?"],
  ["blunder", "Blunder", "#d84c50", `<g transform="translate(22)">${question}</g><g transform="translate(42)">${question}</g>`, "??"]
];

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
    const manifest = [];
    for (const [key, label, color, symbol, meaning] of badges) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64" role="img" aria-label="${label}"><title>${label}</title><circle cx="32" cy="32" r="30" fill="${color}"/>${symbol}</svg>\n`;
      await fs.writeFile(path.join(output, key + ".svg"), svg);
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
      await page.screenshot({ path: path.join(output, key + ".png"), omitBackground: true });
      manifest.push({ key, label, color, symbol: meaning, data: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64") });
    }
    await page.setViewportSize({ width: 1080, height: 510 });
    await page.setContent('<style>html,body{margin:0;background:transparent}canvas{display:block}</style><canvas width="1080" height="510"></canvas>');
    await page.evaluate(async entries => {
      const canvas = document.querySelector("canvas"), ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0b2036"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f1f6fc"; ctx.font = "bold 28px sans-serif"; ctx.fillText("Sharpfish · Move grades", 40, 49);
      ctx.fillStyle = "#b4c6d8"; ctx.font = "16px sans-serif"; ctx.fillText("Original symbol badges · Transparent PNG + SVG", 40, 79);
      for (let i = 0; i < entries.length; i++) {
        const item = entries[i], img = new Image(); img.src = item.data; await img.decode();
        const x = 40 + (i % 5) * 205, y = i < 5 ? 113 : 305;
        ctx.drawImage(img, x + 35, y, 100, 100);
        ctx.fillStyle = "#f1f6fc"; ctx.font = "bold 19px sans-serif"; ctx.textAlign = "center"; ctx.fillText(item.label, x + 85, y + 131);
        ctx.fillStyle = "#b4c6d8"; ctx.font = "14px sans-serif"; ctx.fillText(item.symbol, x + 85, y + 155); ctx.textAlign = "left";
      }
    }, manifest);
    await page.screenshot({ path: path.join(output, "preview.png") });
    await page.setViewportSize({ width: 576, height: 64 });
    await page.setContent('<style>html,body{margin:0;background:transparent}canvas{display:block}</style><canvas width="576" height="64"></canvas>');
    await page.evaluate(async entries => {
      const ctx = document.querySelector("canvas").getContext("2d");
      for (let i = 0; i < entries.length; i++) { const img = new Image(); img.src = entries[i].data; await img.decode(); ctx.drawImage(img, i * 64, 0, 64, 64); }
    }, manifest);
    await page.screenshot({ path: path.join(output, "sprite.png"), omitBackground: true });
    await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest.map(({ data, ...item }, index) => ({ ...item, x: index * 64, y: 0, width: 64, height: 64 })), null, 2) + "\n");
    console.log("Exported nine transparent 256px badges, SVG originals, 64px sprite and preview.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
