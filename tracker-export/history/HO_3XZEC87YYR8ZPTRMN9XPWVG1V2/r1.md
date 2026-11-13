## Focus

Complete ISS_7K43WJQCX792WR155NSCGZ9JXC without changing its requirements. Preserve all uncommitted changes. Check for an active worker before editing.

## Current State

Deletion rollback now relies on directory cleanup to remove the staged link after the target is restored. The existing removal-failure test now injects repeated staged unlink failures. A table-driven test checks rollback-link and cleanup failures, retained source data, and the reported recovery directory.

The initial repeated-unlink test failed because a staging directory remained. It passed after the change. The final focused command `FORCE_COLOR=0 node --test --test-name-pattern='protected deletion|protected rename' test/cli.test.mjs` passed 46 tests. The full suite was not run. REFACTOR: no justified change; the rollback change removes a redundant operation, and the new table cases cover distinct failures.

Independent read-only review of the rollback found no data-loss defect and no surplus in the new tests. The reviewer found that the recovery path was not checked; the test was updated and passed. Two attempts at a wider independent review did not finish. A full issue-level review is still required before completion.

The worktree contains existing changes, including rename work. Do not remove or revert them.

## Tracked Scope

- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.
- ISS_7K43WJQCX792WR155NSCGZ9JXC, Provide protected CLI deletion with reference refusal, in progress.
- US_7B7XYX62PP9HKSDHJ0S32FZNY2, Delete unreferenced nodes without changing dependent source, in progress.
- ISS_3TZEBX21PT964SW1E8VN3BDJEC, Resolve graph imports with unique names and stable IDs, done; it blocks the deletion issue.
- ISS_7714AMSVAF9AVTZ9MC60KYVM0Y, Expose protected deletion through VS Code, todo; the deletion issue blocks it.
- HO_508P9PWJTY8YS833HX21KSZ5FM records earlier deletion work and reference coverage.

## Blockers

- The standalone CLI cannot inspect unsaved editor buffers. Caller-reported unsaved files do not establish that all affected files are saved.
- All-or-nothing deletion is not established for crashes, concurrent writers, and rollback or cleanup failures. The new rollback-link failure test shows that the target can remain absent while the original is retained in a recovery directory. This does not satisfy the unchanged-project requirement.
- Complete indirect and unresolved source-reference coverage remains unproved. The full independent issue review did not complete.

## Relevant Files

- `src/protected-edit.js`
- `src/cli.js`
- `src/graph.js`
- `test/cli.test.mjs`

## Suggested Skills

- `tdd`
- `implement`