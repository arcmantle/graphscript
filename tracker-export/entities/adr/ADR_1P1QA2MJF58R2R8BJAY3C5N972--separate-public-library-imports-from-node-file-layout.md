## Status

Accepted

## Context

GraphScript represents each graph node in a separate source file and emits separate library modules. Local graph imports use a common alias and readable names, not managed file paths. Requiring a package subpath for each published node would expose the internal file layout as the public interface.

## Decision

Provide one package-root entry with named exports and generated TypeScript declarations for published GraphScript libraries. The compiler generates this entry and resolves the internal module locations. Ordinary JavaScript and TypeScript consumers do not need GraphScript. Do not require per-node package subpaths or a consumer-side GraphScript resolver.

## Consequences

- Public imports remain independent of internal node-module paths.
- Generated output includes the root entry, declarations, and required package metadata.
- Separate emitted node modules remain an output detail.
- Node names remain public export names; stable internal IDs do not replace consumer-facing names.