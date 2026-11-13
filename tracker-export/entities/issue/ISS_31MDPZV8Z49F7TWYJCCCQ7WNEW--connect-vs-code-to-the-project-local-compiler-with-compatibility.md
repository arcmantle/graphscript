## Work Mode

AFK

## Outcome

The explorer extension uses the project's compiler and reports missing or unsupported versions without blocking ordinary source editing.

## Scope

- Establish the separate local desktop VS Code extension and project-compiler connection.
- Declare and check an extension-to-compiler compatibility range.
- For a missing or unsupported compiler, show a clear error and disable compiler-dependent GraphScript operations only.
- Do not silently download, install, upgrade, or substitute a compiler. Permit installation only through an explicit user-approved setup action.

## Acceptance Criteria

- Extension-host fixtures load a compatible project-local compiler rather than substituting a bundled or global compiler.
- Missing and unsupported compiler fixtures produce clear errors and disable dependent operations.
- Ordinary TypeScript files remain editable in both failure cases.
- No background compiler installation or substitution occurs.
- Any setup path that installs a compiler requires explicit user approval; release-specific range values remain subject to the publication metadata checks.