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

## Visual language
Reuse navy #04162b, text #e3f0fa, teal accents and system typography from the play site.
Use restrained borders, rounded cards, ample spacing, and the existing favicon. No external fonts or animation.

## Components
Collection header, responsive card grid, source footer, exported navigation strip. Homepage CSS is separate from branch CSS.

## Accessibility
Semantic headings and landmarks, visible keyboard focus, descriptive links, high-contrast text, minimum 44px touch links.

## Responsive behavior
Cards adapt from three columns to two and then one using available width. No horizontal overflow at 320px.

## Interaction states
Static homepage has no loading dependency. Native link navigation; server returns 404 for missing resources.
Play-page loading and errors remain owned by each branch.

## Content voice
Direct, brief, welcoming. Show variant names and rules without build or deployment details in the main flow.

## Implementation constraints
Plain HTML/CSS; no new frontend dependencies. Export whole branch sites. Check desktop and mobile in a real browser.

## Open questions
None for the initial collection.
