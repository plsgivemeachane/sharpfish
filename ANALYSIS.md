# Game review and local history

Open **History / Analyze PGN** from a play page, or use the analysis link on the collection homepage. Paste a standard-chess PGN or open one of the latest 50 games saved in this browser. Grading and evaluation are independent controls, available during supported live games and saved-game review. Existing games played before local history was introduced cannot be recovered automatically.

Games save after accepted moves and takebacks, including unfinished games and bot matches. Reviewing or grading an existing game does not create another game or make it newer. The 51st distinct game removes the oldest record. History belongs to the browser origin: another browser/device has different history, and clearing site data removes it.

## Grading policy

The ordinary ladder is **Best → Excellent → Good → OK → Inaccuracy → Mistake → Blunder**. Each move displays one final label. Great and Brilliant require separate contextual evidence.

First, full-strength Stockfish compares the played move with the best alternative. Its win/draw/loss output estimates expected score as `(wins + draws / 2) / 1000`. Scores are compared from the moving player's perspective, with mate and terminal states handled separately. The actual move is searched even when absent from the top alternatives.

The internal objective grade is then adjusted for human difficulty:

- **Discoverability:** how readily a limited search recognizes the punishment.
- **Naturalness:** whether the verified reply is a plausible human candidate in context, rather than a counterintuitive idea.
- **Delayed hidden consequence:** supports forgiveness when the point takes time to become apparent. A long, obvious forcing line does not qualify merely because it is long.

The number of punishing replies is not a difficulty input. Upgrades are easier to earn than downgrades. A move can improve up to two steps; a downgrade needs strong agreement that the error is easy to recognize and is limited to one step. Best remains reserved for objectively best or effectively tied moves. A difficulty adjustment alone cannot earn Great or Brilliant.

This is a Sharpfish heuristic, inspired by published move-review concepts. Engine WDL and shallow-search recognition are not calibrated human winning probabilities or human Elo estimates. Results depend on engine version, analysis budget, and classifier version; incompatible cached results need recalculation. Browser grading can lag rapid play, and a pending or interrupted search must not be shown as a completed grade.

## Variant boundary

Classic includes the former Elo ladder and supports standard-chess PGN grading. Legacy Elo ladder URLs redirect to Classic. Alternating-colors and SCP-096 keep their own gameplay and replay snapshots; standard Stockfish cannot establish move quality under those custom rules. Saving and replaying those games remains available independently of grading support.

## Maintenance

The browser modules have no added runtime package dependency. Unit and actual-WASM tests cover the classifier and parser; browser regressions cover local history, live controls, PGN review, and independent analysis toggles. The collection exporter decorates analysis pages with source links and versions local scripts/styles and engine assets using the frozen source revision.
