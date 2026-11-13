As a GraphScript developer, I want installable CLI and explorer tools with explicit compiler compatibility checks, so that my project controls its compiler version and source editing remains available when setup is incomplete.

## Acceptance Criteria

- The compiler and CLI are distributed together through npm as a project-local development dependency.
- The separate graph explorer extension is distributed through the VS Code Marketplace. Manual archives and VSIX downloads alone do not satisfy distribution.
- The extension declares its supported compiler-version range and uses the project-local compiler.
- A missing or unsupported compiler produces a clear installation or compatibility error and disables compiler-dependent GraphScript operations.
- Ordinary source editing remains available when the compiler is missing or unsupported.
- The extension does not silently download, install, upgrade, or substitute a compiler. An installation requires an explicit user-approved setup action.

## Boundaries

- First-release support is local CLI and local desktop VS Code on macOS, with Node.js 24 and TypeScript 7.
- Exact identifiers, supported version limits, and ownership checks are required publication metadata, not approved values.
- Alternative registries, editor marketplaces, standalone executables, browser VS Code, and remote workspaces are not required.