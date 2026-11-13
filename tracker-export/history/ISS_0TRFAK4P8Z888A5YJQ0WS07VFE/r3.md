## Work Mode

AFK

## Outcome

A developer can explicitly request library output from a program project without removing or executing its program-start file.

## Scope

- Expose explicit library-output selection through the shared compiler and CLI build interface.
- Emit every graph node independently of program-start reachability.
- Do not use the program-start file as the library root or execute it during this build.
- Keep automatic program-versus-library selection unchanged when explicit library output is not requested.

## Acceptance Criteria

- A program project with a visible program-start side effect emits library modules without executing that side effect.
- The program-start directive remains unchanged in source.
- A node that is unreachable from program-start is included in explicit library output.
- An ordinary consumer can import the emitted node modules without starting the program.
- Automatic builds still choose program mode for the same project when no explicit library-output request is made.