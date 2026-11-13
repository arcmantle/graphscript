## Focus

Complete ISS_0JEH25FY6V8BQV5K29P1Y7C6D4 without changing its requirements. Preserve all existing worktree changes. Check for an active worker before you start.

## Current State

The shared rename operation now scans project JavaScript and TypeScript source, checks caller-reported unsaved project sources, updates named graph re-exports and TypeScript import type qualifiers, and refuses unresolved CommonJS graph references. The CLI contract test covers a helper, re-export, import type, asset link, and local require binding. The unsaved test covers a helper. A separate test checks CommonJS refusal and unchanged files.

The read-only review found that unrelated asset links and local require bindings were refused. Both cases were fixed and tested after review. The review also identified relative file imports and re-export barrel consumers as possible missing references; verify their scope and behavior against the issue and graph resolution contract. Dynamic global require calls are conservatively refused. Test surplus was not established.

FORCE_COLOR=0 node --test --test-name-pattern='protected rename|protected deletion' test/cli.test.mjs: 33 passed. The full suite was not run. REFACTOR: no further refactor was justified for the partial slice; the deletion path is separate and must not be changed without its own validation. The worktree was already mostly untracked, with README.md modified; preserve it all.

## Tracked Scope

- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.
- ISS_0JEH25FY6V8BQV5K29P1Y7C6D4, Provide protected CLI rename with complete reference updates, in progress.
- US_1CPMQXGH808XGR2NMTH4270ZH8, Rename nodes without losing identity or references, in progress.
- ISS_3TZEBX21PT964SW1E8VN3BDJEC, Resolve graph imports with unique names and stable IDs, done; it blocks the rename issue.
- ISS_2AB28Y1FHM86RSNVAGW79G5GQ2, Expose protected rename through VS Code, todo; the rename issue blocks it.
- Read HO_6H1NNN19PQ9568Q8E5EG7691BE for earlier work and blockers.

## Blockers

- The standalone CLI does not receive editor buffer state. Caller-reported unsaved files do not establish protection for all editors.
- The current multi-file commit and rollback cannot guarantee an unchanged project after a crash, concurrent writer, or rollback failure. Do not mark the issue done or claim atomicity without evidence that meets the tracked contract.
- Complete reference updates remain unproven for relative node paths, barrel consumers, computed imports, and other indirect or unresolved forms. Some unresolved require calls now refuse rather than update.
- The independent review preceded the two review fixes. A complete final review is still required after all issue behaviors pass.

## Relevant Files

- `src/protected-edit.js`
- `src/cli.js`
- `src/graph.js`
- `test/cli.test.mjs`
- `README.md`

## Suggested Skills

- `tdd`
- `handoff`