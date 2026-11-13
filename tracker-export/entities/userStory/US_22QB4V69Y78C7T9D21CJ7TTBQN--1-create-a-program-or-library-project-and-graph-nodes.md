As a developer who starts a small TypeScript project, I want to create a program or library and its graph nodes through the CLI or VS Code, so that I can organize runtime code without managing folders by hand.

## Acceptance Criteria

- Both interfaces provide program or library setup and creation of function, class, and state nodes.
- Program setup creates a program-start file whose first statement is "graphscript:program";. Library setup creates no program-start file.
- Each node has one persistent TypeScript source file in one tool-managed directory, one node-kind directive, and one matching primary export. Function and class nodes export one definition; a state node exports one object that can contain multiple shared values.
- Node names are unique across functions, classes, and state objects. Creation rejects a duplicate name with a clear error.
- Each node receives a stable internal ID. Its readable name matches its primary export and source filename. Source files are authoritative and can be committed to version control.
- Source opens in the ordinary TypeScript editor. No temporary source projection is required.

## Boundaries

- The first release targets new projects, not migration of existing projects.
- This story does not fix package identifiers, CLI command spelling, alias spelling, or node-kind directive syntax that the Plan leaves to implementation.
- The fixed program-start directive is distinct from the node-kind directive examples.