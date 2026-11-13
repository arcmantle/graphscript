## Status

Accepted

## Context

Developers create and navigate functions as graph nodes. The project needs real TypeScript files for existing tools. A single file with temporary editing files would require a custom projection and write-back system; one file per function increases the file count.

## Decision

Store each function in its own persistent TypeScript file. The function files are the source of truth and are committed to version control.

## Consequences

- The explorer creates and manages function files.
- The project can use real TypeScript files without a temporary-file write-back system.
- The effect of file count on TypeScript performance must be measured with a representative project.