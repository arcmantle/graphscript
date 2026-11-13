## Work Mode

HITL

## Outcome

The approved explorer extension is available through the VS Code Marketplace and works with the released project-local compiler.

## Scope

- Obtain explicit maintainer approval for Marketplace publication after the required release evidence passes.
- Publish the exact approved extension under the confirmed publisher, identifier, and version.
- Verify Marketplace installation in supported desktop VS Code with the published npm compiler.
- Retain compatibility errors and ordinary editing when the project compiler is missing or unsupported. Do not substitute a VSIX-only release.

## Acceptance Criteria

- A maintainer explicitly authorizes publication of the exact evidence-backed extension artifact.
- The Marketplace listing and installable package use the approved publisher, identifier, version, and compatibility metadata.
- A clean supported VS Code installation can install the published extension and use the released project-local compiler.
- A focused installed workflow verifies graph opening, source navigation, and a compiler-backed operation.
- The publication record identifies the actual released artifacts and installation result, and no missing or failed required evidence is bypassed.