# Plan: View Clock (separate from Playback Clock)

## Goal
A separate "view cursor" that controls what both panels scroll to, independent of the
playback clock. Diverges when the user scrolls, resets when playback resumes or is nudged.

## Why deferred
The single-click select / double-click seek distinction (already implemented) addresses the
most common accidental-seek case. The full view clock is a larger architectural change.

## Design
- `viewClock` ref (not state — no re-renders needed)
- `viewClock.current = eng.current frozenClock` initially; tracks playback when running
- Mousewheel on rendered timeline (unshifted) → moves `viewClock`, scrolls both panels to match
  - Does NOT seek the playback clock
- Playback clock changes (nudge, Sync, Phase GO, Resume) → `viewClock` snaps to playback clock
- `⟲ View` button in header: resets `viewClock` to current playback clock, re-centers panels
  - Button grayed out when viewClock === playbackClock (within epsilon)

## Affected code
- `paintFrame` currently auto-scrolls deck when `lastTopActive` changes. With view clock,
  the deck scrolls to `viewClock` position instead when view != playback.
- `scrollDeckToCard` and `scrollTimelineToRow` need to accept a viewClock override
- Mousewheel in Timeline.jsx currently calls `onNudge` (nudges playback clock with Shift).
  Unshifted wheel should call a new `onViewScroll(delta)` callback that moves viewClock.
- The rendered timeline row list's visual position (`rlist` scroll) should follow viewClock,
  not paintFrame's `lastRenderCur` tracking.

## Steps
1. Add `viewClockRef` to App.jsx
2. Add `onViewScroll` callback, adjusts `viewClockRef` and calls `scrollBothToViewClock()`
3. Add `scrollBothToViewClock()`: scrolls deck and timeline list to viewClock position
4. Modify `togglePause`, `nudge`, `goRelease`, `onSyncEntry` to reset viewClock
5. Add "⟲ View" button to Header that calls `resetViewClock()`
6. Change Timeline.jsx wheel handler: unshifted → viewScroll, Shift → nudge (already in place)
7. Stop deck from auto-scrolling to `lastTopActive` when viewClock != playbackClock
