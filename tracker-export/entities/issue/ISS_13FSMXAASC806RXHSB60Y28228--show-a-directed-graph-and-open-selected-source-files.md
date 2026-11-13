## Work Mode

AFK

## Outcome

A developer can inspect a directed graph around a selected function and open the persistent source of a selected node.

## Scope

- Render the compiler's managed runtime graph in the VS Code explorer.
- Center the initial view on the selected function with one level of nearby nodes.
- Represent function, class, and state-node dependencies with correct direction.
- Open the selected node's real source file. Select an appropriate rendering library without treating the content-hub implementation as mandatory.

## Acceptance Criteria

- Automated explorer tests show a nonblank directed view for a representative selected function.
- The initial view contains the selected function and one level of nearby nodes.
- Class and state dependencies are available as managed nodes, not hidden outside the graph.
- Selecting each displayed node opens the corresponding persistent source file.
- The graph uses the compiler's resolved IDs and runtime dependencies rather than a separate conflicting analysis.