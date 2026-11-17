#!/usr/bin/env node
// Regenerate the move-grade badge family: SVG originals, transparent 256px PNGs,
// a 64px sprite strip with manifest, and the preview contact sheet.
//
//   node scripts/export-badges.js /path/to/playwright-tools
//
// Every SVG is built from the same layered coin (cast shadow, metallic rim,
// inverted inner lip, domed face, gloss, specular arc) plus a white faceted
// glyph. All geometry lives in a 128-unit viewBox centred on (64, 64); the
// glyph stays inside a radius of about 31 units so it never crowds the rim.
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");

const output = path.resolve(__dirname, "../site/badges");
const C = 64;
const R_RIM = 53, R_LIP = 46.5, R_FACE = 43;
const f = n => +n.toFixed(2);
const pt = ([x, y]) => `${f(x)} ${f(y)}`;
const poly = points => "M" + points.map(pt).join("L") + "Z";
const polar = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];

// ---------------------------------------------------------------- palette --
// center/edge: face radial gradient; hi/mid/lo: metal rim; tint: glyph foot;
// glow: glyph halo colour; aura: optional soft halo behind the whole coin.
const palette = {
  brilliant:   { center: "#8f5cf2", edge: "#2e0b6e", hi: "#f3e8ff", mid: "#b18cff", lo: "#4c1d95", tint: "#e9dcff", glow: "#c9a6ff", glowOpacity: 0.85, aura: "#a26bff" },
  great:       { center: "#18b58f", edge: "#04382c", hi: "#d5fff1", mid: "#3fd6a8", lo: "#06604a", tint: "#c9fbe8", glow: "#7bf0c9", glowOpacity: 0.55 },
  best:        { center: "#4cb84a", edge: "#0f3d16", hi: "#e1ffd8", mid: "#6fd665", lo: "#1d6b22", tint: "#d6fbcf", glow: "#a4f59a", glowOpacity: 0.5 },
  excellent:   { center: "#86b23a", edge: "#2a4110", hi: "#f2ffd6", mid: "#a7d051", lo: "#4b6b16", tint: "#ecfbc8", glow: "#d3f28f", glowOpacity: 0.35 },
  good:        { center: "#6f9468", edge: "#1f3320", hi: "#e7f2e2", mid: "#97b88e", lo: "#3e5a3a", tint: "#e0eedb", glow: "#c6e0bd", glowOpacity: 0.22 },
  ok:          { center: "#6d7d97", edge: "#1c2434", hi: "#ffffff", mid: "#c3cede", lo: "#56657e", tint: "#dbe3ef", glow: "#e2e8f2", glowOpacity: 0.18 },
  inaccuracy:  { center: "#e3aa1c", edge: "#5e3c02", hi: "#fff6cf", mid: "#fac83a", lo: "#9a6205", tint: "#fff1c2", glow: "#ffe08a", glowOpacity: 0.3 },
  mistake:     { center: "#e8781d", edge: "#5a2104", hi: "#ffe3c4", mid: "#ff9a3d", lo: "#9b3d08", tint: "#ffe6cc", glow: "#ffbf80", glowOpacity: 0.32 },
  blunder:     { center: "#d8343f", edge: "#4d0710", hi: "#ffd3d3", mid: "#f56b6b", lo: "#8f1620", tint: "#ffd9db", glow: "#ff9da2", glowOpacity: 0.4 },
  disaster:    { center: "#b0123a", edge: "#33020f", hi: "#ffc2d0", mid: "#e5355f", lo: "#6e0a22", tint: "#ffd0dc", glow: "#ff6f8f", glowOpacity: 0.45 },
  catastrophe: { center: "#741020", edge: "#140105", hi: "#ff9b8f", mid: "#9c1c22", lo: "#2a0508", tint: "#ffc9c2", glow: "#ff4a3a", glowOpacity: 0.65, aura: "#ff2a1f" }
};

// ----------------------------------------------------------------- glyphs --
// A glyph is a list of parts. Each part is a filled path (evenodd allowed),
// optionally clipped and transformed. `facet` is a region shaded darker to give
// the two-tone bevel; by default the right half of the coin.
const RIGHT_HALF = "M64 0H128V128H64Z";

function chevronUp(apexY, half, thick) {
  return poly([[C - half, apexY + half], [C, apexY], [C + half, apexY + half], [C + half, apexY + half + thick], [C, apexY + thick], [C - half, apexY + half + thick]]);
}
function chevronDown(topY, half, thick) {
  return poly([[C - half, topY], [C, topY + half], [C + half, topY], [C + half, topY + thick], [C, topY + half + thick], [C - half, topY + thick]]);
}

function star(cx, cy, outer, inner) {
  const points = [];
  for (let i = 0; i < 10; i++) points.push(polar(cx, cy, i % 2 ? inner : outer, -90 + i * 36));
  // Facets: shade the clockwise half of every point for a carved look.
  let facets = "";
  for (let i = 0; i < 5; i++) facets += poly([[cx, cy], points[i * 2], points[(i * 2 + 1) % 10]]);
  return { d: poly(points), facet: facets };
}

function sparkle(cx, cy, rx, ry, waist) {
  // Concave four-point star.
  return `M${f(cx)} ${f(cy - ry)}Q${f(cx + waist)} ${f(cy - waist)} ${f(cx + rx)} ${f(cy)}Q${f(cx + waist)} ${f(cy + waist)} ${f(cx)} ${f(cy + ry)}Q${f(cx - waist)} ${f(cy + waist)} ${f(cx - rx)} ${f(cy)}Q${f(cx - waist)} ${f(cy - waist)} ${f(cx)} ${f(cy - ry)}Z`;
}

function laurel(cx, cy, radius) {
  // Two branches rising from the bottom of the face, leaves angled outward.
  let leaves = "", stems = "";
  for (const side of [-1, 1]) {
    const arc = [];
    for (let i = 0; i < 5; i++) {
      const theta = 30 + i * 18.5; // degrees from straight down toward this side
      const rad = theta * Math.PI / 180;
      const x = cx + side * radius * Math.sin(rad), y = cy + radius * Math.cos(rad);
      arc.push([x, y]);
      // Tangent pointing up the branch, then tilt outward.
      const tx = side * Math.cos(rad), ty = -Math.sin(rad);
      const angle = Math.atan2(ty, tx) + side * 0.72;
      const len = 12.5 - i * 0.7, wid = 5.4 - i * 0.35;
      const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
      const p = (a, b) => [x + ux * a + nx * b, y + uy * a + ny * b];
      leaves += `M${pt(p(0, 0))}C${pt(p(len * 0.3, wid))} ${pt(p(len * 0.75, wid * 0.9))} ${pt(p(len, 0))}C${pt(p(len * 0.75, -wid * 0.9))} ${pt(p(len * 0.3, -wid))} ${pt(p(0, 0))}Z`;
    }
    const start = [cx + side * radius * Math.sin(14 * Math.PI / 180), cy + radius * Math.cos(14 * Math.PI / 180)];
    stems += `M${pt(start)}A${radius} ${radius} 0 0 ${side > 0 ? 0 : 1} ${pt(arc[4])}`;
  }
  return { leaves, stems };
}

function thumbsUp() {
  // Geometric fist with raised thumb; cuff separated by a narrow gap.
  const cuff = "M36 59.5Q36 57 38.5 57H45.5Q48 57 48 59.5V88.5Q48 91 45.5 91H38.5Q36 91 36 88.5Z";
  const hand = "M51 59L60.5 40.5Q63.6 34.6 68.8 36.6Q73.4 38.6 72.1 44.6L70 55H85.5Q92.6 55 91.6 62.4L88.4 84.6Q87.4 91 81 91H51Z";
  // Finger creases cut through the palm (evenodd holes kept thin).
  const creases = "M73 66.4H89.6V68.6H73ZM73 74.8H88.6V77H73ZM73 83H87.6V85.2H73Z";
  return [{ d: cuff }, { d: hand + creases }];
}

function burst() {
  // Comic-style impact: eleven uneven spikes around a solid core, plus debris.
  const cx = 63.5, cy = 63.5;
  const outer = [31, 23, 28, 21.5, 30, 22, 27, 24, 29.5, 21, 26];
  const jitter = [0, 4, -3, 5, 2, -4, 3, -2, 4, -3, 2];
  const points = [];
  outer.forEach((r, k) => {
    const a = -90 + k * 360 / 11 + jitter[k];
    points.push(polar(cx, cy, r, a));
    points.push(polar(cx, cy, 14.5, a + 180 / 11));
  });
  const shard = (angle, r, size, spin) => {
    const [x, y] = polar(cx, cy, r, angle);
    return poly([polar(x, y, size, angle + spin), polar(x, y, size * 0.55, angle + spin + 125), polar(x, y, size * 0.7, angle + spin + 230)]);
  };
  return [{ d: poly(points), facetOpacity: 0.16 }, { d: shard(-40, 37, 5.6, 10) + shard(146, 37.5, 5.2, -20) + shard(62, 37.5, 4.4, 40) }];
}

function skull() {
  const cranium = "M64 32C80.5 32 91 43.5 91 58.5C91 67.6 86.3 73.5 80.5 76.5V83H47.5V76.5C41.7 73.5 37 67.6 37 58.5C37 43.5 47.5 32 64 32Z";
  const jaw = "M49.5 85.5H78.5V91.5Q78.5 95 75 95H53Q49.5 95 49.5 91.5Z";
  const eyes = poly([[44.5, 56.5], [59.5, 60], [57.8, 70.5], [47, 69.5]]) + poly([[83.5, 56.5], [68.5, 60], [70.2, 70.5], [81, 69.5]]);
  const nose = poly([[64, 71.5], [68.2, 79.5], [59.8, 79.5]]);
  const teeth = "M56.6 85.5H59V95H56.6ZM62.8 85.5H65.2V95H62.8ZM69 85.5H71.4V95H69Z";
  return [{ d: cranium + eyes + nose, facetOpacity: 0.12 }, { d: jaw + teeth, facetOpacity: 0.12 }];
}

function shatteredCrown() {
  const body = poly([[40, 82], [36, 51], [51.5, 63], [64, 40], [76.5, 63], [92, 51], [88, 82]]);
  const band = "M38.5 85.5H89.5V94H38.5Z";
  const jewels = circlePath(36, 47.5, 4.6) + circlePath(92, 47.5, 4.6);
  const crown = body + band + jewels;
  const crack = [[65.5, 34], [60.5, 50], [67.5, 60], [59.5, 71.5], [66.5, 81], [61.5, 100]];
  const left = "M0 0H65.5" + crack.map(p => "L" + pt(p)).join("") + "V128H0Z";
  const right = "M128 0H65.5" + crack.map(p => "L" + pt(p)).join("") + "V128H128Z";
  return [
    { d: crown, clip: left, transform: "translate(-2 1) rotate(-7 44 95)", facetOpacity: 0 },
    { d: crown, clip: right, transform: "translate(2.5 2) rotate(8 86 95)", facetOpacity: 0.24, facet: "M0 0H128V128H0Z" },
    { d: poly([[61.5, 28.5], [67, 25.5], [66, 33]]) }
  ];
}

function circlePath(cx, cy, r) {
  return `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;
}

const brilliantLaurel = laurel(64, 60, 33);
const bestStar = star(64, 66, 31, 13.2);

const badges = [
  { key: "brilliant", label: "Brilliant", symbol: "crowned sparkle with laurel",
    parts: [{ d: sparkle(64, 59, 20, 25, 4.4) }, { d: brilliantLaurel.leaves, facetOpacity: 0.12 }], stroke: brilliantLaurel.stems, crown: true },
  { key: "great", label: "Great", symbol: "double up chevron",
    parts: [{ d: chevronUp(38, 21, 11.5) }, { d: chevronUp(57, 21, 11.5), opacity: 0.86 }] },
  { key: "best", label: "Best", symbol: "faceted star",
    parts: [{ d: bestStar.d, facet: bestStar.facet }] },
  { key: "excellent", label: "Excellent", symbol: "thumbs up", parts: thumbsUp() },
  { key: "good", label: "Good", symbol: "check",
    parts: [{ d: poly([[36.5, 63], [45.5, 54], [57.5, 66], [82.5, 41], [91.5, 50], [57.5, 84]]) }] },
  { key: "ok", label: "OK", symbol: "diamond on dash",
    parts: [{ d: poly([[64, 41], [87, 64], [64, 87], [41, 64]]), facet: "M64 0H128V128H64ZM0 64H64V128H0Z" },
            { d: "M25.5 61Q24 61 24 62.5V65.5Q24 67 25.5 67H35V61ZM102.5 61Q104 61 104 62.5V65.5Q104 67 102.5 67H93V61Z" }] },
  { key: "inaccuracy", label: "Inaccuracy", symbol: "single down chevron",
    parts: [{ d: chevronDown(44, 24, 14.5) }] },
  { key: "mistake", label: "Mistake", symbol: "double down chevron",
    parts: [{ d: chevronDown(36.5, 21, 11.5), opacity: 0.86 }, { d: chevronDown(55.5, 21, 11.5) }] },
  { key: "blunder", label: "Blunder", symbol: "impact burst", parts: burst() },
  { key: "disaster", label: "Disaster", symbol: "skull", parts: skull() },
  { key: "catastrophe", label: "Catastrophe", symbol: "shattered crown", parts: shatteredCrown() }
];

// ------------------------------------------------------------------- coin --
function svgFor(badge) {
  const k = badge.key, p = palette[k];
  const id = name => `${k}-${name}`;
  const defs = [];
  defs.push(`<linearGradient id="${id("rim")}" x1="0" y1="11" x2="0" y2="117" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.hi}"/><stop offset=".3" stop-color="${p.mid}"/><stop offset=".72" stop-color="${p.lo}"/><stop offset=".9" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.lo}"/></linearGradient>`);
  defs.push(`<linearGradient id="${id("lip")}" x1="0" y1="17.5" x2="0" y2="110.5" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.lo}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.hi}"/></linearGradient>`);
  defs.push(`<radialGradient id="${id("face")}" cx="64" cy="50" r="52" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.center}"/><stop offset=".55" stop-color="${p.center}" stop-opacity=".9"/><stop offset="1" stop-color="${p.edge}"/></radialGradient>`);
  defs.push(`<linearGradient id="${id("gloss")}" x1="0" y1="21" x2="0" y2="47" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
  defs.push(`<linearGradient id="${id("glyph")}" x1="0" y1="34" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff"/><stop offset="1" stop-color="${p.tint}"/></linearGradient>`);
  defs.push(`<filter id="${id("cast")}" x="0" y="0" width="128" height="128" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="1.6"/></filter>`);
  defs.push(`<filter id="${id("lift")}" x="0" y="0" width="128" height="128" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="${p.glow}" flood-opacity="${p.glowOpacity}"/><feDropShadow dx="0" dy="1.8" stdDeviation=".7" flood-color="${p.edge}" flood-opacity=".85"/></filter>`);
  defs.push(`<clipPath id="${id("face-clip")}"><circle cx="64" cy="64" r="${R_FACE}"/></clipPath>`);
  if (p.aura) defs.push(`<radialGradient id="${id("aura")}" cx="64" cy="64" r="62" gradientUnits="userSpaceOnUse"><stop offset=".78" stop-color="${p.aura}" stop-opacity=".55"/><stop offset=".88" stop-color="${p.aura}" stop-opacity=".2"/><stop offset="1" stop-color="${p.aura}" stop-opacity="0"/></radialGradient>`);

  const glyph = [];
  badge.parts.forEach((part, i) => {
    const facetId = id(`facet${i}`);
    defs.push(`<clipPath id="${facetId}"><path d="${part.facet || RIGHT_HALF}"/></clipPath>`);
    let clipAttr = "";
    if (part.clip) { defs.push(`<clipPath id="${id(`part${i}`)}"><path d="${part.clip}"/></clipPath>`); clipAttr = ` clip-path="url(#${id(`part${i}`)})"`; }
    const opacity = part.opacity ? ` opacity="${part.opacity}"` : "";
    const transform = part.transform ? ` transform="${part.transform}"` : "";
    glyph.push(`<g${transform}${opacity}><g${clipAttr}><path d="${part.d}" fill="url(#${id("glyph")})" fill-rule="evenodd"/><path d="${part.d}" fill="${p.lo}" fill-opacity="${part.facetOpacity ?? 0.2}" fill-rule="evenodd" clip-path="url(#${facetId})"/></g></g>`);
  });
  if (badge.stroke) glyph.unshift(`<path d="${badge.stroke}" fill="none" stroke="url(#${id("glyph")})" stroke-width="2.6" stroke-linecap="round"/>`);

  let crown = "";
  if (badge.crown) {
    // Crown seated on the rim, plus a cut gem at the bottom of the rim.
    const crownPath = poly([[47, 23], [43, 12], [54.5, 17], [64, 8.5], [73.5, 17], [85, 12], [81, 23]]) + circlePath(43, 11, 2.6) + circlePath(64, 8.2, 2.8) + circlePath(85, 11, 2.6);
    const gem = poly([[64, 107], [69, 112.5], [64, 118], [59, 112.5]]);
    crown = `<g filter="url(#${id("crown-lift")})"><path d="${crownPath}${gem}" fill="url(#${id("crown")})" stroke="${p.lo}" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke"/><path d="${crownPath}${gem}" fill="${p.lo}" fill-opacity=".28" clip-path="url(#${id("facet0")})"/></g>`;
    defs.push(`<filter id="${id("crown-lift")}" x="0" y="0" width="128" height="128" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="${p.glow}" flood-opacity=".7"/><feDropShadow dx="0" dy="1.4" stdDeviation=".6" flood-color="${p.edge}" flood-opacity=".8"/></filter>`);
    defs.push(`<linearGradient id="${id("crown")}" x1="0" y1="5" x2="0" y2="23" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${p.tint}"/></linearGradient>`);
  }

  const glossPath = `M${64 - 38} 52C${64 - 34} 30 ${64 - 18} 22 64 22C${64 + 18} 22 ${64 + 34} 30 ${64 + 38} 52C${64 + 22} 44 ${64 - 22} 44 ${64 - 38} 52Z`;
  const specular = (() => { const a = polar(64, 64, 50, 198), b = polar(64, 64, 50, 252); return `M${pt(a)}A50 50 0 0 1 ${pt(b)}`; })();

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128" role="img" aria-label="${badge.label}">`,
    `<title>${badge.label}</title>`,
    `<defs>${defs.join("")}</defs>`,
    p.aura ? `<circle cx="64" cy="64" r="62" fill="url(#${id("aura")})"/>` : "",
    `<circle cx="64" cy="66.5" r="${R_RIM}" fill="#000" fill-opacity=".38" filter="url(#${id("cast")})"/>`,
    `<circle cx="64" cy="64" r="${R_RIM}" fill="url(#${id("rim")})"/>`,
    `<circle cx="64" cy="64" r="${R_RIM - 0.6}" fill="none" stroke="${p.edge}" stroke-opacity=".7" stroke-width="1.2"/>`,
    `<circle cx="64" cy="64" r="${R_LIP}" fill="url(#${id("lip")})"/>`,
    `<circle cx="64" cy="64" r="${R_FACE}" fill="url(#${id("face")})"/>`,
    `<circle cx="64" cy="64" r="${R_FACE - 0.8}" fill="none" stroke="#000" stroke-opacity=".32" stroke-width="1.6"/>`,
    `<path d="${glossPath}" fill="url(#${id("gloss")})" clip-path="url(#${id("face-clip")})"/>`,
    `<path d="${specular}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/>`,
    `<g filter="url(#${id("lift")})">${glyph.join("")}</g>`,
    crown,
    `</svg>`
  ].filter(Boolean).join("\n") + "\n";
}

// ---------------------------------------------------------------- export --
const dataUrl = (type, body) => `data:${type};base64,` + Buffer.from(body).toString("base64");

function previewHtml(entries) {
  const tile = e => `<figure><img src="${e.png}" width="112" height="112" alt=""><figcaption><b>${e.label}</b><span>${e.symbol}</span></figcaption></figure>`;
  const strip = (size, cls) => `<div class="strip ${cls}"><em>${size}px</em>${entries.map(e => `<img src="${e.png}" width="${size}" height="${size}" alt="">`).join("")}</div>`;
  const board = size => `<div class="strip board"><em>${size}px on board</em>${entries.map((e, i) => `<span class="sq ${i % 2 ? "dk" : "lt"}"><img src="${e.png}" width="${size}" height="${size}" alt=""></span>`).join("")}</div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#0b1424;font-family:Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#eef3fb}
    main{width:1120px;padding:36px 40px 40px;box-sizing:border-box;background:radial-gradient(120% 90% at 50% 0%,#16243d 0%,#0b1424 70%)}
    h1{margin:0;font-size:28px;letter-spacing:.2px} p{margin:6px 0 26px;color:#9fb1c9;font-size:15px}
    .grid{display:grid;grid-template-columns:repeat(6,1fr);row-gap:18px}
    figure{margin:0;display:flex;flex-direction:column;align-items:center}
    figcaption{display:flex;flex-direction:column;align-items:center;margin-top:8px;gap:3px}
    figcaption b{font-size:16px} figcaption span{font-size:12.5px;color:#93a6c0}
    h2{margin:30px 0 12px;font-size:14px;font-weight:600;color:#9fb1c9;text-transform:uppercase;letter-spacing:1.4px}
    .strip{display:flex;align-items:center;gap:14px;padding:10px 16px;border-radius:12px;margin-bottom:8px}
    .strip em{font-style:normal;font-size:12px;width:96px;color:#93a6c0}
    .dark{background:#111b2c}.light{background:#eef2f7}.light em{color:#526077}
    .board{background:#111b2c;gap:0}.board em{margin-right:14px}
    .sq{width:44px;height:44px;display:flex;align-items:flex-start;justify-content:flex-end;padding:2px;box-sizing:border-box}
    .lt{background:#ecdab9}.dk{background:#ae8a68}
  </style><main><h1>Sharpfish · Move grades</h1><p>Eleven metallic coins · Brilliant → Catastrophe · transparent 256px PNG + SVG</p>
  <div class="grid">${entries.map(tile).join("")}</div>
  <h2>Actual sizes</h2>${strip(48, "dark")}${strip(32, "dark")}${strip(24, "dark")}${strip(24, "light")}${board(24)}</main>`;
}

(async () => {
  if (!process.argv[2]) throw new Error("usage: node scripts/export-badges.js /path/to/playwright-tools");
  const { chromium } = require(path.resolve(process.argv[2], "node_modules/playwright"));
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
    const entries = [];
    for (const badge of badges) {
      const svg = svgFor(badge);
      await fs.writeFile(path.join(output, badge.key + ".svg"), svg);
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
      const png = await page.screenshot({ path: path.join(output, badge.key + ".png"), omitBackground: true });
      entries.push({ key: badge.key, label: badge.label, color: palette[badge.key].center, symbol: badge.symbol, png: dataUrl("image/png", png) });
    }

    // Sprite: eleven 64px cells, downscaled from the same PNGs the site serves.
    const cell = 64, spriteWidth = entries.length * cell;
    await page.setViewportSize({ width: spriteWidth, height: cell });
    await page.setContent(`<style>html,body{margin:0;background:transparent}div{display:flex}img{display:block}</style><div>${entries.map(e => `<img src="${e.png}" width="${cell}" height="${cell}">`).join("")}</div>`);
    await page.waitForFunction(() => [...document.images].every(img => img.complete));
    await page.screenshot({ path: path.join(output, "sprite.png"), omitBackground: true });

    // Preview contact sheet.
    await page.setViewportSize({ width: 1120, height: 400 });
    await page.setContent(previewHtml(entries));
    await page.waitForFunction(() => [...document.images].every(img => img.complete));
    await page.locator("main").screenshot({ path: path.join(output, "preview.png") });

    const manifest = entries.map(({ png, ...item }, index) => ({ ...item, x: index * cell, y: 0, width: cell, height: cell }));
    await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Exported ${badges.length} SVG originals, transparent 256px PNGs, ${cell}px sprite, manifest and preview.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
