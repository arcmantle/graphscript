## Problem Statement

Developers who start a small TypeScript project must organize and find runtime code through files and folders. They need a graph that shows functions, classes, shared state, and their runtime dependencies. They also need ordinary TypeScript editing and output that works with existing JavaScript and TypeScript tools.

## Solution

Provide GraphScript as a TypeScript-based language and compiler with a CLI and a VS Code graph explorer. Developers create and manage graph nodes, open their persistent source files, inspect dependencies, and build program or library output. Both interfaces provide project setup, node creation, rename, deletion, check, and build operations, with optional watch mode. Existing runtimes, debuggers, and test runners remain usable.

The first release supports developers who start small new projects. Its supported environment is local CLI use and local desktop VS Code on macOS, with Node.js 24 and TypeScript 7.

## Implementation Decisions

- Store each function, class, or shared state object in one persistent TypeScript source file in one tool-managed directory. Source files are authoritative and are committed to version control. Use native TypeScript source editing, not temporary editing projections.
- Give each graph node one stable internal ID and one project-wide unique readable name across all node kinds. The readable name is the primary export name and source filename. Use one common alias for local graph imports; resolve readable names to stable IDs rather than treating managed paths as lasting identities.
- Require one node-kind directive and one matching primary export per node file. A function node exports one function, a class node exports one class, and a state node exports one object. A state object can contain multiple shared values. Do not expose additional top-level exports or keep private runtime functions, classes, or shared state outside the managed graph.
- Accept the standard TypeScript and JavaScript syntax surface, subject to the agreed GraphScript source rules. Support external package imports through static ECMAScript imports, dynamic import(), and CommonJS require(). Do not reject valid syntax only because static analysis cannot resolve an edge.
- Show statically resolvable runtime dependencies: function calls and value use, class creation and use, and state-property access. Identify the exact state property and distinguish reads from writes. Omit type-only references and unused imports. Report analyzer gaps as source-located warnings, not compiler errors.
- Run a node's top-level setup once on first load per runtime instance. Cache and share its exports among importers. Run a function body only when called. An internal wrapper is not a language requirement.
- Use a directed explorer view centered on the selected function. Default to one level of nearby nodes, provide depth 1, 2, and 3 controls and a full-graph option, show a separate direct-dependency list, and mark cycles. Selecting a node opens its source file. The content-hub view is a behavior reference, not a required graph library.
- Update derived graph data after valid saved-source changes, including direct edits and Git operations. Preserve existing stable IDs. Report inconsistent source or identity data without silently rewriting source or assigning replacement identities.
- Validate complete rename and deletion operations before changing files. Require affected files to be saved. Refuse conflicts and never overwrite unsaved work. Complete all required changes or leave the project unchanged. Rename preserves the ID and updates the readable name, source filename, and imports that resolve to that ID. Refuse referenced-node deletion, list its references, and do not provide forced deletion or automatic dependent-source removal.
- Offer program or library setup. A program has one program-start file whose first statement is "graphscript:program";. The file can contain variables and other code without defining a function. It runs once at program start. A library has no program-start file.
- For automatic static builds, one program-start directive selects a program build; no directive selects a library build. More than one directive stops the build and reports all candidate paths. A program build uses the program-start file as its only root, includes its reachable graph, excludes other nodes, and emits one entry bundle. A dynamic import of a new node emits a separate bundle for that node and its reachable graph; that node needs no program directive.
- Support an explicit library-output build for both program and library projects without removing or executing the program-start file. Emit every graph node as a separate library module. Provide one generated package-root entry with named exports and generated TypeScript declarations. Consumers use readable node names and need neither GraphScript nor a consumer-side resolver. Internal node-module paths are not required public import paths.
- Let each build select TypeScript or JavaScript output. JavaScript library output is ESM only. Keep external runtime packages as library imports with ordinary dependency or peer-dependency declarations. Do not infer a peer-dependency policy or copy development tooling into runtime dependencies. This does not change program bundling.
- Generate required output package metadata for the root entry and declarations. Preserve user-authored name, version, license, dependency declarations, and other metadata. Do not silently change the source manifest. Report conflicts that prevent valid output.
- Check reports diagnostics without output. Build emits output and stops for compiler errors or GraphScript rule failures. Optional watch mode repeats checks and builds after saved changes. Leave execution to the selected runtime and debugger.
- Keep tests as ordinary files outside the managed graph and release output. Test files have no node IDs and their dependencies do not appear in the explorer. Developers choose the runner and file locations through normal package scripts. Document a build-then-test example that requests library output and runs tests only after a successful build.
- Publish the compiler and CLI together through npm as a project-local development dependency. Publish the separate explorer extension through the VS Code Marketplace. The extension checks its declared compatibility range against the project-local compiler. For a missing or unsupported compiler, show a clear error and disable only compiler-dependent GraphScript operations. Keep ordinary source editing available. Do not silently install, upgrade, download, or substitute a compiler; installation requires an explicit user-approved setup action.

## Testing Decisions

- Establish public contract tests for node directives, primary exports, unique names, stable IDs, import resolution, node initialization, and standard syntax. Test analyzer warnings separately from compiler and GraphScript errors.
- Use graph fixtures for function and class dependencies, exact state-property reads and writes, type-only and unused-import omission, analyzer gaps, cycles, and saved-source updates after direct edits and Git operations.
- Test rename and deletion through both interfaces. Cover successful rename, stable IDs, import updates, name collisions, unsaved files, conflicting changes, referenced-node deletion, and all-or-nothing file changes.
- Compile and run output fixtures for program-root reachability, unreachable-node exclusion, once-only initialization, dynamic bundles, zero or multiple program directives, both output languages, and explicit library output from a program project without running its program-start file.
- Install actual library artifacts into clean ordinary JavaScript and TypeScript consumer projects. Check ESM package-root named imports, declarations, external dependencies, preserved metadata, and operation without GraphScript. Verify that tests and development tooling do not enter release output.
- Test CLI diagnostics, check without emission, build failure, optional watch behavior, and build-then-test failure control. Use automated desktop VS Code workflow tests for setup, creation, navigation, depth controls, cycle marks, source updates, protected edits, build operations, and missing or unsupported project compilers.
- Before publication, fix exact supported Node.js and TypeScript limits, the desktop VS Code range, extension-to-compiler compatibility, supported macOS versions, and processor architectures. Supply evidence for every declared host combination.
- Before publication, fix npm package identifiers, CLI command names, extension and publisher identifiers, release versions, license, and required metadata. Verify identifier ownership and clean installation of the actual npm and extension packages. Archives and VSIX downloads alone do not satisfy the required publication channels.
- Require repeatable automated contract and workflow tests, ordinary library-consumer checks, clean artifact installation, and a recorded manual explorer review. Tie evidence to exact release artifacts and tool versions. A missing or failed required check prevents publication. Planning approval is not passing test evidence.
- Measure TypeScript performance with a representative project that uses the one-file-per-node model. Do not invent a numeric performance target from the planning record.

## Out of Scope

- Implementing the language or tools as part of this PRD conversion.
- Migrating or supporting existing projects, or providing a standalone graph explorer.
- First-release support guarantees for Windows, Linux, browser VS Code, remote workspaces, or Node.js and TypeScript major versions outside the selected versions.
- A GraphScript test runner, special test import integration, generated test-runner configuration, test-watch integration, managed test nodes, or test-dependency graph views.
- A GraphScript execution wrapper, forced referenced-node deletion, automatic removal of dependent source, or silent compiler installation and substitution.
- CommonJS library output, required per-node public package subpaths, alternative registries or editor marketplaces, or standalone executable distribution.

## Further Notes

The existing source-storage and public-library-entry architecture decisions remain applicable. Earlier exploratory statements do not replace later settled decisions. The graph rendering library, exact output layout, command syntax, common-alias spelling, and node-kind directive parsing and placement remain implementation details. The node-kind strings discussed in planning are examples, not a final syntax contract; the program-start directive is fixed.

Exact package identities, license, version limits, supported host combinations, and compatibility ranges are required publication metadata, not approved values. Implementation must establish and test these values before publication. No code, automated tests, or release artifacts exist in the current repository beyond its short project description. This PRD defines requirements and does not claim implementation or release evidence.