Progress: Rename now updates named relative `.ts` imports that resolve to the target node and its node directory. Other direct-reference forms still cause refusal. Rollback now attempts each independent recovery step after an error, retains the recovery directory, and reports the errors. The CLI contract test checks aliased and unaliased direct imports, graph identity, and a resolved graph import. The rollback test checks the concurrent replacement, restoration of an independent source, and retention of the original source in recovery.

## Evidence

`FORCE_COLOR=0 node --test --test-name-pattern='protected deletion|protected rename' test/cli.test.mjs`: 45 passed. Independent read-only reviews found the remaining acceptance gaps below and no clear test surplus. The graph identity test was extended after the review and the focused suite passed again.

REFACTOR: Shared the named-import edit for graph and direct imports. Kept the existing contract tests and extended them for the new behaviors.

## Proposed Action

Keep this issue in progress. The CLI does not establish whether affected files have unsaved buffers in other editors. Multi-file installation and recovery do not establish an unchanged project after a crash, concurrent write, or recovery failure. Direct imports other than the supported form and indirect references are not fully updated or proved complete. Establish solutions and tests for these requirements before completion; do not treat caller-reported buffers or retained recovery files as proof of the full contract.