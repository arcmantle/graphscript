## Work Mode

AFK

## Outcome

The open VS Code graph stays current after saved edits and Git changes without losing node identity or overwriting work.

## Scope

- Connect the explorer to the existing saved-source graph update contract.
- Refresh displayed nodes and dependencies after valid saved changes.
- Surface source and identity inconsistency reports without silent repair.
- Preserve valid stable identities and ordinary editor work.

## Acceptance Criteria

- An automated editor workflow saves a dependency change and observes the updated graph without a manual repair action.
- A temporary Git change updates the explorer through the same saved-source path.
- Existing node IDs remain stable during valid refreshes.
- Invalid source or identity data produces a visible diagnostic without rewriting source or assigning replacement identities.
- Unsaved editor work is not overwritten by refresh.