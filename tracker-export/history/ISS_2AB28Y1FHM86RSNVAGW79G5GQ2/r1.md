## Work Mode

AFK

## Outcome

A developer can rename a node from VS Code with the same complete updates and work protection as the CLI.

## Scope

- Connect explorer rename to the shared protected-edit operation.
- Require affected editor files to be saved before changes.
- Show name-collision, unsaved-file, and conflict errors without partial changes.
- Refresh the explorer after successful identity-preserving rename.

## Acceptance Criteria

- An automated editor workflow renames a node and verifies the stable ID, export name, source filename, and resolved imports.
- Duplicate names are rejected across node kinds.
- An unsaved affected file causes refusal and remains unchanged.
- Conflicting or failed operations leave all affected files unchanged.
- The explorer displays the new readable name without assigning a replacement identity.