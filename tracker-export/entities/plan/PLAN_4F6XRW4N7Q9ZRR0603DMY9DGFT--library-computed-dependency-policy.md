## Goal

Define how library builds handle local dependencies whose paths are computed at runtime.

## Context

The package-root issue needs a decision on which local files enter the library artifact and what behavior applies to imports from staged helpers. The existing public library and TypeScript compatibility contracts remain in scope.