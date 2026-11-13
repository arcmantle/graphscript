## Work Mode

AFK

## Outcome

Derived graph data follows valid saved-source changes automatically while existing node identities remain stable.

## Scope

- Detect saved managed-source changes made by editors, direct file operations, and Git operations.
- Update the node index and dependency graph through the owning compiler interface.
- Preserve existing stable IDs during valid updates.
- Report source or identity inconsistencies without rewriting source, assigning replacement IDs, or overwriting unsaved work.

## Acceptance Criteria

- Integration fixtures change saved source directly and verify the resulting graph update without a manual repair command.
- A real temporary Git fixture verifies graph updates after a Git source change.
- Existing valid node IDs remain unchanged across updates.
- Invalid or inconsistent source produces a diagnostic without silent source repair or replacement identities.
- Updates do not require builds from unsaved buffers and do not overwrite unsaved work.