## Q3: Version policy and publication metadata

Must exact supported versions and publication identifiers be selected during specification, or can they be fixed through explicit release checks before publication?

Recommendation: Set the support policy now and require exact values before publication. Select a maintained Node.js LTS line, a stable TypeScript 7 compiler version, a tested desktop VS Code range, and an explicit extension-to-compiler compatibility range. Record and test lower bounds and selected current versions; do not imply support for untested future major versions. Fix npm package identifiers, CLI command names, extension and publisher identifiers, release versions, license, and required package metadata before publication. Verify ownership and artifact installation during implementation. Do not treat those checks as already passed.

Alternative: Fix exact values now, which removes release-time selection but can require specification changes when dependencies change before implementation.