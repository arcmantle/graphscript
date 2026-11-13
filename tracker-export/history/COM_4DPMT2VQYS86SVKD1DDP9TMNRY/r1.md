Rename now refuses caller-reported unsaved relevant package manifests before source changes. The shared path checks also refuse unsaved source and manifest aliases, unresolved symbolic links, and case-variant manifest names. The same alias checks apply to deletion.

## Evidence

The new public API tests failed before each fix and passed after it. The focused protected rename and deletion suite passed 57 tests. The final five unsaved-path tests passed. A final independent read-only review found no material findings and no material test surplus.

REFACTOR: Shared unsaved-path resolution and manifest tracking between rename and deletion. No further refactor was justified for this slice.

## Proposed Action

Keep this issue in progress. The CLI cannot detect unsaved buffers in other editors. Crash and concurrent-recovery atomicity is not established. Some resolved reference forms are refused or not proved complete. VS Code rename is not verified.