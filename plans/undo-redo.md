# Plan: Undo / Redo

## Goal
Ctrl+Z / Ctrl+Shift+Z for two independent undo stacks.

## Why deferred
Requires infrastructure additions (history stacks) on top of completed refactor.

## Design: Two stacks

### 1. Edit undo (CSV snapshot stack)
- Every change to `csvText` (via `setCsvText`) pushes the previous snapshot onto a stack
- Stack limit: 50 snapshots
- Ctrl+Z (when not running, or when running but edit ring is active): pop and restore `csvText`
- Ctrl+Shift+Z: redo (push current onto redo stack before restoring)
- Clearing: redo stack clears on any new edit (standard behavior)
- NOTE: variable state is NOT in this stack (user confirmed)

Implementation:
```js
const editHistoryRef = useRef({ past: [], future: [] });

function pushEdit(prevCsv) {
  const h = editHistoryRef.current;
  h.past.push(prevCsv);
  if (h.past.length > 50) h.past.shift();
  h.future = [];
}

function undoEdit() {
  const h = editHistoryRef.current;
  if (!h.past.length) return;
  h.future.push(csvText); // current
  const prev = h.past.pop();
  setCsvText(prev); // triggers re-parse, no pushEdit call
}
```
The tricky part: `setCsvText` is called by both "real" edits and undo. Need a way to distinguish.
Use a `suppressHistoryRef` flag: when true, `setCsvText` calls do not push to history.

### 2. Clock correction undo (during run)
- Stack of `{ syncTime, syncPerf, frozenClock }` snapshots
- Pushed when: nudge() or onSyncEntry() is called during an active run
- Stack limit: 20
- Ctrl+Z when running: pop and restore engine timing state, call paintFrame
- Cleared on: Reset

## Keyboard handler
```js
if (e.ctrlKey && e.key === 'z') {
  if (eng.current.started && !eng.current.paused && clockCorrectionStack.length) {
    undoClockCorrection();
  } else {
    undoEdit();
  }
}
if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
  redoEdit();
}
```

## Call card variable persistence (extended plan)
Currently only note cards with sets get `pending` state. To also keep call cards alive when
their referenced variables are unresolved:
- In `stateOf` for `call` cards: if `c._tok` is true AND any referenced variable has `value === null`,
  extend the `now` state by up to 10 seconds past normal remain.
- This handles the case where the callout text needs a variable to be filled to display correctly.
- Implementation: track `_usedVars` on each cue (array of variable names referenced in text).
  During `buildCues`, populate `_usedVars` from TOKEN parsing (already done partially via TOKEN.exec).
- In stateOf: if in post-remain window and any `_usedVars` variable is null, return `pending`.
