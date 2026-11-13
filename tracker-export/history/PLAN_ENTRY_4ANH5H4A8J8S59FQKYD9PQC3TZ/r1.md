## Test source organization

Should test files remain ordinary files outside the managed GraphScript graph, or should test code become managed graph nodes?

Options:
- Keep ordinary test files outside the managed graph. They import the emitted modules and use an existing runner. Test files are not graph nodes and are not included in release output. Test dependencies are not shown in the graph.
- Include test code as managed graph nodes. This allows graph navigation for test dependencies, but requires rules for test-node identity and exclusion from release output.

Recommendation, not an approved decision: keep ordinary test files outside the managed graph for the first release. The existing requirement to model runtime functions, classes, and shared state would apply to GraphScript graph source, not to these external test files.

The exact file locations and build-before-test workflow depend on this choice and remain open.