## Decision

Library output keeps external runtime packages as package imports. Do not bundle those packages into the emitted library. Developers declare runtime dependencies and peer dependencies through normal package metadata.

GraphScript does not infer a peer-dependency policy or copy development-only tooling into library runtime dependencies. This does not change the existing program-bundle decision.