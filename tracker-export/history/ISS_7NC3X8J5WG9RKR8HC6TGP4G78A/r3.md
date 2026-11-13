## Work Mode

AFK

## Outcome

Library output has valid package metadata without bundling external runtime dependencies or silently changing source metadata.

## Scope

- Generate required metadata for the ESM root entry and declarations.
- Keep external runtime packages as imports with normal dependency and peer-dependency declarations.
- Preserve user-authored package name, version, license, dependencies, and other metadata.
- Report conflicts that prevent valid output. Do not infer peer-dependency policy or copy development tooling into runtime dependencies.

## Acceptance Criteria

- Emitted libraries retain external runtime package imports and resolve them after ordinary dependency installation.
- Output metadata connects the generated root entry and declarations.
- Before-and-after checks show that builds leave the source manifest unchanged.
- User-authored metadata remains intact, and conflicting required metadata produces a clear error.
- Development-only GraphScript tooling does not appear in library runtime dependencies; no separate CommonJS output tree is produced.