As a GraphScript developer, I want program output based on one program-start file and its reachable graph, so that the build excludes unrelated nodes and preserves program behavior.

## Acceptance Criteria

- Automatic static builds select a program build when exactly one source file has the first-statement "graphscript:program"; directive.
- More than one program-start directive stops the build and reports all candidate paths. No directive selects a library build.
- The program-start file is the only program root. The build includes its reachable graph, excludes other nodes, and emits one entry bundle.
- A dynamic import of a new GraphScript node emits a separate bundle for that node and its reachable graph. The imported node needs no program directive and is not another program entry.
- Builds support a choice of TypeScript or JavaScript output for each build.
- Running emitted output preserves once-only program-start execution, once-only node setup per runtime instance, shared exports, and function execution only on calls.

## Boundaries

- The compiler does not provide a separate execution wrapper.
- Analyzer limitations do not make valid source syntax invalid.
- Exact output file layout remains an implementation detail.