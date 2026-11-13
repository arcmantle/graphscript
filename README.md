# graphscript
TypeScript development tools with a graph model instead of a file model. Node.js first.

## Requirements

Use Node.js 24.11.0 or later and npm. The package uses TypeScript 7. Install the locked dependencies with `npm ci`.

The first release targets local CLI and desktop VS Code on macOS 26.7.2 on arm64 with Node.js 24. The package permits Node.js `>=24.11.0`, but later major versions are outside the first-release support guarantee. The selected versions are TypeScript `7.0.2`, VS Code `^1.105.0`, and GraphScript compiler `^0.1.0`. These targets have not yet passed the required release compatibility checks.

The compiler package is `@arcmantle/graphscript`, and its command is `graphscript`. The extension identifier is `arcmantle.graphscript-explorer`. Both packages use version `0.1.0` and the Apache-2.0 license. The maintainer has confirmed publishing access to both identifiers. CI token permissions and publication are not yet verified.

## Projects

From an empty project directory, run the CLI with the path to this package's `src/cli.js`:

```sh
node /path/to/graphscript/src/cli.js init --library # or --program
node /path/to/graphscript/src/cli.js create function greet
node /path/to/graphscript/src/cli.js create class Account
node /path/to/graphscript/src/cli.js create state settings
node /path/to/graphscript/src/cli.js rename greet welcome
node /path/to/graphscript/src/cli.js delete greet
node /path/to/graphscript/src/cli.js check
node /path/to/graphscript/src/cli.js build
node /path/to/graphscript/src/cli.js build --library
node /path/to/graphscript/src/cli.js build --library --language typescript
```

The package also provides the `graphscript` executable when installed as a dependency. Run the commands from the project directory.

Program setup creates `nodes/main.ts` with the first-statement directive `"graphscript:program";`. The program-start file can contain ordinary code and imports from `@graph`; it is not a graph node and does not need a node ID or primary export. A program has exactly one such file. `check` reports multiple candidates and rejects misplaced GraphScript directives. Automatic builds select program mode when one program-start file exists and library mode when none exists. A program build emits `dist/main.mjs` for JavaScript or `dist/main.mts` for TypeScript. Run the JavaScript output with Node.js. Compile TypeScript output before running it. Use `build --library` to emit all graph nodes from a program project without emitting or running its program-start file.

Program output includes the reachable graph and does not run the program during the build. A build may emit internal modules alongside the entry file; keep those modules with the entry. External packages must be available to the output at runtime. Both output languages support graph cycles. TypeScript output retains type annotations and supports graph-node top-level await in supported forms. Some import, cycle, and top-level-await forms are not yet supported and cause a build error. Dynamic GraphScript imports need separate bundle support and are not yet supported.

For supported graph and package imports, program output uses native modules to preserve their initialization order. Other import forms can still cause TypeScript program builds to reject an external import after local module setup.

The `nodes` directory contains the authoritative TypeScript source. Each node has a file named after its primary export and a `// graphscript:id <uuid>` identity comment. Keep the ID when editing the source. Library setup does not create a program-start file. Creation rejects invalid names and does not overwrite existing files, including files for other node kinds.

`rename <name-or-id> <new-name>` changes the node name and matching filename, preserves the ID, and updates resolved `@graph` references in managed source. It refuses duplicate names, unsafe namespace references, and detected file conflicts. Save all managed source before running the CLI: the CLI reads files on disk and cannot detect unsaved editor buffers. If rollback also fails after a filesystem error, the error gives the location of the retained recovery files.

Integrations can call `renameNode(projectDirectory, { name, newName, unsavedFiles })` from `src/protected-edit.js`. Pass the paths of all unsaved documents in `unsavedFiles`; the operation refuses unsaved managed source, including paths through symbolic links. The result contains the preserved `id` and the new `file` path.

`delete <name-or-id>` removes an unreferenced node. It reports source references and refuses unresolved dynamic graph access, conflicting files, and unsafe source paths. It scans project JavaScript and TypeScript source except `.git`, `node_modules`, and the root `dist` output. It does not provide a force option or remove dependent source. Save all project source before running the CLI; the CLI cannot detect unsaved editor buffers. Filesystem checks are not atomic; other processes can change source during validation or deletion.

Integrations can call `deleteNode(projectDirectory, { name, unsavedFiles })` from `src/protected-edit.js`. Pass all unsaved source paths in `unsavedFiles`. A caller that omits an unsaved path does not get unsaved-buffer protection. If rollback fails, the error gives the location of the retained recovery file.

Import local nodes by their unique primary-export names from `@graph`:

```ts
import { greet, Account, settings } from '@graph';
```

Use package imports for external runtime libraries. Relative runtime code imports and `file:` URL imports in GraphScript source are not allowed. This rule does not apply to imports inside external packages or imports generated by the compiler. It is not a sandbox.

The graph index maps each name to its node ID. IDs must be valid UUIDs and unique within the project. `check` reports missing, invalid, or duplicate IDs and duplicate names; it does not assign replacement IDs or rewrite source. Restore the correct identity data before continuing.

Compiler integrations can call `readGraph(projectDirectory)` from `src/graph.js`. It returns `{ nodes, imports, namespaces, edges }`: nodes have `id`, `name`, `kind`, and `file`; named `@graph` imports have `fromId`, `name`, and `toId`. Static namespace and literal dynamic imports have `fromId`, `kind`, `localName` (null for dynamic imports), and a `targets` list of available names and IDs, not a list of members used by the source. Each runtime edge has `fromId` and `toId`, from the dependent node to the node it uses. A state edge also has the exact `property` and an `access` of `read` or `write`. An operation that reads and writes a property produces one edge for each access. A nested mutation such as `appState.settings.theme = value` reads and writes the top-level `settings` property. Repeated references produce one edge per target, property, and access. Type-only references and unused imports do not produce edges. The analyzer resolves named imports, statically named namespace members and destructuring, direct or locally bound awaited literal imports, and references to a node's own primary declaration. It does not resolve all dynamic uses or report an exact property for an unresolved access. Invalid nodes, inconsistent IDs, duplicate names, and unknown named imports cause an error.

Call `watchGraph(projectDirectory, onUpdate)` from `src/graph.js` to detect saved changes in the `nodes` directory. After changes, `onUpdate` receives `{ graph }` or `{ error }`. Read the initial graph with `readGraph`; the watcher does not publish an initial graph. If `nodes` is absent at startup, the watcher reports an error and continues watching for the directory. The watcher reads saved files only and does not change source or assign IDs. Call `close()` on the returned watcher when updates are no longer needed.

Each node file must start with one node-kind directive: `"graphscript:function";`, `"graphscript:class";`, or `"graphscript:state";`. The directive is a standalone string-literal statement. Single or double quotes are permitted, and the semicolon is optional. Whitespace and comments can precede it, but imports and other statements cannot. Use the exact directive text without escapes. A second top-level `graphscript:` string statement is not permitted, even after the primary export. Text in comments is not a directive.

A function node directly exports one named function declaration; a class node directly exports one named class declaration; and a state node directly exports one named variable initialized with an object literal. A state object can contain multiple properties. TypeScript assertions such as `as const` and `satisfies` can wrap the object literal. Default exports, export lists, re-exports, and additional top-level exports are not permitted. Private top-level runtime declarations, including functions, classes, variables, enums, and namespaces, are not permitted. Imports and private type-only or ambient declarations are permitted.

`check` reads the saved `.ts` files in `nodes`, reports GraphScript rule errors and TypeScript diagnostics, and does not emit output. It uses the TypeScript source tree to check node rules and construct the temporary alias index, including when graph analysis cannot parse a file. An analysis gap produces a source-located warning; it does not skip node-rule checks. The check uses strict checking, the NodeNext module mode, and the ESNext target. It does not use a project `tsconfig.json`. It creates the alias index outside the project and removes it after the check.

Compiler integrations can call `checkProject(projectDirectory)` from `src/check.js`. It returns `{ ok, diagnostics, mode, programStart }`; `mode` is `program` or `library` when selection is unambiguous, and `programStart` is present only for a single program-start file. Each diagnostic has `severity`, `source` (`typescript`, `graphscript`, or `analyzer`), and `message`. Source-located diagnostics also have `file`, `line`, and `column`; TypeScript diagnostics have a numeric `code`. Compiler and GraphScript errors set `ok` to false. Analyzer warnings identify unresolved graph or state uses without failing the check. Type-only references and unused imports do not produce analyzer warnings. The CLI uses the same result. `initializeProject(projectDirectory, { kind: 'program' })` or `{ kind: 'library' }` from `src/project.js` provides shared setup. `createNode(projectDirectory, { kind, name })` creates a node and returns its source path.

`build --library` checks the project and emits each node as an ESM file in `dist`. JavaScript is the default output. Use `--language javascript` or `--language typescript` to select the output language for each build. TypeScript output includes an entry with named node exports and uses ESM module specifiers that TypeScript can resolve when it compiles the output. Use TypeScript 7 with NodeNext module resolution. Output that uses Node `require` also needs Node type declarations enabled in the TypeScript configuration.

Node setup runs when its module first loads; subsequent imports in the same runtime share its exports. Namespace and dynamic graph imports use a generated graph module, which loads the graph nodes as ESM dependencies. External packages remain imports or Node `require` calls and must be available to the output at runtime.

External packages are not copied and must be installed by the consumer.

Compile TypeScript output before using it in Node.js. Keep the generated `package.json`, declarations, and JavaScript helpers with the compiled modules. The package entry points to the compiled `index.mjs`. Node.js does not execute TypeScript files inside `node_modules` directly.

Library builds copy the source `package.json` metadata into the output and add the package-root entry and declarations. Declare runtime and peer dependencies in the source manifest; the build does not bundle them or infer peer dependencies. The source manifest is not changed. A conflicting root export, `main`, `types`, or `typings` field stops the build. Builds track the output manifest and reject changes to it on a later build. Publication requires valid package metadata and the separate release checks.

Compiler integrations can call `buildLibrary(projectDirectory, { language: 'typescript' })` from `src/build.js`. Omit the option for JavaScript, or set it to `javascript`. It returns the same `{ ok, diagnostics }` result as `checkProject`; filesystem and emit failures throw. Compiler errors and GraphScript rule errors prevent emission, while analyzer warnings do not. The build tracks generated files in `dist/.graphscript-build.json`. Repeat builds replace unchanged generated files and remove obsolete generated files, but refuse to overwrite unrelated files, hard-linked output, or generated files that were changed after the previous build.

## Validation

Run the CLI workflow tests with:

```sh
npm ci
npm test
```

Run the focused runtime graph tests with `npm run test:graph`. The tests create and remove clean temporary projects. They check library setup, node creation, source identity, non-emitting checks, source rules, invalid TypeScript, creation conflicts, and runtime graph edges.

See [persistent node file measurement](benchmarks/README.md) for the repeatable performance command and recorded results.

## VS Code Extension

The separate desktop extension is in `extension`. Run `npm ci --prefix extension` to install its dependencies. Open a GraphScript project folder in a trusted VS Code workspace. The extension checks for `node_modules/@arcmantle/graphscript` in each folder that has a `nodes` directory. It reports a missing or unsupported compiler and keeps ordinary editing available. It does not install or replace the compiler. Use **GraphScript: Check Project Compiler** to check again after a manual installation or version change.

To set up a project, open a folder with the project-local GraphScript compiler installed and run **GraphScript: Set Up Project**. Select **Program** or **Library**. Run **GraphScript: Create Node** to create a function, class, or state node. Both commands are also available from the Explorer workspace-root context menu. The new node opens as a TypeScript file.

Open a function node and run **GraphScript: Open Function Graph**, or select the command from the file or editor context menu. The view uses the project-local compiler's graph of saved source files. It shows the function and its immediate incoming and outgoing dependencies. Select a node to open its source file.

The open graph refreshes after saved node changes, including changes from Git operations. Unsaved editor changes are not used or overwritten. If saved source or identity data is invalid, the view reports the error and keeps the last valid graph. Correct the source to resume updates; the extension does not repair it or assign replacement IDs. If the selected node is removed, restore it or select another node.

Marketplace publication requires separate ownership, compatibility, and supported-host checks.

Run the resolver test with `npm --prefix extension test`. Run the desktop extension-host fixtures with `npm --prefix extension run test:host`. Set `VSCODE_EXECUTABLE` to the VS Code executable when it is not at the default macOS path.
