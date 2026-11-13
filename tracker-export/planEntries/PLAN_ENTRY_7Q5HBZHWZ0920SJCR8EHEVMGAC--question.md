## Tool installation

How must developers install the first-release compiler and VS Code graph explorer?

Options:
- Publish the compiler and CLI together as an npm package installed as a project development dependency. Publish the explorer separately as a VS Code extension. The extension uses the project's compiler version.
- Include a compiler in the extension and provide a separate CLI installation. This reduces initial editor setup but can give editor and command-line operations different compiler versions.
- Provide standalone compiler downloads in addition to, or instead of, npm installation. This requires another distribution and update process.

Recommendation, not an approved decision: use one project-local npm package for the compiler and CLI, plus a separate VS Code extension that uses the project's compiler version. This keeps editor and command-line behavior consistent. Exact package names, extension distribution channel, supported hosts, and version compatibility remain open.