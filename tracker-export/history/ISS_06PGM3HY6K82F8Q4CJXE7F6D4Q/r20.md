## Destination

A specification for the first usable GraphScript release, for developers starting a small new TypeScript project. It covers the language, compiler, and a VS Code graph explorer.

## Notes

The shared Plan is [GraphScript design plan](PLAN_6T5CSA42KH8DGBT7GNTBRM43GJ). Use plan with domain-modeling for decision tickets. The explorer must show runtime dependencies between function, class, and state nodes and open the related source.

## Decisions so far

- [Define source organization](ISS_1ZC5GHA2CG9H89QVFD6KZBT2KK) - Each function has a persistent, tool-managed TypeScript file.
- [Define function identity and imports](ISS_3WFZC3CXC29YYR0GBP9YFMY9T4) - Imports use readable names mapped to stable IDs. Names are unique across the project. Renames update imports and source files.
- [Define graph nodes and dependencies](ISS_43YTB2BDST9WVVVNGXPMABZ0YN) - Each function, class, or state object is one typed node; runtime edges show use, including state-property reads and writes.
- [Define graph explorer behavior](ISS_1H0GS38XSA9GASF72ZD1AGXBKC) - Use a focused dependency graph with depth and full-graph controls, a direct-connection list, cycle marks, and source navigation.
- [Define TypeScript compatibility](ISS_6B5593FDRN9KD9K9D8MPGPH0C6) - Use TypeScript 7 and full TypeScript/JavaScript support, with each runtime function, class, and shared state represented in the graph.
- [Define compilation and output](ISS_536KZ0SMFQ83HREJE2Y9A429Y5) - Start from the special `"graphscript:program";` file, include reachable graph nodes, and emit the selected TypeScript or JavaScript bundle. Dynamic imports emit separate bundles and need no program directive.
- [Define program-start file validation](ISS_6XSZCZP7A59QP8GES27Y6QY9TV) - No directive means a library build; multiple directives are an error.
- [Define library build output](ISS_7YY4DK15QQ9Y98V8CKHHSQM1B6) - Library builds emit every graph node as a separate module, available by its unique GraphScript name.
- [Define first-release diagnostics](ISS_1X7J8X40PP8TR9MF6KS7JWZA1J) - Compiler errors and GraphScript rule failures stop builds; analyzer gaps are warnings with source locations.
- [Define developer workflows](ISS_1MSEWWJWKP9ZVAFRSX8VCN6NKZ) - Provide CLI and VS Code operations, program-or-library setup, live graph updates, protected node changes, and check/build/watch workflows.
- [Define testing support](ISS_09QKWES9GA950825KCRWK9TJ4B) - External tests use normal imports and package scripts; both project types can explicitly produce library output.
- [Define package metadata and distribution](ISS_5PM65N1RB58RXBZRNZQSRDRN7S) - Publish project-local compiler tooling through npm and the explorer through Marketplace; ESM libraries expose one package-root entry with generated types.
- [Define first-release acceptance criteria](ISS_1TCEMZE9AT9M181X4AQ17J8ZMP) - Require repeatable release evidence; support local macOS tooling with Node.js 24 and TypeScript 7.

## Not yet specified

None.

## Out of scope

Implementation of the language, compiler, or explorer. Support for existing projects and a standalone explorer are not required for the first release. Windows, Linux, browser VS Code, and remote workspaces are outside the first-release support guarantee.