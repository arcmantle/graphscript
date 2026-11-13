## Work Mode

AFK

## Outcome

A developer can set up program or library projects and create managed nodes from VS Code without creating source files by hand.

## Scope

- Expose the shared setup and node-creation operations through the explorer extension.
- Offer program or library setup and function, class, or state-node creation.
- Use the same naming, source-file, directive, export, and identity validation as the CLI.
- Open created source in the ordinary TypeScript editor.

## Acceptance Criteria

- Automated VS Code workflows create a program project and a library project with the correct program-start behavior.
- Each node kind can be created through the extension and opens as persistent editable TypeScript source.
- A duplicate name is rejected consistently with the CLI.
- Created nodes use the existing managed-directory and stable-ID contracts.
- Source files remain available to ordinary editor tooling without temporary projection or source write-back.