As a GraphScript developer, I want safe node deletion through the CLI or VS Code, so that I can remove unused code without damaging references or unsaved work.

## Acceptance Criteria

- Both interfaces provide deletion of an unreferenced graph node.
- If other source imports the node, deletion is refused, references are listed, and the project remains unchanged.
- All affected files must be saved before deletion. Unsaved work is never overwritten.
- The complete operation is validated before file changes. Conflicting changes are refused.
- All required changes complete together, or the project remains unchanged.

## Boundaries

- No forced deletion is provided.
- The tool does not remove dependent source automatically.
- A missing runtime edge does not authorize deletion while a source import still references the node.