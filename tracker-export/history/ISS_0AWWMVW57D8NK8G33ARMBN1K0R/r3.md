## Work Mode

AFK

## Outcome

A library build emits ordinary JavaScript ESM node modules whose initialization and exports have the approved runtime behavior.

## Scope

- Provide JavaScript library builds through the compiler and CLI.
- Emit every managed node as a separate module.
- Resolve internal graph imports while preserving source execution semantics.
- Cache exports and run node setup once on first load per runtime instance. Do not prescribe an internal wrapper.

## Acceptance Criteria

- A library without a program-start file emits a separate ESM module for every graph node.
- Executable fixtures prove that repeated imports share exports and one state object.
- Top-level setup runs once per runtime instance, and a function body runs only when called.
- Function, class, and state-node module fixtures execute successfully.
- Compiler errors and GraphScript rule failures stop the build; an analyzer warning alone does not reject otherwise valid source.