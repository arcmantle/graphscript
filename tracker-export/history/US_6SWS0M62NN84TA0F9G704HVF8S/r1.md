As a library author, I want GraphScript library output that ordinary JavaScript and TypeScript projects can import, so that consumers do not need GraphScript or its internal file layout.

## Acceptance Criteria

- A project with no program-start file builds as a library automatically.
- Both program and library projects can explicitly request library output. This does not require removal or execution of the program-start file and does not use it as a build root.
- Library output includes every graph node as a separate module, one generated package-root entry with named exports by unique readable node name, and generated TypeScript declarations.
- Builds support the selected TypeScript or JavaScript output language. JavaScript library output uses ESM only.
- Ordinary JavaScript and TypeScript consumers can import package-root named exports without installing GraphScript, using a GraphScript resolver, or knowing internal node-module paths.
- External runtime packages remain imports. Runtime and peer dependencies use normal user-authored metadata. GraphScript does not infer a peer-dependency policy or copy development tooling into runtime dependencies.
- Required output metadata connects the package-root entry and declarations. User-authored name, version, license, dependencies, and other metadata are preserved. Builds do not silently change the source manifest and report conflicts that prevent valid output.

## Boundaries

- No separate CommonJS output tree or conditional CommonJS package entry is required.
- ESM library output does not remove approved CommonJS require() support for external imports in source.
- Internal node-module layout remains an implementation detail. Program bundling is not changed by the library dependency policy.