## Work Mode

AFK

## Outcome

A developer can create a small library project, create one function node, and check its saved TypeScript source through the CLI.

## Scope

- Establish the minimum compiler and CLI package and repeatable test setup for the selected Node.js and TypeScript major versions.
- Provide library-project setup and function-node creation in one managed source directory.
- Store authoritative persistent TypeScript source, a stable node ID, and a readable primary-export name that matches the filename.
- Provide an initial check operation without output emission. Keep command spelling and directory layout as documented implementation choices.

## Acceptance Criteria

- An automated CLI workflow creates a library project with no program-start file, creates a function node, and checks it successfully.
- The created node has one matching directive and primary function export, a stable ID, and a matching readable filename.
- Source remains available to the ordinary TypeScript editor and version control without temporary source projections.
- Check emits no compiled output, and a basic invalid source fixture produces a failing result.
- A documented local validation command repeats this workflow from a clean temporary project.