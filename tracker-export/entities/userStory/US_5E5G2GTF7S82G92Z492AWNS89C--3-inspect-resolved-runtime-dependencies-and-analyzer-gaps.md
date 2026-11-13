As a GraphScript developer, I want a graph of resolved runtime dependencies and clear analyzer warnings, so that I can understand code relationships without confusing missing analysis with invalid code.

## Acceptance Criteria

- Directed edges show statically resolvable function calls or value use, class creation or use, and shared-state access between managed nodes.
- A state edge identifies the exact property and distinguishes read from write access. Different properties remain distinct.
- Type-only references and unused imports do not appear as runtime dependency edges.
- Cycles can be identified for explorer display.
- An unresolved analysis case produces a warning with its source location. It does not make otherwise valid TypeScript or JavaScript invalid.
- Compiler errors and GraphScript rule failures are distinguishable from analyzer-gap warnings.

## Boundaries

- The graph promises only static links that it can resolve to managed GraphScript units.
- Test-file dependencies are not graph dependencies.
- No complete static edge set is promised for dynamic language behavior.