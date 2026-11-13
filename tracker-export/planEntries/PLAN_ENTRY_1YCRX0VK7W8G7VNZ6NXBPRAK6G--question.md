## Extension compiler compatibility

What must the VS Code extension do when the project compiler is missing or outside its supported version range?

Recommendation, not an approved decision: declare a supported compiler-version range, check the project compiler, and report a clear installation or compatibility error when it cannot be used. Do not silently download, install, upgrade, or substitute a compiler. Keep ordinary source editing available, but disable GraphScript operations that require the unavailable compiler.

An explicit user-approved setup action can install a compiler. The alternative is an automatic or bundled fallback, which reduces setup steps but can make editor behavior differ from the project's command-line build. Exact supported versions are release metadata, not fixed by this question.