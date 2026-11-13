For the first release, who runs tests in a GraphScript project?

Options:
- GraphScript prepares test code and resolves GraphScript imports for an existing test runner.
- GraphScript provides its own test runner, including test discovery, assertions, and result reporting.
- GraphScript has no test integration. Developers run ordinary tests against emitted library modules.

Recommendation, not an approved decision: prepare test code for an existing runner. This supports GraphScript imports without a new assertion and reporting system. A native runner gives more control but adds maintenance work. Testing emitted modules alone reduces GraphScript work but requires more user setup.

The runner choice, test source organization, graph participation, build exclusions, watch behavior, and editor operations are not yet settled.