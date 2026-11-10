---
name: new-variant
description: Make a new "Stockfish but <rule>" engine variant on its own branch, build it, prove it with self-play against the stock engine, and commit. Use when the user asks for a Stockfish variant, a fork with a new rule, or "Stockfish but X".
argument-hint: <the rule, e.g. "knights can't capture">
---

# New Stockfish variant

Make the variant described in `$ARGUMENTS`. If it is empty, ask for the rule
in one line before starting.

## Standing rules from the user (always apply)

1. **"Stockfish but X": the rule binds the engine only.** The human always
   plays normal chess. Their legal moves must equal stock Stockfish's in every
   position (`selfplay.js` checks this).
2. **Engine-only change.** Touch `src/` (plus docs/config if needed). Never edit
   `site/`: no hints, no status text, no styling. The site asks the engine which
   moves are legal, so rules work without JS changes. Site features are general
   features: they go on `main` and get cherry-picked into variant branches.
3. **Name:** set `EngineName` in `src/variant/config.h` to a short description
   of the rule (e.g. `"Alternating square colors"`). The site then shows
   "Stockfish variant (Alternating square colors)".
4. **No exemptions the user didn't ask for.** If the rule could leave the engine
   with no allowed move (in check, or at all), say so in the final message
   and offer an exemption. Don't add one silently. (The alternating-colors
   variant lifts its rule in check because the user asked for that.)
5. Commit on the variant branch when it works. Don't push. The remote is
   upstream `nmrugg/stockfish.js`.

## Steps

### 1. Branch

```bash
git switch main && git switch -c <short-kebab-slug-of-rule>
```

`main` is the template, with all shared site features. (`master` is upstream's
branch without the site: never base on it.)

### 2. Classify the rule and pick where it goes

Read `FORKING.md`, `src/variant/config.h` and `src/variant/hooks.h` first.
Every switch there defaults to stock and compiles out when off.

| Rule kind | Where |
| --- | --- |
| Ban castling / en passant / underpromotion / double step | the `Allow…` switches in `config.h` |
| Any other "this move is forbidden" judged from the current position alone | `move_allowed_custom()` in `hooks.h` + `EnableCustomRules = true` |
| Forbidden depending on **earlier moves** (alternate X, no piece twice in a row, ...) | state in `StateInfo` + Zobrist key (see "History-dependent rules") |
| Engine *prefers* or *avoids* something (not a hard rule) | `move_bias_cp()` / `eval_bonus_cp()` / `PieceValueTweakCp` |
| New pieces, drops, new win conditions, *extra* moves | Not supported by the hooks (they can only remove moves). Tell the user it needs `movegen.cpp`/`position.cpp`/`search.cpp` work and confirm before going deep. |

A new rule gets its own `constexpr` switch in `config.h`, with a comment saying
what it does and that it binds the engine only. Give it the stock value in
`src/variant/stock_config.h` too, or the eval-bar engine (`-DVARIANT_STOCK`)
won't compile. Add it to `HasRuleFilter` in `hooks.h`.

### 3. Bind the rule to the engine's side only

`main` doesn't know which side the engine plays, so add this (copy from
branch `alternating-colors`, commit `e11c90f1`):

```cpp
// src/variant/hooks.h, in the plumbing section
// The color the engine plays, set on every "go" (COLOR_NB = not known yet).
inline Color EngineSide = COLOR_NB;
```

```cpp
// src/engine.cpp: #include "variant/hooks.h", then at the top of Engine::go()
if constexpr (Variant::<YourSwitch>)
    Variant::EngineSide = pos.side_to_move();
```

and gate the rule on it inside `move_allowed()` / `move_allowed_custom()`:

```cpp
if (pos.side_to_move() == EngineSide && /* rule says no */) return false;
```

The search then models the opponent as a normal chess player. That's correct:
it plans against real replies.

### 4. History-dependent rules

If the rule depends on earlier moves (reference: `alternating-colors`, commit
`a92dc022`):

- Add the state to `StateInfo` in `src/position.h`, **before `key`** (that part
  is memcpy'd into the next state), plus an accessor and a setter.
- Update it in `Position::do_move` (`src/position.cpp`), before the TT prefetch.
- **Fold it into the Zobrist key**: add `Zobrist::<state>[...]` random keys, XOR
  them in `set_state` and on every change in `do_move`. Without this the
  transposition table and repetition detection mix up positions that differ
  only in the rule state.
- `go perft` rebuilds the position from FEN and loses the state. Pass it
  through `Engine::perft` → `Benchmark::perft` (`src/perft.h`) when
  `fen == pos.fen()`. Otherwise the site's legal-move list is wrong.
- Optionally print the state in `d` (the `operator<<` in `position.cpp`) for
  debugging. The site ignores unknown lines.

### 5. Search soundness

- Set `EnableNullMove = false` (e.g. `= <YourSwitch> == 0`) when the rule can
  make passing better than moving (zugzwang-prone rules, most move filters).
- If the engine may end up with no allowed move, the search scores that as
  mate/stalemate as usual (rule 4 above).

### 6. Build and prove it

```bash
./make-web.sh test
```

This expects `Engine: Stockfish variant (<EngineName>)` and `PASS`. The
"Legal moves" count is from White's view before any `go`, so it is normally
20 (the engine's side isn't known yet).

Then self-play against random legal player moves, with the engine on each side:

```bash
node .claude/skills/new-variant/selfplay.js --check <rule-check.js>
```

- With no `--check`, it verifies that the player's moves always equal stock
  chess, and that every engine move is legal chess and in the variant's own
  list.
- Write a small rule checker for the specific rule (copy
  `examples/alternating-colors.js`; it exports `check(ctx)` and returns `true`
  or an error string). Put it in the scratchpad, not the repo, unless the user
  wants it kept.
- Also test the rule's edge cases by hand with the engine directly, e.g.
  ```bash
  printf 'position startpos moves e2e4 e7e5\ngo movetime 300\nd\ngo perft 1\nquit\n' \
    | node site/engine/stockfish-*-lite-single.js
  ```
  Edge cases: castling (the king's destination is `to_sq` = the rook square
  internally; use G1/C1 if the rule is about where the king lands), en
  passant, promotion, being in check, no allowed move.

### 7. Commit

Commit the `src/` (and doc) changes on the variant branch, with a message
saying the rule and that it binds the engine only. Don't commit `site/engine/`
build output if git shows it. Don't push.

### 8. Report

Tell the user: the branch name, what the engine does now, how it was tested
(`selfplay.js` results for both colors, edge cases), anything you couldn't do
(e.g. no-move situations, rule 4), and how to play it: `python3 serve.py
--build`.
