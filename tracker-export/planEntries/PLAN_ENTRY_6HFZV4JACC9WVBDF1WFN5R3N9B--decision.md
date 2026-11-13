## Decision

Distribute the compiler and CLI package through the npm registry. Distribute the graph explorer extension through the VS Code Marketplace. Manual package archives and VSIX downloads alone do not satisfy the first-release distribution requirement.

The compiler remains a project development dependency. The extension uses the project's compiler version. Additional registries, standalone executables, and alternative editor marketplaces are not first-release requirements.