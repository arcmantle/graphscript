## Work Mode

AFK

## Outcome

The actual compiler and CLI npm artifact installs cleanly, and generated library artifacts work in ordinary JavaScript and TypeScript projects without GraphScript.

## Scope

- Package the compiler and CLI together with the confirmed release metadata.
- Install the actual npm artifact as a project-local development dependency in clean test projects.
- Build library artifacts and install them in ordinary JavaScript and TypeScript consumer projects.
- Verify public ESM imports, declarations, external dependencies, preserved metadata, and exclusion of tests and development tooling.

## Acceptance Criteria

- A clean installation of the actual compiler and CLI artifact provides the declared CLI and project-local compiler.
- An ordinary JavaScript consumer imports package-root node names and executes successfully without GraphScript installed in that consumer.
- An ordinary TypeScript consumer type-checks and uses the generated declarations without a GraphScript resolver.
- Library artifacts preserve external runtime dependency imports and valid metadata, with no external test files or development tooling copied into runtime output.
- Evidence records exact artifact identities and tool versions; source-tree imports or linked development packages do not substitute for clean installation.