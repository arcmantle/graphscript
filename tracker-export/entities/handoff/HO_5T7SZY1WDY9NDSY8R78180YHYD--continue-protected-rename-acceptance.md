## Focus

Continue ISS_0JEH25FY6V8BQV5K29P1Y7C6D4. Preserve all uncommitted changes. Do not change the acceptance contract without approval.

## Current State

Read progress comment COM_0QWSH6SREE80TSCAS99FCRRMGX and the current source and tests. The final focused protected-edit suite passed 45 tests. A read-only review found the remaining acceptance gaps and no clear test surplus. The graph identity test was extended after that review, and the focused suite passed again. Most project files are untracked; do not rely only on Git diff.

## Tracked Scope

- ISS_0JEH25FY6V8BQV5K29P1Y7C6D4, Provide protected CLI rename with complete reference updates, in progress.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.
- US_1CPMQXGH808XGR2NMTH4270ZH8, Rename nodes without losing identity or references, in progress.
- ISS_3TZEBX21PT964SW1E8VN3BDJEC, Resolve graph imports with unique names and stable IDs, done; it blocks the rename issue.
- ISS_2AB28Y1FHM86RSNVAGW79G5GQ2, Expose protected rename through VS Code, todo; the rename issue blocks it.

## Blockers

- The CLI cannot establish whether affected files have unsaved buffers in other editors.
- Multi-file installation and recovery do not establish an unchanged project after a crash, concurrent write, or recovery failure.
- Other direct and indirect resolved reference forms are not fully updated or proved complete. Some forms are refused.

## Relevant Files

- `src/protected-edit.js`
- `src/cli.js`
- `src/graph.js`
- `test/cli.test.mjs`

## Suggested Skills

- `tdd`
- `implement`