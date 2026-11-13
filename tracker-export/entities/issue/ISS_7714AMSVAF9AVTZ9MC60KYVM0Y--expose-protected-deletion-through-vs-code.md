## Work Mode

AFK

## Outcome

A developer can delete an unreferenced node from VS Code while referenced nodes and unsaved work remain protected.

## Scope

- Connect explorer deletion to the shared protected-edit operation.
- Require affected files to be saved and show refusal reasons and source references.
- Do not provide forced deletion or remove dependent source automatically.
- Refresh the explorer after successful deletion.

## Acceptance Criteria

- An automated editor workflow deletes an unreferenced node and removes it from the displayed graph.
- A referenced node cannot be deleted; references are shown and source remains unchanged.
- An unsaved affected file and a conflicting operation both cause refusal without overwriting work.
- Failed deletion leaves all affected files unchanged.
- The extension does not expose a force or dependent-source-removal path.