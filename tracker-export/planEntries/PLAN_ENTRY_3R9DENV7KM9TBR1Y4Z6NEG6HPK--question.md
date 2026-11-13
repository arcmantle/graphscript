## Public installation channels

Must the first release distribute the compiler and CLI through the npm registry and the explorer through the VS Code Marketplace, or are manually installed package archives and VSIX files sufficient?

The approved installation model is a project-local compiler and CLI npm package plus a separate extension that uses the project's compiler version.

Recommendation, not an approved decision: require npm registry and VS Code Marketplace publication. These provide normal installation and updates. Manual archives reduce initial publication work but make installation and updates manual. Additional registries, standalone executables, and alternative editor marketplaces are not proposed as first-release requirements. Exact package and publisher names remain open.