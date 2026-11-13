## Work Mode

AFK

## Outcome

A developer can delete an unreferenced node through the CLI, while referenced nodes and unsafe file states remain unchanged.

## Scope

- Provide deletion through a shared protected-edit operation and the CLI.
- Find source imports that reference the node independently of whether a runtime graph edge is present.
- Refuse referenced deletion and list the references.
- Require saved affected files, complete prevalidation, conflict refusal, and all-or-nothing changes. Do not add forced deletion or automatic dependent-source removal.

## Acceptance Criteria

- An unreferenced function, class, or state node can be deleted through the CLI.
- A source import, including one omitted from runtime-edge display, causes deletion refusal and a useful reference list.
- Referenced deletion leaves the complete project unchanged.
- Unsaved files, conflicting changes, and operation failures do not overwrite work or leave partial deletion.
- Focused CLI tests confirm that no force option or dependent-source removal bypasses these rules.