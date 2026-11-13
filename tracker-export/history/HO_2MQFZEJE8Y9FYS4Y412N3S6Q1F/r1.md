## Focus

Complete TypeScript program bundling for local setup before external package initialization. Preserve import order, live bindings, TypeScript checking, call receivers, and cycle semantics.

## Current State

The issue remains in progress. All workspace changes are uncommitted. Preserve them, including the previous agent's TypeScript graph namespace test.

Extended the existing public CLI test `TypeScript program bundles preserve local and package initialization order` in `test/cli.test.mjs`. The original TypeScript source is compiled and executed before the build. Its package exports mutable `value`, `bump`, `unbound`, and type `Value`. The expected output is `helper setup`, `package setup ready`, and `answer 43`. This checks source initialization order, a live package binding, an unbound imported call, and a type import. The bundle build still fails at the existing guard, before output type checking or execution.

`FORCE_COLOR=0 node --test --test-name-pattern='program bundles' test/cli.test.mjs` reported 46 passed and one failed: the order test. `FORCE_COLOR=0 node --test --test-name-pattern='TypeScript program builds (reject unsafe external import order without output|allow safe external import order)' test/cli.test.mjs` reported six passed. VS Code reports no errors in the changed test file. No production code was changed.

## Tracked Scope

- ISS_6AM1AZ2GFR9W0AHNG0RZN73PM0, Build one reachable program bundle in either output language, in progress.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.

## Blockers

- `bundleTypeScriptProgram` in `src/build.js` emits package imports before inlined module bodies. Its guard rejects a package import that follows local setup. Removing the guard changes valid program behavior.
- An awaited dynamic import alone is not a proven replacement: a Node probe with `await import("data:text/javascript,await%20import(import.meta.url)")` reports unsettled top-level await. This is a cycle risk, not proof that every dynamic-import design fails. Destructuring the dynamic namespace would also lose live bindings; replacing named calls with member calls can change `this`.
- Design and test a replacement that preserves external and local module evaluation, live named/default/namespace bindings, type and value imports, imported call receivers, top-level await, cyclic function hoisting, temporal dead zones, and shared state. Include interleaved local and package initialization with cycles. Do not remove the guard or replace the rejection test until the valid replacement is verified.
- The full issue acceptance criteria are not yet verified. No independent review ran. After implementation, run the focused program-bundle suite and the appropriate broader checks, complete the TDD refactor gates, and arrange the required independent read-only review before marking the issue done. If review is unavailable, leave the issue in progress for the orchestrator.

## Relevant Files

- `src/build.js`
- `test/cli.test.mjs`
- `src/program-bundle.cjs`

## Suggested Skills

- `tdd`