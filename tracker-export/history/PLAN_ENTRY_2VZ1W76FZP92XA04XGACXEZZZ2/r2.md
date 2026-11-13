## Decision

For the first release, tests remain ordinary files outside the managed GraphScript graph. They import emitted modules and use an existing test runner.

Test files have no managed graph-node IDs. Test dependencies do not appear in the graph explorer. GraphScript does not include these external test files in program or library release output.

The requirement to model runtime functions, classes, and shared state applies to managed GraphScript source, not to these external test files.

File locations and the build-before-test workflow remain open.