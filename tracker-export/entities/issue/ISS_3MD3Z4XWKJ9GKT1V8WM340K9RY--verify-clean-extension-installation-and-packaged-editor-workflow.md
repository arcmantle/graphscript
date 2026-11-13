## Work Mode

AFK

## Outcome

The actual extension package installs cleanly and performs the approved workflows with the installed project-local compiler.

## Scope

- Build the extension package with the confirmed publisher, identifier, version, and compatibility metadata.
- Install it in a clean local desktop VS Code test environment.
- Use the cleanly installed compiler artifact for automated setup, graph, source-update, protected-edit, and build workflows.
- Verify missing or unsupported project compilers and continued ordinary source editing.

## Acceptance Criteria

- The actual extension package installs cleanly and exposes the declared explorer and commands.
- Packaged automated workflows cover setup, creation, source opening, depth and full-graph controls, dependency list, cycle marks, source updates, protected edits, and check or build operations.
- The extension uses the installed project-local compiler and enforces its declared compatibility range.
- Missing and unsupported compiler cases never trigger silent installation or substitution and do not disable ordinary source editing.
- Evidence identifies the exact extension and compiler artifacts and VS Code version; an unpackaged development host is not the only evidence.