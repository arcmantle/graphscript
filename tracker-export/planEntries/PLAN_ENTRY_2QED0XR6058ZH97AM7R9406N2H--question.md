## External dependencies in library output

Must a library build keep external runtime packages as package imports, or bundle those packages into the emitted library?

Recommendation, not an approved decision: keep external packages as imports in library output. Developers declare runtime dependencies and peer dependencies through normal package metadata. GraphScript does not infer a peer-dependency policy or copy development-only tooling into the library's runtime dependencies.

Bundling external packages can reduce consumer installation dependencies, but can duplicate shared state and package code across libraries. Keeping imports uses normal package resolution. This question does not change the existing program-bundle decision.