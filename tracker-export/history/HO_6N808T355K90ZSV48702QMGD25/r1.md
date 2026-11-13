## Focus

Continue the initiative without weakening the tracked contracts. Resolve the program-bundle and library-output blockers, then complete protected editing and release validation.

## Current State

The worktree contains uncommitted changes. Preserve all existing files and changes. TypeScript library output now points its package root to compiled JavaScript. The README states that the output is not yet a complete publishable package. Protected rename and deletion now check additional source references, package routes, manifests, file metadata, and rollback conflicts. Issue-level completion is not established.

On Node.js 24.22.1, `FORCE_COLOR=0 npm test` reported 235 tests: 231 passed, three failed, and one was skipped. The failures were TypeScript program-bundle initialization order, computed-only local helper staging, and staged-helper computed import containment. The skip was a case-sensitive-volume check on a case-insensitive volume. Focused protected-edit checks passed; the latest deletion slice reported 71 passed and one skipped in the wider protected-edit suite. Independent reviews were run for retained slices; the full protected-edit issue contracts remain unverified.

## Tracked Scope

- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E: GraphScript language and tooling; active.
- ISS_6AM1AZ2GFR9W0AHNG0RZN73PM0: program bundle; in progress.
- ISS_0XMHHC7NJJ808SGXC1KC3TWT85: package-root exports and declarations; in progress.
- ISS_0JEH25FY6V8BQV5K29P1Y7C6D4: protected CLI rename; in progress.
- ISS_7K43WJQCX792WR155NSCGZ9JXC: protected CLI deletion; in progress.
- ISS_4W51PKABNT9DTA7SKYT6NV3HZY: release identifiers and compatibility; todo.

## Blockers

- The TypeScript single-file bundle hoists external static imports ahead of inlined local setup. The guard prevents incorrect behavior. A replacement must preserve ordering, live bindings, types, and cycle semantics. See HO_6H5JCG5BAA9ATV4EZPKBYN8PYE.
- Computed local dependency staging and helper containment need an established contract. Do not copy test tooling or assume emitted code is a sandbox. See HO_6ENSH0CT738ZFSMGE3T7DTS4RB.
- Standalone CLI visibility of unsaved editor buffers, full atomicity under interruptions and concurrent writers, and complete indirect-reference handling are not established. Do not mark the protected-edit issues done without the required evidence.
- Release identifiers, license, supported hosts, and version ranges need maintainer approval and ownership evidence. See HO_4X11JSPEWE9XSVM63ZG5CXDRK1.

## Relevant Files

- `src/build.js`
- `src/program-bundle.cjs`
- `src/protected-edit.js`
- `test/cli.test.mjs`
- `README.md`

## Suggested Skills

- `next-work`
- `tdd`
- `grill-with-docs`