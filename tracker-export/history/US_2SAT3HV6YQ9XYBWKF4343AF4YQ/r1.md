As a GraphScript developer, I want equivalent check and build operations through the CLI and VS Code, so that I can use interactive workflows and package scripts with the same rules.

## Acceptance Criteria

- Both interfaces provide check and build operations.
- Check reports diagnostics without emitting output. Build emits the selected output and stops for compiler errors or GraphScript rule failures.
- Analyzer gaps produce source-located warnings rather than invalidating otherwise valid source.
- Optional watch mode repeats checks and builds after saved source changes.
- Build operations expose the approved program or library selection and output-language choice, including explicit library output from a program project.
- CLI operations can be used from scripts. Program execution remains available through the selected runtime and debugger.

## Boundaries

- Watch mode is an optional operating mode, not a requirement to build unsaved buffers.
- No GraphScript execution wrapper is added.
- Exact CLI syntax and output locations remain implementation details.