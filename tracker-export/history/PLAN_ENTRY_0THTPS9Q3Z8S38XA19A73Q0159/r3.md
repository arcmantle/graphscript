## Decision

For the first release, developers configure tests through normal package scripts. Developers choose the existing test runner and test-file locations.

Provide a documented build-then-test example. The script first requests library output and runs the test runner only if the build succeeds.

GraphScript does not generate or maintain test-runner configuration. No GraphScript-specific test command or test-watch integration is required. Runner watch mode and editor test integration remain the responsibility of the chosen runner.