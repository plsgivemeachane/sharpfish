# Design

## Source of truth
Active, 2026-11-17. Surfaces: collection homepage, play pages, local history, and PGN analysis.
Evidence: existing site/index.html, site/style.css, favicon.svg, branch differences, and the approved PGN-analysis plan.

## Brand
Sharpfish: thoughtful, playful chess experiments. Retain the knight mark and deep-sea palette.

## Product goals
Make every registered variant easy to find and play. Preserve branch-specific gameplay and presentation.
Let players revisit their last 50 locally saved games, import PGN, and optionally grade/evaluate moves during play or review. Show one human-oriented quality label per move. No account or cloud synchronization.

## Personas and jobs
Players exploring variants on desktop or mobile; maintainers publishing independent branches together.
Players learning from their own games need accessible replay, independent grading/evaluation controls, and clear progress while the browser engine works.

## Information architecture
Root: introduction, variant cards, credits. /variants/<slug>/: independent playable sites with a return link.
Each integrated branch has analysis.html for PGN import and saved-game review; ?game=<id> opens one saved record. Classic combines standard chess and the former Elo ladder, including its full bot selector. The homepage links to Classic's analysis page; legacy Elo ladder URLs redirect to Classic. Other variants retain their own rules and saved replay state.

## Design principles
Clear choices, short descriptions, no account or setup before play. Each card is one generous link.
Save games automatically. Keep grading and evaluation independent and optional. Grade with discoverability/naturalness and asymmetric forgiveness internally; display one final label rather than combined difficulty badges. Preserve recorded games when reviewing them.

## Visual language
Reuse navy #04162b, text #e3f0fa, teal accents and system typography from the play site.
Use restrained borders, rounded cards, ample spacing, and the existing favicon. No external fonts or animation.

## Components
Collection header, responsive card grid, source footer, exported navigation strip. Homepage CSS is separate from branch CSS.
History list, PGN paste/file input, readonly replay board, move list with labels, evaluation bar, grading progress/cancel, and review controls. Ordinary labels: Best, Excellent, Good, OK, Inaccuracy, Mistake, Blunder; Great and Brilliant require separate evidence. Reuse existing tokens and pieces; no external fonts or dependencies.

## Accessibility
Semantic headings and landmarks, visible keyboard focus, descriptive links, high-contrast text, minimum 44px touch links.
Move grades include visible text rather than color alone. Replay supports keyboard controls; file/paste errors and analysis progress have accessible status messages. Respect reduced motion.

## Responsive behavior
Cards adapt from three columns to two and then one using available width. No horizontal overflow at 320px.
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

## Open questions
Difficulty heuristics are project-defined and require continued calibration against human examples; do not claim Chess.com parity or calibrated human Elo accuracy. No blocking design questions for the agreed implementation.
