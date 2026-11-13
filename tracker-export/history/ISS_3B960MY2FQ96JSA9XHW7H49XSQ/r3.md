## Work Mode

AFK

## Outcome

A developer can select TypeScript instead of JavaScript for library output through the same build interface.

## Scope

- Add TypeScript output selection to compiler and CLI builds.
- Emit the library's node modules and public entry as usable TypeScript output.
- Preserve graph import resolution and the agreed runtime semantics.
- Document the per-build output-language choice without fixing an output layout beyond the public contract.

## Acceptance Criteria

- The same saved library project can be built separately as TypeScript or JavaScript.
- Emitted TypeScript type-checks with the selected TypeScript language version and resolves its emitted module imports.
- Compilation and execution of TypeScript output preserve node initialization and shared exports.
- Public node names remain the same for both output languages.
- A focused output-language contract test verifies that the build uses the requested language rather than silently substituting another.