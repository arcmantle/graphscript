## Focus

Complete release metadata verification and prepare protected CI publication without bypassing the required artifact evidence gate.

## Current State

The user selected `@arcmantle/graphscript`, `arcmantle.graphscript-explorer`, Apache-2.0, version `0.1.0`, macOS 26.7.2 arm64, Node.js `>=24 <25`, TypeScript `7.0.2`, VS Code `^1.105.0`, and compiler `^0.1.0`. The user wants tag-triggered protected CI publication, not manual publication.

The manifests, lockfiles, scoped project-local compiler resolver, host fixtures, README, and Apache license text were updated. The worktree contains pre-existing changes and untracked files. Preserve them. The scoped resolver suite passed two tests. The compatible and setup desktop host fixtures exited with code 0. An npm pack dry run contained the selected name, license, and CLI entry. The license text matched the official Apache text apart from outer whitespace. No release artifact was published.

Organization workflows use `NPM_PUBLISH` for npm and `VS_MARKETPLACE_PAT` for Marketplace. Both names are available as organization secrets to this repository. Do not expose their values. The shared pnpm workflow changes dependencies and versions; it does not meet the exact-artifact evidence contract as-is. No release environment or publishing workflow was created.

An independent read-only review was attempted, but the reviewer could not load its required tracker tool. The review did not run.

## Tracked Scope

- ISS_4W51PKABNT9DTA7SKYT6NV3HZY: confirm release identifiers, license, supported hosts, and version ranges; in progress.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E: GraphScript language and tooling; active.

## Blockers

- npm scope and Marketplace publisher ownership are not independently verified. An unauthenticated lookup of the proposed npm package returned 404.
- The artifact-specific release evidence gate and protected release environment are not in place. Do not enable a publishing workflow that bypasses these requirements.
- The release compatibility matrix and full issue acceptance criteria are not verified. Complete the independent review before marking the issue done.

## Relevant Files

- `package.json`
- `package-lock.json`
- `extension/package.json`
- `extension/compiler.js`
- `extension/test/compiler.test.cjs`
- `extension/test/host.cjs`
- `extension/test/run-host.cjs`
- `README.md`
- `LICENSE`

## Suggested Skills

- `implement`
- `handoff`