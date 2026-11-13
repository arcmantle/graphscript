## Question
For a library build with no source file marked with the `"graphscript:program";` directive, which graph nodes must the compiler include, and how must library consumers access them?

## Context
The current design has one primary export per graph-node file and uses unique GraphScript names to identify nodes. A program build has explicit roots; a library build does not.

## Recommendation
Include every graph node as an individually importable library module, and expose each module through its unique GraphScript name. This avoids an unstated root or a new public-node marker. The consumer can then import only the nodes that it needs.