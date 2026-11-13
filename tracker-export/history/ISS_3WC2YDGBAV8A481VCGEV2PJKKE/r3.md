## Work Mode

AFK

## Outcome

Developers receive compiler and GraphScript errors separately from source-located analyzer warnings without losing valid standard syntax.

## Scope

- Complete the compiler check and diagnostic contract for the selected TypeScript language version.
- Accept standard syntax subject to the approved managed-node rules.
- Support external static ECMAScript imports, dynamic import(), and CommonJS require().
- Report analysis gaps as warnings with source locations. Keep check free of output emission and provide a failure result for errors.

## Acceptance Criteria

- Focused syntax fixtures cover the supported standard syntax and all three approved external import forms.
- Otherwise valid source with an unresolved graph analysis case produces a source-located warning rather than a syntax or GraphScript error.
- Compiler errors and GraphScript rule failures produce a failing check result with useful locations.
- Unused and type-only references remain distinct from analyzer gaps.
- Check emits no compiled files, and the same diagnostics can be used by build and editor callers.