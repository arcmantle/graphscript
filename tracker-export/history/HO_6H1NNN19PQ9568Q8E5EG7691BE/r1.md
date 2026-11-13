## Focus

Continue the initiative with a new implementation subagent for each issue. Refresh next-work after completed issues. Preserve existing work and do not invent maintainer approval.

## Current State

Since the previous handoff, the explicit program-library build, VS Code compiler connection, directed graph view, editor project creation, compiler graph watcher, graph depth controls, explorer refresh, performance measurement, and cycle marks were completed and reviewed. Changes are uncommitted. Preserve all workspace changes.

FORCE_COLOR=0 npm test: 137 passed, 4 failed. The failures are the TypeScript reachable program bundle, graph namespace calls in local helpers, computed-only local helper staging, and computed imports inside staged helpers. Plain npm test reported two more failures because forced ANSI colors changed captured output.

Subagents can sometimes call tracker tools directly even when tool_search is absent. Ask them to inspect and try their actual available tools. Do not bypass a skill loader if its required tool is truly unavailable.

## Tracked Scope

- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E, GraphScript language and tooling, active.
- PRD_56YNYBVGBD9N2932KDN3S5ZB5N, GraphScript first usable release, draft.
- ISS_0XMHHC7NJJ808SGXC1KC3TWT85, Generate package-root exports and TypeScript declarations, in progress.
- ISS_6AM1AZ2GFR9W0AHNG0RZN73PM0, Build one reachable program bundle in either output language, in progress.
- ISS_0JEH25FY6V8BQV5K29P1Y7C6D4, Provide protected CLI rename with complete reference updates, in progress.
- ISS_7K43WJQCX792WR155NSCGZ9JXC, Provide protected CLI deletion with reference refusal, in progress.
- ISS_4W51PKABNT9DTA7SKYT6NV3HZY, Confirm release identifiers, license, supported hosts, and version ranges, todo; maintainer approval is required.
- ADR_1P1QA2MJF58R2R8BJAY3C5N972, Separate public library imports from node file layout, current.

## Blockers

- Package output has no settled contract for computed local dependency paths; it must not silently require source files or copy tests and development tooling. The staged-helper path containment test also fails; it is not evidence that arbitrary untrusted code is sandboxed.
- Program bundle output still lacks TypeScript graph bundling and correct graph namespace imports in local helpers.
- Standalone CLI rename and deletion cannot currently detect unsaved editor buffers. Their multi-file operations are not atomic against crashes, concurrent writers, or rollback failures. Do not mark them done against the current requirements.
- The latest next-work read returned 5 available records, including the 4 in-progress issues and one approval-dependent issue, plus 15 blocked. Refresh before selecting work.

## Relevant Files

- `src/build.js`
- `src/protected-edit.js`
- `src/cli.js`
- `src/graph.js`
- `extension/extension.js`
- `extension/graph-webview.js`
- `test/cli.test.mjs`
- `test/graph-watch.test.mjs`
- `extension/test/host.cjs`
- `benchmarks/README.md`
- `README.md`

## Suggested Skills

- `next-work`
- `tdd`
- `implement`
- `grill-with-docs`
