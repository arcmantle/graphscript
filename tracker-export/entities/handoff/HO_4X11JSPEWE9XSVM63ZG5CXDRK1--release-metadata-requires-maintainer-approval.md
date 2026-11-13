## Focus

Complete the release metadata and obtain the required maintainer approval and identifier ownership evidence.

## Current State

Read the issue, linked Plan decisions, initiative context, package manifests, README, and issue comments. A read-only agent inspected the local release metadata and Git status. No code or worktree files were changed. The worktree contains pre-existing changes and untracked files; preserve them.

The root manifest specifies candidate npm and CLI name `graphscript`, version `0.1.0`, Node.js `>=24 <25`, and TypeScript `7.0.2`. The extension manifest specifies candidate publisher `graphscript`, extension name `graphscript-explorer`, version `0.1.0`, VS Code range `^1.105.0`, and compiler range `^0.1.0`. Both manifests specify `private: true`. The README states that the publisher and compiler range are provisional. These values are not approval or release evidence.

## Tracked Scope

- ISS_4W51PKABNT9DTA7SKYT6NV3HZY: Confirm release identifiers, license, supported hosts, and version ranges. Status: todo.
- INIT_0233DRCQTD8TBSZF1V2JJCKZ0E: GraphScript language and tooling. Status: active.

## Blockers

- Maintainer approval is required for identifiers, license, host combinations, and version ranges. No such approval was found in the issue comments or the local files inspected.
- Ownership of the npm and Marketplace identifiers is not verified. Do not expose credentials or assume account access.
- No license file was found in the local tree inspected. Supported macOS versions and processor architectures are not declared in the inspected release metadata.
- The exact TypeScript 7 support range and the approved VS Code and extension-to-compiler ranges remain unconfirmed. Artifact installation and compatibility evidence are separate work and must not be inferred from metadata.

## Relevant Files

- `package.json`
- `extension/package.json`
- `extension/compiler.js`
- `README.md`

## Suggested Skills

- `start-work`