## Work Mode

AFK

## Outcome

A developer can test emitted modules with an existing runner through normal package scripts, without starting the program or adding tests to the graph.

## Scope

- Provide a documented example using a chosen existing runner and ordinary external test files.
- Run explicit library output before tests and start the runner only after a successful build.
- Keep test locations and runner configuration under developer control.
- Verify that tests have no managed node IDs or explorer dependency edges and are absent from program and library release output.

## Acceptance Criteria

- The documented package-script workflow passes against a program project whose program-start side effect must not run.
- Tests import emitted modules normally without a GraphScript runner or import adapter.
- A failing build prevents the test runner from starting.
- Artifact and graph inspections show that external test files and dependencies remain outside the managed graph and release output.
- No GraphScript-specific test command, generated runner configuration, or test-watch integration is introduced.