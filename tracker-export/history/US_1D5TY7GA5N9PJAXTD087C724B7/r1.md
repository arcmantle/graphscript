As a release maintainer, I want required checks tied to exact artifacts and tool versions, so that I publish GraphScript only when the declared first-release contracts have evidence.

## Acceptance Criteria

- Repeatable automated contract tests cover language, graph, compiler, CLI, diagnostics, and protected-edit behavior. Automated VS Code workflow tests cover the supported explorer operations.
- The actual npm package and extension package install cleanly. Ordinary JavaScript and TypeScript projects consume library artifacts without GraphScript.
- A manual explorer review is recorded. Automated and manual evidence identifies the exact release artifacts and tool versions.
- Before publication, exact Node.js and TypeScript limits, the desktop VS Code range, and extension-to-compiler compatibility are fixed and tested within the selected Node.js 24 and TypeScript 7 major versions.
- Supported macOS versions and processor architectures are declared, with release evidence for every declared combination. Unsupported combinations are not claimed.
- npm package identifiers, CLI command names, extension and publisher identifiers, release versions, license, and required metadata are fixed. Identifier ownership and artifact installation are verified.
- TypeScript performance is measured with a representative one-file-per-node project. The planning record does not supply a numeric performance threshold.
- Any missing or failed required check prevents publication. Planning approval is not passing test evidence.

## Boundaries

- Windows, Linux, browser VS Code, remote workspaces, and other Node.js or TypeScript major versions are outside the first-release support guarantee.
- This story defines release requirements; it does not claim that checks have passed or authorize publication before evidence exists.
- Exact release metadata must be established during implementation rather than invented during PRD conversion.