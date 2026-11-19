# Chess960 (Fischer Random)

This branch is the Chess960 play page and engine. The collection registers it
under `/variants/chess960/`; Classic stays on `main`.

New games choose uniformly from the 960 Scharnagl starting positions. Enter a
number from 0 to 959 to repeat a setup (518 is the orthodox arrangement), or
leave the field empty to randomize every new game. Both sides share the same
back rank. Bishops start on opposite colors, with the king between the rooks.

To castle, click or drag the king onto its own rook. Stockfish checks castling
rights, occupied paths, and attacked squares. After castling the king finishes
on g/c and the rook on f/d, including setups where one piece stays put or they
swap squares. Premoves use the same king-to-rook convention.

The playing engine and evaluation engine run with `UCI_Chess960` enabled.
History stores the initial FEN with rook-file castling rights. PGN exports carry
`Variant`, `SetUp`, and `FEN` tags so analysis can replay the same game. Bot rating
labels are inherited Classic estimates, without separate Chess960 calibration.

Validation:

```sh
./make-web.sh test
node scripts/chess960-test.js
node scripts/premove-test.js
node scripts/analysis-core-test.js
node scripts/game-history-test.js
node scripts/sound-test.js
node scripts/chess960-browser-test.js /path/to/playwright-tools http://localhost:8098
```

The browser regression covers human play as either color, bot matches, undo,
mobile overflow, castling overlaps/stationary pieces, attacked paths, and PGN
replay/evaluation with the actual WASM engines.
