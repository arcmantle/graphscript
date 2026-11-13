## Goal

Define the program output boundary for builds that must preserve module evaluation behavior.

## Context

The TypeScript program build rejects a graph-node setup that precedes an external package import. The current issue requires one entry bundle and preserved program behavior. The output design needs a decision before the guard can be removed.