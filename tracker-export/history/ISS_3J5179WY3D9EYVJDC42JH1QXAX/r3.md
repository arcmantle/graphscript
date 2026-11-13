## Work Mode

AFK

## Outcome

A developer can distinguish cyclic dependencies from ordinary directed links in the graph explorer.

## Scope

- Identify cycles in the resolved runtime graph used by the explorer.
- Display cycle marks without changing source or inventing unsupported edges.
- Keep marking consistent with focused and full-graph views.

## Acceptance Criteria

- Graph and editor fixtures identify a simple cycle and a cycle within a larger graph.
- An acyclic graph is not marked as cyclic.
- Cycle marks remain correct when the selected node or visible depth changes.
- Selecting a cycle node still opens its ordinary source file.
- A focused automated workflow proves the marks are present in the rendered explorer.