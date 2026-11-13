## Status

Accepted

## Context

A single physical output file can place external static imports before GraphScript node setup. That can change program behavior. The program output has one entry and must preserve module evaluation behavior.

## Decision

A program build may emit internal native ESM modules alongside its single entry file. The internal modules are part of the output and must travel with the entry. This applies to program output in either selected language.

## Consequences

- The entry alone is not necessarily a complete program artifact.
- The compiler must verify evaluation order, shared module state, and other required module behavior. Permission to emit internal modules does not prove that an implementation preserves them.
- Unreachable graph nodes remain outside the program output.