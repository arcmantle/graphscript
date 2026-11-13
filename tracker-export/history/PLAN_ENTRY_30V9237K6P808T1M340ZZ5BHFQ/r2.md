## Decision

Tests use normal module imports and an existing test runner. GraphScript emits ordinary modules. Test execution does not require a GraphScript test runner or special import integration.

This decision does not require an index file. Test source organization, graph participation, and exclusion from release output remain open.