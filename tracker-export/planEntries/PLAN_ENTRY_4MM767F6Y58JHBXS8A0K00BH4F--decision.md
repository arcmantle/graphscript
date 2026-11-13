## Decision

Publish the compiler and CLI together as an npm package installed as a project development dependency. Provide the graph explorer as a separate VS Code extension. The extension uses the project's compiler version.

Do not require a separate global compiler installation. Exact package names, extension distribution channel, supported hosts, and version compatibility remain open.