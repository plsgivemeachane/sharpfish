# Sharpfish

Sharpfish is a browser chess collection: Stockfish variants that you can play,
review, and analyze without installing anything. Play online at
[sharpfish.yuzukateam.io.vn](https://sharpfish.yuzukateam.io.vn/).

Everything runs in your browser. The engines are WebAssembly builds of
[Stockfish](https://github.com/official-stockfish/Stockfish) (through
[Stockfish.js](https://github.com/nmrugg/stockfish.js)), and your games are
stored only on your device.

## Variants

Each variant has its own engine. Your moves follow the normal rules of chess.

| Variant | What the bot does differently |
| --- | --- |
| **Classic** | Plays standard chess, with a roster of opponents from beginner to full strength. |
| **Alternating colors** | Its moves must alternate between light and dark destination squares, except when it is in check. |
| **SCP-096** | Plays alongside an uncapturable piece that blocks lines. After Black moves, SCP-096 eats one randomly chosen piece that attacks its square (a king sees adjacent squares). Losing a king to it ends the game. |
| **Sufferfish** | Plays near-perfect chess but avoids captures. It takes the best quiet move among its top five, and captures only when avoiding one costs over 30 centipawns or worsens a mate outcome. |

## Playing

- **Opponents.** Bots are grouped by strength (Beginner, Novice, Intermediate,
  Advanced, Engine). *Custom strength* sets any Elo from 0 to 3150, or full strength.
- **Bot vs bot.** Pick two bots and watch them play.
- **Think time** sets the maximum search time (default 2 s). Rated profiles also
  use a fixed 100,000-node search budget; Full uses the selected time only.
- **Move delay** sets the shortest wait before the bot plays (default 2 s).
  It gives you time to queue premoves. Choose *Instant* for bullet-paced games.
- **Your clock** times your side only: 1, 3, 5 or 10 minutes, or 2 + 1 and 3 + 2
  with increments. It starts after your first move, and you lose if it runs out.
- **Premoves.** While the bot thinks, queue several moves, even consecutive moves
  with the same piece. Clear them with a middle-click, Esc, or *Cancel premoves*.
- **Arrows and circles.** Right-click a square to circle it, or right-drag to draw
  an arrow. Hold Shift, Alt/Ctrl, or both to change the color.
- Take back moves, flip the board, step through the game, copy the PGN, and
  toggle sound effects.
- **Live eval bar** (optional). It moves as the search deepens instead of waiting
  for the search to finish. The analysis page uses the same live bar.

### Estimated bot ratings

Classic's roster now uses [measured engine-strength estimates](calibration/2026-11-17/README.md) from 2,400 complete games. These are approximate historical-reference engine ratings, **not Chess.com or FIDE equivalence**. The linked report lists every bot's old/new label, controls, uncertainty, and game evidence.

Named opponents retain their measured raw controls; custom strength maps the requested target through a versioned monotonic curve in `site/bots.js`. For example, the approximate 1800 profile uses native `UCI_Elo=1750`. The supported measured range is about 250–3100. Outside it, the selector shows the closest tested strength; adjacent target steps may share a configuration.

Rated moves use `go nodes 100000 movetime M`, where `M` is the selected Think time in milliseconds. Beginner profiles may finish earlier by policy. A short time cap or slow device can reduce completed work and effective strength. Full resets Skill Level to 20, disables artificial weakening, and searches for the selected time without a node cap.

Profiles expose the version, requested target, underlying control, node budget, support status, and provenance. New game-history records save a per-side profile timeline with the actual control, calibration version, and time cap, including mid-game opponent changes. Existing custom selections remain requested targets and are remapped on load; bot IDs and artwork remain stable.

Run `node scripts/bot-strength-test.js`. Browser checks: `node scripts/bot-strength-browser-test.js /path/to/playwright-tools http://localhost:PORT`. Calibration tools use external Python testing dependencies described in the report; the application adds no runtime dependencies.

## Move grading

Turn on *Real-time move grading* to have every move graded as you play, or review
a finished game on the analysis page. Each graded move gets a badge on the board
and in the move list.

Grading always uses **stock Stockfish**, not the variant engine. That way a grade
measures the chess, not the variant's quirks.

### The grades

A move is graded by how much winning chance it gives up compared with the
engine's best move. This is the *quality loss*, in centipawns (100 = one pawn):

| Grade | Quality loss |
| --- | --- |
| **Best** | ≤ 10 |
| **Excellent** | ≤ 25 |
| **Good** | ≤ 50 |
| **OK** | ≤ 75 |
| **Inaccuracy** | ≤ 125 |
| **Mistake** | ≤ 250 |
| **Blunder** | ≤ 500 |
| **Disaster** | > 500 |
| **Catastrophe** | Allows a confirmed forced mate in 1–5, or speeds one up |

There are also two special grades. Turn them off with the *Great / Brilliant
moves* switch if you only want the ordinary grades.

- **Great** is the only good move. The played move is Best or Excellent, and it
  beats the second-best move by at least 1.25 pawns. It must also either:
  - hold a position that every other move loses (the best move scores ≥ −0.5 and
    the alternative scores < −1.5), or
  - keep a win that every other move throws away (the best move scores ≥ +2 and
    the alternative scores < +1).
- **Brilliant** is a sound sacrifice. The played move is Best or Excellent, and
  the player is not in check and not already losing. It offers a piece worth at
  least a minor piece, on the destination square or undefended.

  Sharpfish then searches **every** way of taking that piece. Each capture must
  leave the sacrificing side with full compensation: no worse than −0.5, within
  half a pawn of the move's own score, and still mating if the move mated. The
  sacrifice must also be real: after the capture and the best reply, the player
  is at least two pawns down in material.

### Practical considerations

Engine numbers alone are harsh on humans, and sometimes too lenient. Sharpfish
adjusts grades for how hard a mistake is to see.

**Big wins are compressed.** Evaluations up to +3 count linearly. Above that,
they are compressed logarithmically. Dropping from +12 to +8 is still a crushing
win, so it is not graded like dropping from +4 to 0.

**Mates are handled as outcomes, not numbers:**

- When both moves mate for the same side, matching the fastest mate is Best.
  A slower mate of your own is Good. Letting the opponent's mate come closer is
  a Blunder.
- Walking into a forced mate is a Disaster, or a Catastrophe when the mate is
  short and confirmed.
- Missing your own forced mate is graded by what is left: still winning by
  3+ pawns is an Inaccuracy, still ahead is a Mistake, roughly level is a Blunder,
  and losing is a Disaster.

**Difficulty of the punishment.** Sharpfish looks at the opponent's best reply
to your mistake. It searches that reply at depths 4 and 7 as well as with the
full search, and asks three questions:

1. **Discoverability.** Would a shallow search find the refutation? A hidden
   mate, or a gain that only appears deeper, makes the reply *hard* or *very hard*.
2. **Naturalness.** Is the reply a natural move, such as a safe capture of a
   valuable piece or a check? Or is it a quiet move or a sacrifice that a player
   would not look at first?
3. **Delayed payoff.** Does the punishment start with a quiet move and win
   material only five or more plies later?

These scores add up. A hard-to-see refutation softens the grade by one step, and
a very well-hidden one by two. For example, a Mistake that loses only to a deep
quiet manoeuvre becomes an Inaccuracy.

The adjustment also works the other way. If the punishment is an obvious, immediate
capture or a mate in one, a costly move is graded one step **harsher**. Hanging
a queen to a one-move capture is worse than losing the same amount to a deep combination.

Best is never adjusted. A softened grade never reaches Best, and only a
confirmed short mate can reach Catastrophe.

### Accuracy and estimated Elo

The analysis page summarizes each side's play:

- **Accuracy** averages `100 × e^(−loss / 200)` over the analyzed moves.
  A perfect move scores 100, and a one-pawn loss scores about 61.
- **Estimated Elo** comes from the average loss per real decision. Forced moves
  (only one legal move) are not counted. It is shown once every move is analyzed
  and the side has made at least 5 decisions. It ranges from 100 to 2800, in
  steps of 50.

Each grade has a time budget (2 s by default, adjustable from 1 to 30 s). Grades
are cached with the settings that produced them, so revisiting a game is instant.
[ANALYSIS.md](ANALYSIS.md) documents the policy in full.

## Analysis page and history

- Every game is saved to your browser's local game history as you play.
  *Analyze this game* opens the current game.
- Import a PGN: one game of standard chess. Starting positions from
  `FEN`/`SetUp` tags are supported, and variations are skipped.
- Step through the moves with a live eval bar and grade badges. *Next issue*
  jumps to the next inaccuracy or worse, and *Alternative move* shows what the
  engine preferred.
- **Custom-rule variants** (Alternating colors, SCP-096) are analyzed position by
  position as ordinary chess. A move that would be illegal in ordinary chess is
  marked *unavailable* and is not graded.

## Development

- `./make-web.sh serve` builds the current branch's engine and serves its site locally.
- [FORKING.md](FORKING.md) explains how to make a new engine variant.
- [DEPLOYMENT.md](DEPLOYMENT.md) and [AGENTS.md](AGENTS.md) explain how the
  collection is built and published. Pushing a branch does not deploy the site.
- [DESIGN.md](DESIGN.md) records the design decisions behind the interface.

Each variant lives on its own branch. `main` also holds the collection tooling
and `variants.json`.

## Thanks

- <a href="https://github.com/exoticorn/stockfish-js">exoticorn</a> for the original Stockfish to JS conversion
- <a href="https://github.com/ddugovic/Stockfish">ddugovic</a> for his Stockfish with many variants
- <a href="https://github.com/niklasf/">niklasf</a> for his <a href="https://github.com/niklasf/stockfish.js">stockfish.js</a> & <a href="https://github.com/niklasf/stockfish.wasm">stockfish.wasm</a>
- <a href="https://github.com/hi-ogawa/Stockfish">hi-ogawa</a> for his optimizations
- <a href="https://github.com/linrock">linrock</a> for older <a href="https://tests.stockfishchess.org/nns?network_name=nn-9067e33176e">lite nets</a>
- <a href="https://github.com/sscg13/Stockfish/tree/sf19-1mb">sscg13</a> for Stockfish 19 <a href="https://tests.stockfishchess.org/nns?network_name=nn-61e7af4bb97d">lite nets</a>
- <a href="https://github.com/lichess-org/stockfish-web">Lichess WASM Builds</a> for their patches
- <a href="https://github.com/official-stockfish/Stockfish">The Stockfish team</a> for everything

See <a href="https://raw.githubusercontent.com/nmrugg/stockfish.js/master/AUTHORS">AUTHORS</a> for more credits.

## License

Stockfish.js engine code is GPL v3 (see <a href="https://raw.githubusercontent.com/nmrugg/stockfish.js/master/Copying.txt">Copying.txt</a>). The published npm package is licensed under GPL-3.0 because it contains the engine.

The non-engine code is MIT licensed.
