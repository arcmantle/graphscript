## Work Mode

AFK

## Outcome

Program setup creates the fixed program-start directive, and automatic builds select program or library mode consistently.

## Scope

- Add program-project setup through the CLI and shared project operations.
- Recognize the first-statement "graphscript:program"; directive.
- Select program mode for exactly one program-start file and library mode for none.
- Reject multiple program-start directives with all candidate paths. Allow program-start variables and other code without requiring a function definition.

## Acceptance Criteria

- Program setup creates one file whose first statement is the exact program-start directive.
- Library setup and automatic checking accept a project with no program-start file.
- Multiple program-start files produce a failing result that lists each candidate path.
- A directive outside the required first-statement position does not silently select a program root.
- A valid program-start file can contain variables and other code without exporting a graph-node function.