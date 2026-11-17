# Game review and local history

Open **History / Analyze PGN** from a play page, or use the analysis link on the collection homepage. Paste a standard-chess PGN or open one of the latest 50 games saved in this browser. Grading and evaluation are independent controls, available during supported live games and saved-game review. Existing games played before local history was introduced cannot be recovered automatically.

Games save after accepted moves and takebacks, including unfinished games and bot matches. Reviewing or grading an existing game does not create another game or make it newer. The 51st distinct game removes the oldest record. History belongs to the browser origin: another browser/device has different history, and clearing site data removes it.

## Grading policy

The ordinary ladder is **Best → Excellent → Good → OK → Inaccuracy → Mistake → Blunder → Disaster → Catastrophe**. Each move displays one final label. Great and Brilliant require separate contextual evidence.

Full-strength Stockfish (Skill Level 20, strength limiting disabled) compares the played move with the best alternative at depth 20 minimum. Mate and special-grade verification uses depth 22 minimum. Requested lower grade depths are clamped to 20; the playing bot's strength never limits the analysis worker. The actual move is searched even when absent from the top alternatives.

The default objective model is **centipawn loss**, normalized to the mover: `(bestWhiteCp - playedWhiteCp) × (White ? 1 : -1)`. One advantage point is 100 centipawns. There are no player ratings, win-probability curves, or material-loss penalties in this classification. A sound queen sacrifice remains good when its deep score is close to the best move.

| Advantage lost | Objective grade |
| --- | --- |
| 0–0.10 points | Best |
| >0.10–0.25 | Excellent |
| >0.25–0.50 | Good |
| >0.50–0.75 | OK |
| >0.75–1.25 | Inaccuracy |
| >1.25–2.50 | Mistake |
| >2.50–5.00 | Blunder |
| >5.00 | Disaster |

These are Sharpfish policy thresholds, not published Chess.com, Lichess, or WintrChess thresholds. Unlike a probability curve, a change from +15 to +6 or −6 to −15 remains a nine-point loss.

Mate is a separate ordered outcome and is never converted into a large invented centipawn number. Preserving the best known forced-mate distance can earn Best; accelerating the opponent's mate is an error, and delaying one's own forced mate earns Good. Missing a forced win is graded according to the remaining advantage. **Catastrophe** requires both the root played-move search and an independent depth-22 search of the resulting position to confirm opponent mate in 1–5, newly allowed or faster than the best defense. M6 does not qualify. Practical ease cannot manufacture this tier without mate evidence. The recorded `mateChange` and `mateEvidence` explain the comparison; numerical loss fields are null for mate transitions.

The internal objective grade is then adjusted for human difficulty:

- **Discoverability:** how readily a limited search recognizes the punishment. Depth-4 and depth-7 diagnostic searches are compared with the deeper reply search; these diagnostic scores do not determine the objective grade.
- **Naturalness:** whether the verified reply is a plausible human candidate in context, rather than a counterintuitive idea.
- **Delayed hidden consequence:** supports forgiveness when the point takes time to become apparent. A long, obvious forcing line does not qualify merely because it is long.

The number of punishing replies is not a difficulty input. Upgrades are easier to earn than downgrades. A move can improve up to two steps; a downgrade needs strong agreement that the error is easy to recognize and is limited to one step. Best remains reserved for objectively best or effectively tied moves. A difficulty adjustment alone cannot earn Great or Brilliant.

This is a Sharpfish heuristic. Advantage-loss bands and shallow-search recognition require calibration against human examples; they do not estimate player Elo. Engine evaluations are search-dependent and not literal material counts. Results depend on engine version, analysis budget, and classifier version; incompatible cached results need recalculation. Depth-20 grading can take substantial time, especially on mobile. Browser grading can lag rapid play, and a pending or interrupted search must not be shown as a completed grade.

The current move's grade also appears at the top-right of its destination piece in play and replay. Move lists reserve an icon slot before SAN so receiving a grade does not shift move text. Badges are original metallic coin artwork exported as transparent PNGs and scalable SVGs.

## Variant boundary

Classic includes the former Elo ladder and supports standard-chess PGN grading. Legacy Elo ladder URLs redirect to Classic. Alternating-colors and SCP-096 keep their own gameplay and replay snapshots; standard Stockfish cannot establish move quality under those custom rules. Saving and replaying those games remains available independently of grading support.

## Maintenance

The browser modules have no added runtime package dependency. Unit and actual-WASM tests cover the classifier and parser; browser regressions cover local history, live controls, PGN review, and independent analysis toggles. The collection exporter decorates analysis pages with source links and versions local scripts/styles and engine assets using the frozen source revision.

## Research references

- [Chess.com classification model](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc): expected-points loss, including saturation in one-sided positions.
- [Lichess grading source](https://github.com/lichess-org/lila/blob/4a427ef69b93816aac87e0df59b44f38ea2e49fe/modules/tree/src/main/Advice.scala): winning-chance deltas and explicit mate-transition handling.
- [WintrChess classification source](https://github.com/WintrCat/wintrchess/blob/d145b20968955ca955cafe3fc3b51305f3bf41f9/shared/src/lib/reporter/classification/pointLoss.ts): expected-points loss and explicit mate rules; its public implementation is not a raw-centipawn classifier.

The screenshot regression starts from `r1bk3r/3p1ppp/p2Q1N2/2p4q/2B5/5N2/PP3PPP/R1B1R1K1 b - - 0 16`. Depth 22 finds Black's best defense loses in M3; `Qh6` permits `Qb6#`. Both previously collapsed to zero expected points. `Bxh6` also wins but is slower (M3).
