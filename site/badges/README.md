# Move grade badge images

An original family of eleven metallic "coin" badges, used by live play, PGN/history review and the board overlays. Each grade has a scalable SVG original and a transparent 256 × 256 PNG with the same basename. `preview.png` is the contact sheet (all eleven at 112 px, plus 48/32/24 px strips on dark, light and board-square backgrounds). `sprite.png` is a transparent horizontal strip of eleven 64 × 64 cells; `manifest.json` records each cell's key, label, face colour, symbol and coordinates.

| Grade | Coin | Symbol |
| --- | --- | --- |
| Brilliant | Violet, soft aura | Four-point sparkle in a laurel, crown on the rim, gem below |
| Great | Teal-emerald | Double up chevron |
| Best | Green | Faceted five-point star |
| Excellent | Yellow-green | Thumbs up |
| Good | Sage | Check |
| OK | Silver-slate | Diamond on a dash |
| Inaccuracy | Gold | Single down chevron |
| Mistake | Orange | Double down chevron |
| Blunder | Red | Impact burst with debris |
| Disaster | Crimson | Skull |
| Catastrophe | Oxblood, ember aura | Shattered crown |

## Design rules

- One shared coin construction: cast shadow, metallic rim with a vertical gradient, inverted inner lip (the bevel), domed radial face, soft top gloss, a specular arc on the upper-left rim.
- Glyphs are white, angular, filled shapes with a vertical white-to-tint gradient, a darker right-hand facet, a short drop shadow and a restrained colour glow. They stay within a radius of about 31 of 64 units, so nothing crowds the rim.
- Hierarchy: only the two extremes get extra treatment. Brilliant has a crown, a gem and a violet aura; Catastrophe has an ember aura and the darkest coin. The rest differ by colour family and silhouette, so each grade is still recognisable at 24 px.
- Good grades rise (chevrons, star, thumb, check), OK sits level, and errors fall (chevrons) before breaking (burst, skull, shattered crown). The Brilliant crown and the shattered Catastrophe crown intentionally mirror each other.
- No text inside icons, no rectangular backgrounds; every PNG has fully transparent corners and edges.

The concept reference showed five example coins (red burst, orange down chevrons, slate diamond, green up chevrons, crowned violet sparkle). This set extends that style to all eleven Sharpfish grades. It is drawn from scratch for Sharpfish and contains no third-party image files.

## Regenerate

All artwork is defined in `scripts/export-badges.js`, and its SVG output is deterministic. Rendering uses an external Playwright installation (not a project dependency):

```sh
node scripts/export-badges.js /path/to/playwright-tools
```

This rewrites every `*.svg`, `*.png`, `sprite.png`, `preview.png` and `manifest.json` in this directory. Keep the basenames: the play, review and overlay code loads `badges/<grade>.png` directly.

Created for Sharpfish; distributed under the repository GPL-3.0 license.
