# Design

## Source of truth
Active, 2026-11-19. Surfaces: Atomic Chess play page, local history, and Atomic PGN analysis, alongside the shared collection design.
Evidence: existing site/index.html, site/style.css, favicon.svg, branch differences, and the approved PGN-analysis plan.
Atomic decisions are approved in the current implementation plan: extend our C++ engine, provide evaluation/basic grading, and exclude Great/Brilliant, accuracy and estimated Elo.

## Brand
Sharpfish: thoughtful, playful chess experiments. Retain the knight mark and deep-sea palette.

## Product goals
Make every registered variant easy to find and play. Preserve branch-specific gameplay and presentation.
Let players revisit their last 50 locally saved games, import PGN, and optionally grade/evaluate moves during play or review. Show one human-oriented quality label per move. No account or cloud synchronization.

## Personas and jobs
Players exploring variants on desktop or mobile; maintainers publishing independent branches together.
Players learning from their own games need accessible replay, independent grading/evaluation controls, and clear progress while the browser engine works.

## Information architecture
Root: introduction, Game analysis and variant cards, credits. Analysis is the first full-size card in the same grid as the variants, with equal prominence. /variants/<slug>/: independent playable sites with a return link.
Each integrated branch has analysis.html for PGN import and saved-game review; ?game=<id> opens one saved record. Classic combines standard chess and the former Elo ladder, including its full bot selector. The homepage links to Classic's analysis page; legacy Elo ladder URLs redirect to Classic. Other variants retain their own rules and saved replay state.

## Design principles
Clear choices, short descriptions, no account or setup before play. Each card is one generous link.
Save games automatically. Keep grading and evaluation independent and optional. Grade objective advantage loss with logarithmic compression of large winning advantages, at full strength within one shared thinking budget (two seconds by default), then apply discoverability/naturalness with asymmetric forgiveness; display one final label rather than combined difficulty badges. Preserve recorded games when reviewing them.

## Visual language
Reuse navy #04162b, text #e3f0fa, teal accents and system typography from the play site.
Use restrained borders, rounded cards, ample spacing, and the existing favicon. No external fonts or decorative animation. Replay motion lasts about 220 ms and respects reduced motion.

## Components
Atomic retains the shared layout and pieces. A compact rules card explains blast removals, adjacent pawn immunity, king safety, connected kings and en passant. Capture previews outline the blast radius in amber/red, mark removals with × and surviving pawns with a shield; completed explosions briefly outline the blast area without screen shake or particles. Touch uses drag previews without extra confirmation taps. Focused legal destinations offer the same preview. Accessible status text distinguishes explosion wins from checkmate and draws. The Atomic engine owns move legality and results; visual projection never authorizes a move.
Atomic play and review use separate full-strength analysis Workers running our extended engine. Evaluation and basic grading have independent controls; Atomic PGN import/export and legal alternatives preserve the recorded game. Hide Great/Brilliant controls and performance summaries containing accuracy/estimated Elo, and strip excluded fields from Atomic analysis. Grades are provisional evaluator judgments, not human strength measurements. Opponent artwork remains; descriptive difficulty tiers replace Classic's numeric ratings.
Collection header (brand + Variants/Analysis/Source links), hero with Play Classic / Browse variants actions and a pure-CSS tilted board carrying the knight mark, responsive card grid (Analysis first, registered variants, then a dashed "Make a variant" card linking to FORKING.md), source footer. The exported navigation strip carries its own inline styles so it renders identically on every branch. Homepage CSS is separate from branch CSS.
Play page: three areas placed with grid-template-areas — opponent & settings | board | game (status, moves with docked replay controls, new game & tools). Three columns at 1340px+, board beside a stacked panel down to 861px, one column below. Card titles are small uppercase muted labels; buttons are 40px with 8px radius; settings use switch-styled native checkboxes; premove/arrow help lives in a collapsed Tips card. Do not use the class name `ghost` for UI: it is the drag-preview piece.
Review includes a compact Game performance table above Moves, with White/Black accuracy and estimated Elo. Reuse the existing card, typography, side dots and muted helper text. Show partial coverage explicitly, retain computed metrics when grading is paused, and withhold Elo until the player's line is analyzed and contains five non-forced decisions. A small footer note says that estimated Elo is always a rough estimate for this single match only. Preserve the recorded-line summary while previewing an alternative. Review settings include a persistent Thinking time / move select (1, 2, 5, 10 or 30 seconds; default 2) for grading and evaluation. Existing non-Atomic variants use ordinary-chess analysis: ignore SCP and custom move restrictions, preserve actual replay snapshots, and grade each decision from its projected before-position. Positions or moves with no ordinary-chess interpretation show Unavailable without blocking later grades; performance remains provisional. Unknown custom variants remain replay-only.
History list, PGN paste/file input, readonly replay board, move list with labels, evaluation bar, grading progress/cancel, and review controls. Review opens with grading and evaluation enabled for supported games. Great/Brilliant has its own persistent switch. Every board rank and file has the same size; pieces use the same scale as the play board. Replay slides moved pieces, supports board flip, and allows right-drag arrows and square circles, with mouse drawing and left-click to clear. Alternative move previews Stockfish’s preferred move for grades other than Best/Excellent, using the position before the recorded move; the same button returns to the played move without editing history. Keep the move list near the board rather than below a long history list. The review page reuses the play page layout and components (brand header, unframed board with player rows that swap on flip, 8px card stack, 6px buttons, icon navigation row); the readable score sits in a pill on the top player row, never inside the thin eval bar. Ordinary labels: Best, Excellent, Good, OK, Inaccuracy, Mistake, Blunder, Disaster, Catastrophe; Great and Brilliant require separate evidence. Reuse existing tokens and pieces; no external fonts or dependencies.

## Accessibility
Semantic headings and landmarks, visible keyboard focus, descriptive links, high-contrast text, minimum 44px touch links.
Move grades include visible text rather than color alone. Replay supports keyboard controls; file/paste errors and analysis progress have accessible status messages. Respect reduced motion.
Play and review have a labelled Sound effects switch, on by default with one shared local preference across variants. Short local samples accompany completed moves, captures, checks, castling, promotions, explicit new games and game endings. Replay navigation sounds once per action; importing games, flipping, drawing, grading and evaluation updates stay silent. Audio unlocks after user interaction and never blocks play; muting stops pending and active sounds.

## Responsive behavior
The collection uses three equal card columns, two at 980px and below, one at 650px and below. No horizontal overflow at 320px.
Analysis uses a board alongside review controls on wide screens and stacks them on narrow screens. Long PGN/header content wraps or scrolls within its own control.

## Interaction states
Static homepage has no loading dependency. Native link navigation; server returns 404 for missing resources.
Play-page loading and errors remain owned by each branch.
History has empty/loading/save-failure states. PGN validates before replacing a displayed game. Engine grading can be pending, canceled, failed, or complete; keep completed evidence and never manufacture a final grade on failure. History review never starts a bot. Browser site-data deletion removes local history.

## Content voice
Direct, brief, welcoming. Show variant names and rules without build or deployment details in the main flow.

## Implementation constraints
Plain HTML/CSS; no new frontend dependencies. Export whole branch sites. Check desktop and mobile in a real browser.
Use native IndexedDB for bounded local history and Web Workers for analysis. Keep live play/premoves responsive. Version local JS/CSS and stock-engine paths from frozen source revisions. Test storage retention, replay, independent toggles, stale-job rejection, and user-provided metadata escaping.

Move grades use concept-inspired metallic coins: grade-tinted beveled rims, saturated faces and bold contrasting symbols, with purple sparkle for Brilliant and distinct red symbols for Disaster/Catastrophe. OK uses a slate diamond. Reserve an icon slot before SAN and provide the grade name accessibly. Show the currently displayed move's icon centred on the top-right corner of its destination square without blocking board interaction. Transparent PNGs, SVG originals, and a sprite are exported in `site/badges/`.

## Open questions
Difficulty heuristics are project-defined and require continued calibration against human examples; do not claim Chess.com parity or calibrated human Elo accuracy. No blocking design questions for the agreed implementation.
