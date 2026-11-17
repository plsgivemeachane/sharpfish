# Design

## Source of truth
Active, 2026-11-10. Surfaces: collection homepage and exported play-page navigation.
Evidence: existing site/index.html, site/style.css, favicon.svg and branch differences.

## Brand
Sharpfish: thoughtful, playful chess experiments. Retain the knight mark and deep-sea palette.

## Product goals
Make every registered variant easy to find and play. Preserve branch-specific gameplay and presentation.

## Personas and jobs
Players exploring variants on desktop or mobile; maintainers publishing independent branches together.

## Information architecture
Root: introduction, variant cards, credits. /variants/<slug>/: independent playable sites with a return link.

## Design principles
Clear choices, short descriptions, no account or setup before play. Each card is one generous link.
Save games automatically. Keep grading and evaluation independent and optional. Grade objective advantage loss with logarithmic compression of large winning advantages, at full strength within one shared thinking budget (two seconds by default), then apply discoverability/naturalness with asymmetric forgiveness; display one final label rather than combined difficulty badges. Preserve recorded games when reviewing them.

## Visual language
Reuse navy #04162b, text #e3f0fa, teal accents and system typography from the play site.
Use restrained borders, rounded cards, ample spacing, and the existing favicon. No external fonts or decorative animation. Replay motion lasts about 220 ms and respects reduced motion.

## Components
Collection header, responsive card grid, source footer, exported navigation strip. Homepage CSS is separate from branch CSS.
Review includes a compact Game performance table above Moves, with White/Black accuracy and estimated Elo. Reuse the existing card, typography, side dots and muted helper text. Show partial coverage explicitly, retain computed metrics when grading is paused, and withhold Elo until the player's line is analyzed and contains five non-forced decisions. A small footer note says that estimated Elo is always a rough estimate for this single match only. Preserve the recorded-line summary while previewing an alternative. Review settings include a persistent Thinking time / move select (1, 2, 5, 10 or 30 seconds; default 2) for grading and evaluation. Registered variants use ordinary-chess analysis: ignore SCP and custom move restrictions, preserve actual replay snapshots, and grade each decision from its projected before-position. Positions or moves with no ordinary-chess interpretation show Unavailable without blocking later grades; performance remains provisional. Unknown custom variants remain replay-only.
History list, PGN paste/file input, readonly replay board, move list with labels, evaluation bar, grading progress/cancel, and review controls. Review opens with grading and evaluation enabled for supported games. Great/Brilliant has its own persistent switch. Every board rank and file has the same size; pieces use the same scale as the play board. Replay slides moved pieces, supports board flip, and allows right-drag arrows and square circles, with mouse drawing and left-click to clear. Alternative move previews Stockfish’s preferred move for grades other than Best/Excellent, using the position before the recorded move; the same button returns to the played move without editing history. Keep the move list near the board rather than below a long history list. The review page reuses the play page layout and components (brand header, unframed board with player rows that swap on flip, 8px card stack, 6px buttons, icon navigation row); the readable score sits in a pill on the top player row, never inside the thin eval bar. Ordinary labels: Best, Excellent, Good, OK, Inaccuracy, Mistake, Blunder, Disaster, Catastrophe; Great and Brilliant require separate evidence. Reuse existing tokens and pieces; no external fonts or dependencies.

## Accessibility
Semantic headings and landmarks, visible keyboard focus, descriptive links, high-contrast text, minimum 44px touch links.
Move grades include visible text rather than color alone. Replay supports keyboard controls; file/paste errors and analysis progress have accessible status messages. Respect reduced motion.
Play and review have a labelled Sound effects switch, on by default with one shared local preference across variants. Short local samples accompany completed moves, captures, checks, castling, promotions, explicit new games and game endings. Replay navigation sounds once per action; importing games, flipping, drawing, grading and evaluation updates stay silent. Audio unlocks after user interaction and never blocks play; muting stops pending and active sounds.

## Responsive behavior
Cards adapt from three columns to two and then one using available width. No horizontal overflow at 320px.

## Interaction states
Static homepage has no loading dependency. Native link navigation; server returns 404 for missing resources.
Play-page loading and errors remain owned by each branch.

## Content voice
Direct, brief, welcoming. Show variant names and rules without build or deployment details in the main flow.

## Implementation constraints
Plain HTML/CSS; no new frontend dependencies. Export whole branch sites. Check desktop and mobile in a real browser.

Move grades use concept-inspired metallic coins: grade-tinted beveled rims, saturated faces and bold contrasting symbols, with purple sparkle for Brilliant and distinct red symbols for Disaster/Catastrophe. OK uses a slate diamond. Reserve an icon slot before SAN and provide the grade name accessibly. Show the currently displayed move's icon centred on the top-right corner of its destination square without blocking board interaction. Transparent PNGs, SVG originals, and a sprite are exported in `site/badges/`.

## Open questions
None for the initial collection.
