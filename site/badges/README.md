# Move grade badge images

Original circular symbol icons, used by live play and PGN/history review. Each grade has a transparent 256 × 256 PNG and a scalable SVG. `preview.png` shows the complete set. `sprite.png` is a transparent horizontal strip of nine 64 × 64 cells; `manifest.json` records their order and coordinates.

| Grade | Symbol |
| --- | --- |
| Brilliant | !! |
| Great | ! |
| Best | Star |
| Excellent | Thumbs up |
| Good | Check |
| OK | Equals (acceptable) |
| Inaccuracy | ?! |
| Mistake | ? |
| Blunder | ?? |

Reference: [Chess.com's move classifications](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc). The reference uses compact colored circles and familiar chess annotation symbols. These assets are newly drawn for Sharpfish; Chess.com's image files are not included.

Regenerate using an external Playwright installation (no project dependency):

```sh
node scripts/export-badges.js /path/to/playwright-tools
```

Created for Sharpfish; distributed under the repository GPL-3.0 license.
