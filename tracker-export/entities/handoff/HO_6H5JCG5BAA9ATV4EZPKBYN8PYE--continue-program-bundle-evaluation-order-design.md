## Focus

Complete TypeScript program bundling for local setup before external package initialization. Preserve live bindings, call receivers, types, top-level await, temporal dead zones, and cyclic module evaluation.

## Current State

No workspace files were changed in this session. Preserve all existing uncommitted changes. The existing public test `TypeScript program bundles preserve local and package initialization order` still fails at the external-order guard in `src/build.js`. Its original TypeScript program runs and produces `helper setup`, `package setup ready`, and `answer 43`.

`FORCE_COLOR=0 node --test --test-name-pattern='program bundles' test/cli.test.mjs` reported 46 passed and one failed. `FORCE_COLOR=0 node --test --test-name-pattern='TypeScript program builds (reject unsafe external import order without output|allow safe external import order)' test/cli.test.mjs` reported six passed. VS Code reported no errors in `src/build.js` or `test/cli.test.mjs`.

A Rollup 4 probe with a local module imported before an external package emitted the external import first and local setup after it. An awaited dynamic self-import reported unsettled top-level await. No replacement was verified. No independent review ran because the implementation and focused suite are not complete.

The process check found no separate worker tied to this workspace. The separate Copilot CLI process had `/Users/roen` as its working directory. Session history showed no newer project session other than this session.

## Tracked Scope

- ISS_6AM1AZ2GFR9W0AHNG0RZN73PM0, Build one reachable program bundle in either output language, in progress.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.

## Blockers

- A static external import in one ESM file evaluates before the file body. It cannot run after an inlined local setup statement. Hoisting it changes the failing fixture's result.
- Replacing it with `await import()` can change evaluation scheduling and can stall a cycle; destructuring would also lose live bindings. A valid replacement must prove the contract for external dependencies and importing modules, not just the current fixture.
- Resolve the output and module-linking design before removing the guard. Assess whether one entry bundle permits internal native ESM modules or whether another approach can preserve native cycles, external package identity, and TypeScript output. The current record does not establish such a design. Do not silently relax the one-bundle or behavior contracts.
- Complete the TDD refactor and independent read-only review gates before changing the issue status.

## Relevant Files

- `src/build.js`
- `src/program-bundle.cjs`
- `test/cli.test.mjs`

## Suggested Skills

- `tdd`