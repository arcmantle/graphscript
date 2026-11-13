As a GraphScript developer, I want to rename a node safely through the CLI or VS Code, so that readable names can change without losing identity or breaking resolved imports.

## Acceptance Criteria

- Both interfaces provide node rename.
- A successful rename preserves the stable node ID and changes the readable name, primary export name, matching source filename, and every source import that resolves to that ID.
- A rename that duplicates any function, class, or state-node name is rejected with a clear error.
- All affected files must be saved before rename. Unsaved work is never overwritten.
- The complete operation is validated before file changes. Conflicting changes are refused.
- All required changes complete together, or the project remains unchanged.

## Boundaries

- Managed source paths are not lasting import identities.
- This operation does not authorize unrelated source cleanup or replacement node identities.