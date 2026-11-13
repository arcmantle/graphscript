## Decision

Provide one public import location for graph nodes. Do not require consumers to use a separate package subpath for each graph node. The compiler or bundler resolves the nodes and places code in the required output locations.

The user rejected the recommendation to require package subpaths. Separate emitted node modules do not require separate public import locations. Package-specific subpaths are not a first-release requirement.

The exact import syntax and the distinction between local graph imports and imports from published packages still need a concrete example.