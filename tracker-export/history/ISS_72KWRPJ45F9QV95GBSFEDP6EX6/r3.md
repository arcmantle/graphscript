## Work Mode

AFK

## Outcome

A checked project exposes directed, statically resolved function and class runtime dependencies.

## Scope

- Compute graph edges for function calls and value use, and class creation and use.
- Resolve edge endpoints to managed node IDs.
- Exclude type-only references and unused imports from runtime edges.
- Provide the graph result through the owning compiler interface so later output and editor workflows can use it.

## Acceptance Criteria

- Focused graph fixtures identify function calls, function value use, class construction, and class value use.
- Edge direction and endpoint IDs match the source dependencies.
- Type-only references and unused imports produce no runtime edge.
- Duplicate source references do not produce inconsistent graph results.
- A documented focused graph test command verifies the public graph result without requiring VS Code.