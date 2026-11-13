## Work Mode

AFK

## Outcome

Ordinary JavaScript and TypeScript consumers import library nodes by readable name from one generated package-root entry.

## Scope

- Generate one ESM package-root entry with named node exports.
- Generate TypeScript declarations for the public entry and exported node types.
- Keep separate emitted node modules as an internal layout detail.
- Use the approved public library-entry contract without requiring a consumer resolver.

## Acceptance Criteria

- An ordinary JavaScript consumer imports and uses function, class, and state named exports from the library root.
- An ordinary TypeScript consumer type-checks against generated declarations.
- Consumers do not install GraphScript or require internal node-module paths.
- Public names match the project's unique readable node names.
- Consumer contract tests use only emitted artifacts, not compiler source imports.