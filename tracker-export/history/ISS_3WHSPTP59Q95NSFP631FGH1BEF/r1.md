## Work Mode

AFK

## Outcome

A developer can check and build projects from VS Code with the same compiler rules and output selections as the CLI.

## Scope

- Expose shared check and build operations and optional watch mode in the extension.
- Expose TypeScript or JavaScript output and automatic or explicit library-output selection.
- Show compiler errors, GraphScript errors, and source-located analyzer warnings.
- Use saved-source watch updates and leave execution to ordinary runtime and debugger tools.

## Acceptance Criteria

- Automated editor workflows check without output emission and build the selected output.
- A program project can request explicit library output without removing or executing its program-start file.
- Errors stop builds, while analyzer gaps retain warning severity and useful source locations.
- Watch repeats the requested operation after saved changes and can be stopped cleanly.
- Compiler-dependent operations remain disabled when project-compiler compatibility checks fail.