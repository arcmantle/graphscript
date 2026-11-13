## Decision

Provide one common alias for local graph imports. Provide one package-root entry with named exports and generated TypeScript declarations for published libraries. Consumers do not need GraphScript. The compiler resolves internal node-module locations; separate per-node public import paths are not required.

Publish the compiler and CLI together as a project-local npm development dependency through the npm registry. Publish the separate explorer extension through the VS Code Marketplace. The extension uses the project's compiler and reports missing or unsupported versions without silent installation or substitution.

These later answers settle the import-form, publication-channel, and compiler-compatibility questions left open in the earlier entries. Exact package identifiers, publisher identifiers, supported host versions, and output file layout are release or implementation details, not additional import-model choices.