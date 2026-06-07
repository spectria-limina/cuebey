# Plan: Sticky Variable Card Zone

## Goal
When a `note` card with variable sets enters `now`/`pending` state, it pins to a fixed zone
at the top of the deck (above the scrolling card stream), staying visible even as the user
scrolls down through later cards.

## Why deferred
Currently implemented: `note` cards enter `pending` state and stay in-stream (don't auto-expire
until conditions are met). This is the "less work" version. The sticky zone is the "more work"
version with better visibility.

## Design
- Two DOM zones inside `.center-col` (below the video panel):
  - `#deck-sticky` — fixed height zone (max ~30% deck height), non-scrolling, internal scroll
    if many accumulate. Contains `note` cards in `standby`/`warn`/`now`/`pending` state.
  - `#deck` — existing scrolling deck. All non-note cards, plus note cards still in `gray` state.

- When a note card's effTime approaches (enters `standby`):
  - Card animates from deck stream up to sticky zone (height-collapse in stream, height-expand in sticky)
  - Ref registration needs to work for both zones

- When a note card retires (skipped or conditions met):
  - Card animates out of sticky zone (height collapse)

## Implementation complexity
- Need two card-deck zones with separate scroll management
- `registerCard` refs need to handle cards moving between zones
- `paintFrame` already drives all card state via refs — slot class still controls visibility
- The actual DOM position (sticky vs stream) is driven by React state, not paintFrame
- A new piece of state: `stickyIdxSet` — set of note card indices currently in sticky zone
- This set is updated from `paintFrame` or a separate effect watching card states
- Big risk: the ref-based card system (cardRefs) assumes cards stay in one place in the DOM

## Steps
1. Add `#deck-sticky` div above `#deck` in the center column
2. Add `stickyIdx` React state (Set of indices)
3. In the animation loop, when a note card enters standby/ready state, add it to stickyIdx
4. When it retires, remove it from stickyIdx (with animation delay)
5. Deck renders note cards in stickyIdx inside #deck-sticky, all others in #deck
6. Card refs still work since each card has a unique index key
7. Update `scrollDeckToCard` to check both zones
