## Decision

A published GraphScript library provides one package-root entry with named exports and generated TypeScript declarations. Ordinary JavaScript and TypeScript consumers do not need to install GraphScript.

The compiler generates the root entry and declarations. Consumers import graph nodes by their unique readable names from the package root. Separate emitted node modules remain an output detail, not required public import paths.

The existing common alias for local graph imports remains unchanged.