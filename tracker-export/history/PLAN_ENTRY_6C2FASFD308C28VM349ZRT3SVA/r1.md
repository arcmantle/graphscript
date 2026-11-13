## Package metadata ownership

Must GraphScript generate the output package metadata needed for the agreed ESM package-root entry and TypeScript declarations, while preserving user-authored project metadata?

Recommendation, not an approved decision: generate the required entry, module-format, and declaration metadata in the output package. Preserve the project's package name, version, license, dependency declarations, and other user-authored metadata. Do not silently overwrite the source package manifest during a build. Report conflicts that prevent valid output.

The alternative is to require developers to maintain output entry mappings manually. This reduces generated metadata but can leave mappings inconsistent after node changes. Exact file layout is an implementation detail.