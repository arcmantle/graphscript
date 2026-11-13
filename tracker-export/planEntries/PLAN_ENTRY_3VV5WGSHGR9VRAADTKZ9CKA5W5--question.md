## Question

What should the VS Code explorer show and let a developer do when they inspect a function's runtime dependencies, including a cycle and a node with many incoming or outgoing edges?

The answer should define how the explorer shows edge direction, makes cycles clear, and manages dense connections without hiding them. It should also state how a developer opens the source for a selected node.

## Recommended answer

Use a directed graph centered on the selected node. Keep all dependency edges visible, mark cycle edges, and let the developer filter or expand nearby nodes when the graph is dense. A click on a node opens its source file.