As a GraphScript developer, I want to test emitted modules with my chosen test runner, so that I can use ordinary package scripts without GraphScript-specific test infrastructure.

## Acceptance Criteria

- Tests remain ordinary files outside the managed graph. They have no managed node IDs and their dependencies do not appear in the graph explorer.
- Tests can import emitted modules through ordinary module imports and run with an existing test runner without a GraphScript import adapter.
- Developers choose the runner and test-file locations through normal package scripts.
- A documented build-then-test example explicitly requests library output and starts the test runner only if the build succeeds.
- The example works for a program project without removing or executing its program-start file.
- External test files are absent from program and library release output.

## Boundaries

- GraphScript does not generate or maintain test-runner configuration.
- No GraphScript-specific test command or test-watch integration is required.
- Runner watch mode and editor test integration remain the chosen runner's responsibility.