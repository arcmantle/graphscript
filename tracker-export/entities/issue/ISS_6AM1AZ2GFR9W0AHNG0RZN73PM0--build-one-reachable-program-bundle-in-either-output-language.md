## Work Mode

AFK

## Outcome

A program build emits one entry bundle for the program-start file and its reachable graph, with unrelated nodes excluded.

## Scope

- Use the program-start file as the sole static program root.
- Include its reachable function, class, and state-node graph, and exclude other nodes.
- Provide the approved TypeScript or JavaScript output choice.
- Preserve once-only program-start execution, node setup, shared exports, and function-call semantics. Leave execution to ordinary runtime and debugger tools.

## Acceptance Criteria

- Program fixtures emit one entry bundle containing the required reachable graph and excluding an unrelated node.
- Both output-language selections pass their compile and execution checks.
- Running emitted output executes program-start code once and preserves cached node setup and shared state.
- Compiler and GraphScript errors stop output generation; valid analyzer-gap fixtures retain their warning classification.
- The CLI builds the program without providing a GraphScript execution wrapper.