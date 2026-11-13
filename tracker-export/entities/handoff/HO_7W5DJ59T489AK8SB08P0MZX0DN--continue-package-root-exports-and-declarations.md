## Focus

Continue ISS_0XMHHC7NJJ808SGXC1KC3TWT85. Verify the package-root contract against emitted artifacts. Preserve all pre-existing worktree changes, including program-bundle tests.

## Current State

The package-root consumer test passed on Node 24.22.1 and TypeScript 7.0.2. It installs copied output, removes access to source nodes, executes JavaScript output and checks declarations for both output languages. This session added class and state type checks and a negative factory return-type check to the existing test in test/cli.test.mjs. No production code was changed. The worktree was already mostly untracked; do not reset it.

An independent read-only review and independent test run were completed. The review found that TypeScript output points its package root to index.mts; Node 24 refuses to strip types under node_modules. The existing test compiles those files before execution. README.md says to compile TypeScript output first, but the linked user story also requires ordinary package-root consumers. Resolve that contract before changing output behavior. The reviewer noted that the existing root test also checks dependency staging; those pre-existing checks were retained.

REFACTOR: no justified change; the scoped change extends an existing consumer contract, and pre-existing staging assertions must be preserved.

## Tracked Scope

- ISS_0XMHHC7NJJ808SGXC1KC3TWT85, Generate package-root exports and TypeScript declarations, in progress.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.
- US_6SWS0M62NN84TA0F9G704HVF8S, Produce libraries for ordinary JavaScript and TypeScript consumers, in progress.
- ADR_1P1QA2MJF58R2R8BJAY3C5N972, Separate public library imports from node file layout, current.
- ISS_0AWWMVW57D8NK8G33ARMBN1K0R, Emit ESM node modules with shared, once-only initialization, done; it blocks the active issue and is complete.
- ISS_7NC3X8J5WG9RKR8HC6TGP4G78A, Preserve library dependencies and user-authored package metadata, todo; the active issue blocks it.

## Blockers

- A package-root function with only a computed local helper path fails after the source nodes are removed: the helper is not staged. This affects use of that export, not the generation of its name or declaration. The output policy for unknown computed dependencies is not settled; do not silently copy development tooling or weaken broader contracts.
- The staged-helper containment test fails for both computed import and require. This is a containment failure, not proof of a sandbox contract for arbitrary code.
- Independent validation: the root consumer test passed; the computed staging and staged-helper containment tests failed. The direct computed-relative containment test passed. The full suite was not run.
- The Node TypeScript package-root finding remains open. Review and final issue completion are not complete until material gaps are resolved and the focused checks pass.

## Relevant Files

- `src/build.js`
- `test/cli.test.mjs`
- `README.md`

## Suggested Skills

- `tdd`
- `domain-modeling`