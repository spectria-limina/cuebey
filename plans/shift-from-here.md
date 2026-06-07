# Plan: Shift From Here (bulk timeline offset)

## Goal
Adjust all cues from a given position forward by a fixed time offset. Essential when an entire
section of the timeline was discovered to be mistimed.

## Why deferred
Rarely-needed operation; can be worked around manually. Needs UI to trigger.

## Design

### UI
A "Shift ▸" button in the rendered timeline header (beside "Close All"), visible only when:
- The rendered tab is active
- The engine is not actively running (started && !paused = hidden, or Lock mode = hidden)

Clicking opens an inline panel below the timeline header:

```
┌─────────────────────────────────────────────────────┐
│ Shift from:  [1:23.4]  all cues by  [+1.0] s        │
│                                    [Apply]  [Cancel] │
└─────────────────────────────────────────────────────┘
```

- **From:** defaults to current clock time (or selectedIdx cue time if something is selected).
  Editable time field (H:MM:SS format). User can type a different time.
- **Amount:** signed seconds field. Positive = shift later; negative = shift earlier.
  Small +/- step buttons (±0.1s, ±1s) next to the field.
- **Apply:** modifies `raw` on all cues with `effTime >= fromTime` by `+= amount`, then calls
  `setCsvText(serializeCSV(cuesRef.current))`. This is a single edit undo action.
- **Cancel:** closes panel, no changes.

### Implementation
```js
function shiftFrom(fromSec, deltaSec) {
  cuesRef.current.forEach(c => {
    if (c.effTime >= fromSec) {
      c.raw += deltaSec;
      c.effTime += deltaSec;
    }
  });
  setCsvText(serializeCSV(cuesRef.current));
}
```

When undo/redo is implemented, this should push to edit history before applying.

### State
- `shiftPanelOpen: bool` React state in Timeline.jsx
- `shiftFrom: string` (time field text, initialized to currentClock)
- `shiftAmount: string` (amount field text, initialized to "0.0")
- Panel closes automatically after Apply or Cancel

### Integration with Lock mode
Shift is disabled when `locked` is true — structural edit.

### Keyboard shortcut
None by default. Too dangerous to accidentally trigger.
