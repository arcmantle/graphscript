## Decision

GraphScript generates output package metadata for the ESM package-root entry and TypeScript declarations. Preserve the project's user-authored package name, version, license, dependency declarations, and other metadata. Do not silently change the source package manifest during a build. Report conflicts that prevent valid output.

Exact output file layout is an implementation detail.