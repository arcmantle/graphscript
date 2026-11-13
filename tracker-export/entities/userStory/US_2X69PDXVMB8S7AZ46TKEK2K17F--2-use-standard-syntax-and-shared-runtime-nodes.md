As a GraphScript developer, I want standard TypeScript and JavaScript syntax with defined node initialization and imports, so that my runtime code has predictable behavior.

## Acceptance Criteria

- Managed runtime functions, classes, and shared state are graph nodes. Each unit exports only its primary node and does not expose additional top-level exports or keep private runtime definitions outside the graph.
- Local graph imports use one common alias and project-wide unique readable names. Resolution maps names to stable node IDs rather than lasting source paths.
- External package imports accept static ECMAScript imports, dynamic import(), and CommonJS require().
- Node top-level setup runs once on first load per runtime instance. Importers share cached exports, including state objects. Function bodies run only when called.
- The program-start file can contain variables and other code without defining a function. Its code runs once at program start.
- Valid standard syntax is not rejected only because the analyzer cannot resolve a static dependency. Compiler errors and GraphScript rule failures remain errors.

## Boundaries

- An internal wrapper is an implementation choice, not a required language construct.
- Full syntax support does not remove the approved GraphScript node and export rules.
- External tests remain ordinary files outside the managed graph.