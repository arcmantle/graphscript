## First-release test setup

Should developers configure tests through normal package scripts, or should GraphScript project setup generate and maintain test-runner configuration?

Options:
- Leave test files and runner configuration to developers. Document an example package script that first builds library output and then runs an existing test runner. Run the runner only if the build succeeds. No GraphScript-specific test command or test-watch integration is required.
- Offer generated test setup. This reduces initial developer setup but requires GraphScript to select and support runner configuration and its maintenance.

Recommendation, not an approved decision: use normal package scripts and provide a documented build-then-test example. Developers choose the runner and test-file locations. GraphScript provides the explicit library-output build, not a test execution system.

Runner-specific watch mode and editor test integration remain the responsibility of the chosen runner under the recommended option.