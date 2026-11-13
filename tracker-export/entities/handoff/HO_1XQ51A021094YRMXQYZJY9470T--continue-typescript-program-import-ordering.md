## Focus

Complete TypeScript program bundling with correct local and external module evaluation order.

## Current State

The issue remains in progress. Existing workspace changes are uncommitted. Preserve them. Added a public CLI test for TypeScript graph namespace calls in a local TypeScript helper. The test compiles and executes the bundle, checks the namespace call receiver, and excludes an unrelated node. The focused test passed.

`FORCE_COLOR=0 node --test --test-name-pattern='program bundles' test/cli.test.mjs` reported 45 passed and one failed before the new test was added. The failure is `TypeScript program bundles preserve local and package initialization order`. The broader `FORCE_COLOR=0 npm test` output included that failure but did not include a final summary.

## Tracked Scope

- ISS_6AM1AZ2GFR9W0AHNG0RZN73PM0, Build one reachable program bundle in either output language, in progress.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.

## Blockers

- The TypeScript emitter hoists external static imports ahead of inlined local setup. It rejects a valid import order to avoid incorrect execution. Removing the guard changes runtime behavior. A repair must preserve evaluation order, live bindings, type checking, and cyclic module behavior without silently changing the issue contract.
- The existing test that expects rejection of unsafe external import order conflicts with the issue's required valid-source behavior. Update that test only when the replacement preserves the contract.
- The required independent review has not run. Do not mark the issue done until implementation, validation, and review are complete.

## Relevant Files

- `src/build.js`
- `test/cli.test.mjs`

## Suggested Skills

- `tdd`