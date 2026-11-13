As a GraphScript developer, I want a focused graph explorer in VS Code, so that I can inspect dependencies and open the related source code.

## Acceptance Criteria

- The explorer shows a directed graph centered on the selected function, with one level of nearby nodes by default.
- Developers can select depth 1, 2, or 3, or show the full graph.
- A separate list shows direct dependencies, and the graph marks cycles.
- Selecting a graph node opens its persistent source file in the ordinary editor.
- Functions have individual editable nodes. Classes and state objects remain available as managed graph nodes and dependencies.

## Boundaries

- The content-hub view is a behavior reference, not a required rendering library.
- No standalone explorer is required.
- The first-release support guarantee covers local desktop VS Code on macOS only.