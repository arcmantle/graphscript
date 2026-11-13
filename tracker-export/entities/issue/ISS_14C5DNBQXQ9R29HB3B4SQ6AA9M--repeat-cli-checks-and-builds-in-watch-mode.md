## Work Mode

AFK

## Outcome

A developer can select watch mode to repeat checks and builds after saved source changes.

## Scope

- Connect saved-source notifications to CLI check and build watch modes.
- Retain output-language and program or library selections, including explicit library output.
- Apply the same diagnostics and error rules as one-shot operations.
- Keep program execution outside GraphScript. Treat watch as an optional operating mode, not a requirement to build unsaved buffers.

## Acceptance Criteria

- A process-level test saves a source change and observes another check without emitted output in check watch mode.
- Build watch mode updates the requested output after a valid saved change.
- Errors stop the affected build, and a later valid save can produce successful output.
- Program, library, explicit library, and output-language selections remain effective across watched builds.
- The watch process can be stopped cleanly and does not execute the program.