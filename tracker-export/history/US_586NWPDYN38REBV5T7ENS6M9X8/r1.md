As a GraphScript developer, I want the graph to update after saved source changes, so that it remains correct after ordinary edits and Git operations.

## Acceptance Criteria

- Managed source changes are detected automatically, including changes made directly in files and changes from Git operations.
- Valid saved source updates derived graph data without a manual graph repair step.
- Existing stable node IDs are preserved during updates.
- Inconsistent source or identity data produces a clear report. The tool does not silently rewrite source or assign replacement identities.
- Unsaved work is not overwritten by graph updates.

## Boundaries

- The update contract applies to saved source; it does not require builds from unsaved buffers.
- Derived graph data does not replace source files as the source of truth.
- No automatic source or identity repair is approved.