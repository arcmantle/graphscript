## Work Mode

AFK

## Outcome

A developer can rename a graph node through the CLI without losing identity, leaving stale resolved imports, or overwriting work.

## Scope

- Provide rename through a shared protected-edit operation and the CLI.
- Preserve the stable ID while changing the readable name, primary export, matching filename, and source imports that resolve to that ID.
- Require affected files to be saved and validate the complete operation before file changes.
- Refuse name collisions and conflicting changes. Complete every required change or leave the project unchanged.

## Acceptance Criteria

- A successful rename for each node kind preserves its stable ID and updates its export, filename, and every resolved source import.
- A duplicate name across any node kind is refused with a clear diagnostic.
- Unsaved affected files and conflicting changes cause refusal without overwriting work.
- Failure fixtures prove that an incomplete operation leaves the project unchanged rather than partially renamed.
- A focused CLI contract test verifies the complete before-and-after source and identity state.