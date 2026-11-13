## Progress

The TypeScript library build still emits TypeScript. Its package metadata now points to `index.mjs`, the runtime entry produced by TypeScript compilation. The existing consumer test compiles a copy of the output, installs it under `node_modules`, checks declarations, and imports the package root by name. The README states that authors must compile before installation or publication and retain the metadata, declarations, and helpers.

The completed TypeScript-output issue ISS_3B960MY2FQ96JSA9XHW7H49XSQ requires compilation and execution and requires the selected output language. PLAN_ENTRY_6SXGG7QE0T97GTPY0GFNTEFDC1 selects one output language per build. Node 24.22.1 rejects type stripping for `.mts` files under `node_modules`; the old package entry therefore failed after compilation.

## Evidence

- `FORCE_COLOR=0 node --test --test-name-pattern='ordinary JavaScript and TypeScript consumers import named nodes from the library package root|selects the library output language on each CLI build|builds executable TypeScript library modules with shared exports' test/cli.test.mjs`: 3 passed.
- `FORCE_COLOR=0 node --test --test-name-pattern='stages computed local imports without copying test tooling|computed relative imports cannot load files outside staged local dependencies|computed imports in staged helpers cannot leave the staged project|preserves relative imports of local JavaScript dependencies|TypeScript program bundles preserve local and package initialization order' test/cli.test.mjs`: 2 passed and 3 failed. A computed-only helper was not staged (`ERR_MODULE_NOT_FOUND`); computed `import` and `require` in a staged helper reached a file outside the staged project; the separate program-bundle test rejected external import evaluation order.
- Independent read-only review found no defect in the compiled package-root change and no test surplus. It identified the helper failures as material risks. A guard for arbitrary helper code can change existing import and require behavior; no approved helper-containment policy was found. The README's computed-only staging restriction is not a tracked decision.
- REFACTOR: no justified change; the metadata fix is one expression and the existing consumer test covers both languages.

## Remaining Work

The issue remains in progress. Resolve the computed-helper staging and containment contracts before changing their behavior. Do not copy unknown files or development tooling silently, and do not claim a sandbox. The program-bundle failure belongs to separate work.