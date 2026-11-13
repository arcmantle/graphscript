## Module output for testing program projects

Library builds emit every graph node as a separate module. Program builds start from the program-start file and emit a bundle of reachable nodes. External tests use normal imports of emitted modules.

For a project with a program-start file, should developers be able to request library output explicitly, without removing the program directive?

Options:
- Allow an explicit library-output build for either project kind. It emits graph-node modules for normal imports and does not execute or use the program-start file as the build root. This reuses library output but adds an explicit output choice for program projects.
- Test only the normal program bundle. This avoids an additional output choice but does not guarantee direct imports of individual graph nodes for unit tests.

Recommendation, not an approved decision: allow an explicit library-output build for either project kind. Keep tests and the test runner outside GraphScript. Exact command syntax, output location, and package scripts are not settled.