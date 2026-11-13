## Decision

The VS Code extension declares a supported compiler-version range and checks the project compiler. If the compiler is missing or unsupported, report a clear installation or compatibility error. Do not silently download, install, upgrade, or substitute a compiler.

Keep ordinary source editing available. Disable GraphScript operations that require the unavailable compiler. An explicit user-approved setup action can install a compiler. Exact supported versions are release metadata.