# Making your own engine variant

This repo is set up so that every fork (or branch) can change how the engine
plays and get a working, playable web build with one command.

## Quick start

```bash
git clone <your fork> && cd <your fork>
# edit src/variant/config.h
./make-web.sh serve          # build, then open http://localhost:8080
```

The first run installs the pinned Emscripten version (about 1 GB, one time) into
`~/emsdk`. After that a build takes about 20–30 seconds.

| Command | What it does |
| --- | --- |
| `./make-web.sh` | Build the lite single-threaded engine into `site/engine/` |
| `./make-web.sh test` | Build, then check the engine starts, counts legal moves and finds a move |
| `./make-web.sh serve` | Build, then serve the playable site on port 8080 |

## Where to make changes

| I want to… | Edit |
| --- | --- |
| Rename my engine | `EngineName` in `src/variant/config.h` |
| Change a piece's value | `PieceValueTweakCp` in `src/variant/config.h` |
| Make the engine trust its neural net less | `NnueScalePercent` in `src/variant/config.h` |
| Add my own evaluation terms | `eval_bonus_cp()` in `src/variant/hooks.h` + `EnableEvalHook` |
| Rate moves (prefer / avoid some moves) | `move_bias_cp()` in `src/variant/hooks.h` + `EnableMoveBias` |
| Make it play less predictably | `RootRandomnessCp` (with `EnableMoveBias`) |
| Ban castling / en passant / underpromotion / pawn double steps | the `Allow…` switches in `src/variant/config.h` |
| Add my own rule that forbids moves | `move_allowed_custom()` in `src/variant/hooks.h` + `EnableCustomRules` |
| Turn off null-move pruning | `EnableNullMove` in `src/variant/config.h` |
| Change the search itself | `src/search.cpp` (stock Stockfish code) |
| Change the board / site | `site/` (plain HTML/CSS/JS, no build step) |

Every switch defaults to stock Stockfish, and switches that are off are compiled
out, so an unchanged fork plays exactly like Stockfish.

### How the pieces fit together

- **Piece values.** Stockfish's evaluation is a neural network (NNUE) that has
  piece values built into its weights, so editing `PawnValue` etc. in
  `src/types.h` does *not* change how the engine values material (those
  constants only drive exchange and pruning math). `PieceValueTweakCp` adds a
  correction on top of the network's score instead, in centipawns.
- **Move rating** is applied to the moves at the root of the search (the moves
  the engine is choosing between right now). It nudges the choice; it does not
  change how deeper positions are scored.
- **Rules** are checked in `Position::legal()` and in the legal move generator,
  so the search, `go perft`, and the web board all follow them. The site asks
  the engine which moves are legal, so you never need to touch JavaScript to
  change the rules.
- Rules here can only **remove** moves. New pieces, new win conditions (e.g.
  king of the hill) or drops need real changes to `movegen.cpp`,
  `position.cpp` and `search.cpp`.

### Check that your change did something

```bash
./make-web.sh test
```

prints the engine name and the number of legal moves from the start position.
For evaluation changes, compare the `eval` command before and after:

```bash
(echo "position startpos moves e2e4"; echo eval; sleep 1; echo quit) \
  | node site/engine/stockfish-*-lite-single.js | grep "Final evaluation"
```

## Publishing your fork's site

`.github/workflows/build-site.yml` builds the engine and runs the test on every
push. On the default branch it also publishes `site/` to GitHub Pages. To turn
that on in your fork: **Settings → Pages → Source: GitHub Actions**.

Also change the "Source code" link in `site/index.html` to your fork's URL —
the GPL requires that people who use your engine can get its source.

## License

The engine is GPLv3 (see `Copying.txt`). Keep `Copying.txt`, `AUTHORS` and the
copyright headers. The "id author the Stockfish developers" line printed by
`uci` is kept even when you rename the engine. Piece images are GPLv2+
(see `site/pieces/README.md`).
