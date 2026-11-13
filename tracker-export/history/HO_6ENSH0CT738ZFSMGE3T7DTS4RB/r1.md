## Focus

Continue ISS_0XMHHC7NJJ808SGXC1KC3TWT85. Preserve all workspace changes, including protected edits and program-bundle tests. Do not copy test tooling, set a policy for unknown computed dependencies, or imply that emitted code is a sandbox.

## Current State

The worktree is mostly untracked. No code change from this session remains. A TDD experiment added a guard to known staged helpers; focused tests passed, but independent read-only review found that the guard rejects imports that previously worked and changes the helper contract. The experiment and its new tests were removed. The existing tests remain.

The review also found that the experiment could change CommonJS module bindings, spread calls, import coercion, and URL bindings. These findings apply to the removed experiment, not necessarily to the current code. REFACTOR: no retained change to refactor.

On Node 24.22.1 and TypeScript 7.0.2, the final focused run passed the package-root consumer test and direct computed-relative containment test. It failed the staged-helper containment test, computed-only staging test, and TypeScript program-bundle initialization-order test. The full suite ran before removal of the experiment: 207 passed and 2 failed out of 209. Its failures were computed-only staging and the program-bundle initialization-order test. The final focused run confirms both failures remain; it also confirms the staged-helper containment test fails after removal of the guard.

## Tracked Scope

- ISS_0XMHHC7NJJ808SGXC1KC3TWT85, Generate package-root exports and TypeScript declarations, in progress.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.
- US_6SWS0M62NN84TA0F9G704HVF8S, Produce libraries for ordinary JavaScript and TypeScript consumers, in progress.
- ADR_1P1QA2MJF58R2R8BJAY3C5N972, Separate public library imports from node file layout, current.
- ISS_0AWWMVW57D8NK8G33ARMBN1K0R, Emit ESM node modules with shared, once-only initialization, done and is the incoming blocker.
- ISS_7NC3X8J5WG9RKR8HC6TGP4G78A, Preserve library dependencies and user-authored package metadata, todo and blocked by the active issue.

## Blockers

- The policy for unknown computed local dependencies is not settled. The computed-only helper is not staged, and its test fails with ERR_MODULE_NOT_FOUND.
- The staged-helper containment test fails for import and require. A guard for that test changes the behavior of helper imports; the active issue does not establish that restriction. Do not treat arbitrary code as sandboxed.
- The prior review found that TypeScript output exposes index.mts at the package root. Node 24 does not strip types in node_modules. The existing root consumer test compiles output before it runs; it does not resolve the ordinary Node consumer gap.
- The program-bundle initialization-order test fails with the diagnostic that external import evaluation order cannot be preserved after local setup. It also fails after the experiment is removed. Do not change program bundling within this issue without explicit scope.
- Completion, a passing final suite, and a final review of any retained implementation remain open. The issue remains in progress.

## Relevant Files

- `src/build.js`
- `test/cli.test.mjs`
- `src/program-bundle.cjs`
- `README.md`

## Suggested Skills

- `tdd`
- `domain-modeling`