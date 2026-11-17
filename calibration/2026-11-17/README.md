# Classic bot strength estimates — 2026-11-17

This release replaces the roster's nominal UCI Elo labels with conditional engine-strength estimates. Named bots retain their original UCI control, now at a fixed 100,000-node budget. Custom strength selects a fitted configuration for the requested target. Names, IDs, and artwork stay stable.

The figures are **not Chess.com or FIDE ratings**. They use historical Stash engine anchors from Stockfish's original UCI Elo calibration, measured here under different conditions. They cannot explain a particular human's result as an exact rating conversion. They are estimates on a documented local engine scale.

## Before and after

| Bot | Previous label | Revised estimate | Retained UCI_Elo |
| --- | ---: | ---: | ---: |
| Pebble | 0 | 250 | 0 |
| Noodle | 100 | 450 | 100 |
| Martin | 250 | 550 | 250 |
| Sunny | 400 | 650 | 400 |
| Milo | 550 | 700 | 550 |
| Juno | 700 | 800 | 700 |
| Tobi | 800 | 950 | 800 |
| Rosa | 900 | 1050 | 900 |
| Felix | 1000 | 1200 | 1000 |
| Nadia | 1100 | 1250 | 1100 |
| Omar | 1200 | 1250 | 1200 |
| Lena | 1350 | 1250 | 1350 |
| Kenji | 1450 | 1450 | 1450 |
| Priya | 1600 | 1600 | 1600 |
| Hugo | 1750 | 1800 | 1750 |
| Aria | 1900 | 1900 | 1900 |
| Viktor | 2050 | 1900 | 2050 |
| Mei | 2200 | 2100 | 2200 |
| Dario | 2350 | 2200 | 2350 |
| Sasha | 2500 | 2350 | 2500 |
| Stockfish | 2800 | 2850 | 2800 |

Revised labels round to the nearest 50. That is display resolution, not proven 50-point accuracy. Several bots correctly share a label when the data does not support separating them. Conditional opening/pair-cluster intervals are in [report.json](report.json); allow additional historical-anchor uncertainty of roughly ±100 Elo or more, native/WASM differences, and time-cap effects.

## Replacement configurations

[replacement-profiles.csv](replacement-profiles.csv) lists all 64 custom targets and their controls. For example, the new approximate **1800** profile uses `UCI_LimitStrength=true`, `UCI_Elo=1750`, `Skill Level=20`, and `go nodes 100000 movetime 2000`. The control number is not the displayed rating. Hugo is also now labeled approximately 1800 with that control.

Every rated profile uses 100,000 nodes as its maximum work, and the user's think-time selection as an emergency time cap. The beginner policy may intentionally finish earlier. A cap can truncate intended work on a slow device; the estimate is conditional on the work being completed. Full disables strength limiting, resets Skill Level to 20, and uses the selected time without a node cap.

The measured endpoint range is approximately **250–3100**. Targets outside it select the closest tested profile and display that approximate boundary. The current engine cannot substantiate distinct 0/50/100-strength opponents; no replacement configuration is claimed to achieve those numbers. Neighboring targets may share a configuration. Custom-rule variants are not calibrated by these ordinary-chess games.

## Evidence and limitations

- 2,400 unique complete games: 21 old named configurations, 20 additional raw controls, and four independently implemented Stash reference engines.
- Twenty opening positions, reversed-color pairs, one thread, 16 MB hash, and 100,000 nodes per move. These are normalized tests of the old controls, not measurements of every former browser/time setting.
- All games have legal terminal results. The initial 240-ply cutoff was not treated as a draw: 220 games continued from saved positions with full history and fresh engines/transposition tables. The longest final game took 654 plies.
- Six long continuations exposed Stash v8's fixed 256-entry UCI move-history buffer. Only that reference's history allocation was enlarged for those six games; search was unchanged. The patched binary hash is recorded. No unresolved engine failures or move-cap draws remain.
- Ratings use a logistic outcome model, fixed historical reference anchors, and a declared weak normal stabilizer (1200 Elo standard deviation) to keep sparse estimates finite. The bottom end has no independent low-rated anchor and is especially provisional.
- The custom curve uses a game-count-weighted monotonic fit followed by the closest measured configuration at each target. This smooths noise and avoids promising that raw UCI controls themselves form a perfectly calibrated ladder.
- A further frozen-mapping validation completed 736 games on eight new openings, with no errors or move-cap draws. Mean absolute target deviation was 61.3 Elo, and the largest was 153.1 Elo among supported targets. These are conditional point-estimate deviations, not guarantees; the published mapping was not refit to validation games. See [validation.json](validation.json) and [validation-games.jsonl.gz](validation-games.jsonl.gz).

The four historical anchors are Stash v8 1452.8, v12 1963.4, v17.0 2280.7, and v25.0 2744.0, from [Stockfish's original calibration commit](https://github.com/mcostalba/Stockfish/commit/a08b8d4e9711c20acedbfe17d618c3c384b339ec). Their old clock conditions and opponent pool differ from this experiment. Treat their absolute scale as approximate.

## Files and reproduction

- [report.json](report.json): per-bot estimates, intervals, controls, sample counts, and limitations.
- [ratings.csv](ratings.csv): concise before/after roster.
- [games.jsonl.gz](games.jsonl.gz): complete game records and PGNs, including continuation metadata and executable hashes.
- [profiles.json](profiles.json), [openings.json](openings.json), and [manifest.json](manifest.json): budgets, reference revisions, native/WASM/network hashes, and reference-only history repair.
- [mapping.json](mapping.json): measured control strengths, monotonic fit, and the 64 target choices.

Testing dependencies belong in a separate tools environment, not the application:

```sh
uv venv /tmp/sharpfish-calibration-tools
uv pip install --python /tmp/sharpfish-calibration-tools/bin/python python-chess numpy scipy
```

Build this repository's original measured revision with `make -C src build ARCH=x86-64-avx2 LITE_NET=yes`, using an isolated source/build directory. Build the pinned Stash references listed in the manifest, and replace the temporary command paths in a copy of `profiles.json` with those local executables. The run metadata preserves the exact original paths for provenance, not as a portable installation recipe. Preserve `nodes`, hash, threads, and UCI controls.

Use `scripts/calibrate-bots.py run --profiles ... --schedule ... --openings ... --output ... --jobs 8 --max-plies 1000`. Schedules contain `white`, `black`, `opening`, and a unique `schedule_id`. Use the recorded game opponents/openings to reconstruct the schedule. Saved capped games may be continued using `initialPgn`; do not fit truncated games as draws.

To reproduce the published fit from the saved complete results:

```sh
gzip -dc calibration/2026-11-17/games.jsonl.gz > /tmp/sharpfish-games.jsonl
/tmp/sharpfish-calibration-tools/bin/python scripts/calibrate-bots.py fit \
  --profiles calibration/2026-11-17/profiles.json \
  --results /tmp/sharpfish-games.jsonl --output /tmp/sharpfish-fit.json
```

No production deployment is included. The engine's C++ search and NNUE are unchanged; this update changes labels, frontend profile selection, and testing/reporting tooling.
