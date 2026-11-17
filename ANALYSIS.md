# Game review and local history

Open **History / Analyze PGN** from a play page, or use the analysis link on the collection homepage. Paste a standard-chess PGN or open one of the latest 50 games saved in this browser. Grading and evaluation are independent controls, available during supported live games and saved-game review. Existing games played before local history was introduced cannot be recovered automatically.

Games save after accepted moves and takebacks, including unfinished games and bot matches. Reviewing or grading an existing game does not create another game or make it newer. The 51st distinct game removes the oldest record. History belongs to the browser origin: another browser/device has different history, and clearing site data removes it.

## Grading policy

The ordinary ladder is **Best → Excellent → Good → OK → Inaccuracy → Mistake → Blunder → Disaster → Catastrophe**. Each move displays one final label. Great and Brilliant require separate contextual evidence.

Full-strength Stockfish (Skill Level 20, strength limiting disabled) compares the played move with the best alternative within one shared thinking budget per grade: **2000 ms by default**, configurable in review. There is no minimum depth and no depth-escalating retry loop. All root, reply, difficulty and sacrifice searches share that budget; optional evidence is skipped when time is exhausted. A failed attempt may retry once with a fresh worker and the same budget. The actual completed depth is retained as diagnostic metadata. The playing bot's strength never limits the analysis worker. When the played move is outside the initial top alternatives, it and the strongest candidate are compared in the same completed MultiPV iteration to avoid inconsistent independent scores.

**Great / Brilliant** can be switched off independently of ordinary move grading, in live play and review. This skips special-grade verification and persists the preference locally. Cached grades include the time budget and special-grade setting. Live grading prioritizes the newest move, then fills the older backlog. Loading the engine and waiting behind another grade are separate from its thinking budget; a stalled grading worker is terminated at the deadline with a small transport allowance.

Brilliant requires a Best or Excellent piece offer, a mover who is not in check, and a best available score of at least −50cp for the mover. The mover must not already be more than +500cp ahead in actual material; the second-best move's evaluation is not an exclusion. Every legal acceptance of the offered piece must be searched and remain sound (at least −50cp, no more than 50 quality points below the played score on the same `U(x)` scale used for ordinary grades, and preserving a forced mate). The absolute −50cp floor stays uncompressed. At least one acceptance must cost ≥150cp of material relative to before the move, measured **before** the mover's response. This includes rook-for-minor exchanges and clearance sacrifices that immediately win a queen back; equal trades do not qualify. `offeredMaterialChange` records that temporary cost, while `materialChange` retains the change after the immediate response. Classifier 1.5.0 invalidates previously cached grades. Great's only-good-move rules are unchanged.

The default objective model is **centipawn loss**, normalized to the mover: `(bestWhiteCp - playedWhiteCp) × (White ? 1 : -1)`. One advantage point is 100 centipawns. There are no player ratings, win-probability curves, or material-loss penalties in this classification. A sound queen sacrifice remains good when its searched score is close to the best move.

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

These are Sharpfish policy thresholds, not published Chess.com, Lichess, or WintrChess thresholds. Raw score loss remains recorded. For CP positions, scores from the mover's perspective use `U(x) = x` up to +300cp and `U(x) = 300 + 100 × ln(1 + (x - 300) / 100)` above that. Objective quality loss is `max(0, U(best) - U(played))`. This scale and its slope are continuous at +3 points. It compresses the surplus of an already large win: +24 to +12 is about 79cp of quality loss (Inaccuracy), and the reported +30.98 to +18.19 Qf3 is about 58cp (OK), before difficulty adjustments. +24 to 0 still loses about 609cp of quality (Disaster). Losing positions stay linear: −6 to −15 remains a nine-point loss. Mate outcomes retain their separate rules. Version 1.3.0 invalidates earlier cached grades.

Review has a persistent **Thinking time / move** setting: 1, 2 (default), 5, 10 or 30 seconds. It controls both grading and the eval bar. The grading budget is shared across its searches; main/root/reply search allocations scale with the selected time, allowing greater search depth. Diagnostic depth-4/depth-7 probes remain bounded for difficulty comparison. Changing time cancels old jobs, restarts enabled analysis and rejects cached grades from a different budget. Live play keeps the two-second default.

Mate is a separate ordered outcome and is never converted into a large invented centipawn number. Preserving the best known forced-mate distance can earn Best; accelerating the opponent's mate is an error, and delaying one's own forced mate earns Good. Missing a forced win is graded according to the remaining advantage. **Catastrophe** requires both the root played-move search and an independent time-bounded search of the resulting position to confirm opponent mate in 1–5, newly allowed or faster than the best defense. M6 does not qualify. Practical ease cannot manufacture this tier without mate evidence. The recorded `mateChange` and `mateEvidence` explain the comparison; numerical loss fields are null for mate transitions.

The internal objective grade is then adjusted for human difficulty:

- **Discoverability:** how readily a limited search recognizes the punishment. Diagnostic searches capped at depths 4 and 7 and 20/40 ms are compared with the deeper time-bounded reply search; these diagnostic scores do not determine the objective grade.
- **Naturalness:** whether the verified reply is a plausible human candidate in context, rather than a counterintuitive idea.
- **Delayed hidden consequence:** supports forgiveness when the point takes time to become apparent. A long, obvious forcing line does not qualify merely because it is long.

The number of punishing replies is not a difficulty input. Upgrades are easier to earn than downgrades. A move can improve up to two steps; a downgrade needs strong agreement that the error is easy to recognize and is limited to one step. Best remains reserved for objectively best or effectively tied moves. A difficulty adjustment alone cannot earn Great or Brilliant.

This is a Sharpfish heuristic. Advantage-loss bands and shallow-search recognition require calibration against human examples; they do not estimate player Elo. Engine evaluations are search-dependent and not literal material counts. Results depend on engine version, analysis budget, and classifier version; incompatible cached results need recalculation. Search depth varies with the position and device. Optional special-grade or difficulty evidence may be unavailable within two seconds; missing evidence never manufactures a special label or difficulty adjustment. Browser grading can lag rapid play, and a pending or interrupted search must not be shown as a completed grade.

The current move's grade also appears centred on the top-right corner of its destination square, overlapping the neighbouring squares in play and replay. Move lists reserve an icon slot before SAN so receiving a grade does not shift move text. Badges are original metallic coin artwork exported as transparent PNGs and scalable SVGs.

The **Alternative move** button is available for a selected graded move other than Best or Excellent. It previews the cached engine recommendation from the preceding position, shows a green arrow and evaluates that alternative. Missing, illegal or identical recommendations are also unavailable. Select **Played move** or navigate to return to the recorded line. Previewing never changes the saved moves, result or PGN. Mouse arrows and circles remain available; left-click clears drawings.

Evaluation cancels obsolete searches during rapid replay and creates a fresh worker when a cached analysis page is restored through browser history. Pending evaluation can be stopped before its search begins.

## Accuracy and single-match Elo

Review shows White and Black accuracy and estimated Elo, calculated from compatible engine grades without more engine searches. Accuracy is provisional until the player's complete line is analyzed; coverage is displayed. Turning off grading retains available results. Alternative previews never change the recorded game's summary.

Performance model v1 is an explicit Sharpfish heuristic, not CAPS2, a Lichess score or a calibrated human Elo prediction:

- Effective move loss is `min(1000, qualityLossCp)`; `qualityLossCp` uses the logarithmic winning-advantage scale above. Per-move accuracy is `100 × exp(-loss / 200)`, averaged per player. Human difficulty adjustments, Great and Brilliant do not alter this number.
- Mate transitions have no literal CP loss. For performance only, their objective tiers use fixed loss proxies: Best 0, Good 40, Inaccuracy 100, Mistake 180, Blunder 350, Disaster 700, Catastrophe 1000. Missing scores never count as perfect moves.
- Elo uses average effective loss `L` over positions with more than one legal move. The rule is `clamp(2800 - 700 × ln(1 + L / 10), 100, 2800)`, rounded to the nearest 50. At least five such decisions and complete analysis of that player's moves are required. Forced moves cannot supply rating evidence. The scale and constants are policy choices, not a fit to a rated dataset.
- The footer says: “Estimated Elo is always a rough estimate for this single match only.” These estimates are independent of account ratings and do not accumulate into a player rating.

A failed live grade is retried once on a fresh worker after new moves are handled; a persistent failure is reported instead of looping. Failed attempts are keyed to the actual move sequence, so undoing and changing a move cannot inherit a failure at the same index. A completed grade carried across a concurrent move/save is delivered to the newer UI revision and saved again, preventing a permanent blank despite the queue considering it complete. Review also retries a failed search once before pausing with an error.

## Variant boundary

Classic includes the former Elo ladder; legacy URLs redirect to Classic. Classic, Sufferfish, Alternating Colors and SCP-096 all support ordinary-chess grading and evaluation. Analysis always uses the full-strength stock Stockfish worker, independently of the playing variant's engine or bot strength.

For Alternating Colors and SCP-096, each decision starts from its own saved before-position. The analysis adapter removes SCP's `*` marker, preserves already-eaten pieces as absent, repairs castling/en-passant metadata and asks Stockfish for fresh ordinary legal moves. The recorded move is graded from that position; its hypothetical reply line ignores subsequent automatic SCP eating and custom move restrictions. Evaluation of a replay position uses that actual snapshot minus SCP. The original snapshots, SCP events and game result remain unchanged in replay. Alternatives use ordinary legality and the projected before-position, so a recommendation may differ from a move the variant permits.

A missing king, a revealed check on the non-moving king, or a move legal only under custom rules may have no ordinary-chess interpretation. Such moves show **Unavailable** and grading continues with later decisions; invalid FENs never reach Stockfish. Unavailable positions hide the eval bar instead of retaining an unrelated score. Accuracy shows incomplete coverage and withholds Elo when a decision is unavailable. Performance uses the side and number of ordinary legal choices from the actual grading search. Unknown variants without an adapter remain replay-only.

Classifier 1.4.0 invalidates old caches. Variant grade fingerprints include the actual before-snapshot, preventing identical UCI prefixes with different SCP events from sharing results. Completed unavailable decisions are also cached to avoid endless retries.

## Maintenance

The browser modules have no added runtime package dependency. Unit and actual-WASM tests cover the classifier and parser; browser regressions cover local history, live controls, PGN review, and independent analysis toggles. The collection exporter decorates analysis pages with source links and versions local scripts/styles, badge images and engine assets using the frozen source revision.

## Research references

- [Chess.com classification model](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc): expected-points loss, including saturation in one-sided positions.
- [Lichess grading source](https://github.com/lichess-org/lila/blob/4a427ef69b93816aac87e0df59b44f38ea2e49fe/modules/tree/src/main/Advice.scala): winning-chance deltas and explicit mate-transition handling.
- [WintrChess classification source](https://github.com/WintrCat/wintrchess/blob/d145b20968955ca955cafe3fc3b51305f3bf41f9/shared/src/lib/reporter/classification/pointLoss.ts): expected-points loss and explicit mate rules; its public implementation is not a raw-centipawn classifier.

The screenshot regression starts from `r1bk3r/3p1ppp/p2Q1N2/2p4q/2B5/5N2/PP3PPP/R1B1R1K1 b - - 0 16`. Depth 22 finds Black's best defense loses in M3; `Qh6` permits `Qb6#`. Both previously collapsed to zero expected points. `Bxh6` also wins but is slower (M3).
