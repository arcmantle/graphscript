## Work Mode

HITL

## Outcome

The release has explicit approved identifiers, legal metadata, supported host combinations, and compatibility ranges ready for artifact verification.

## Scope

- Confirm npm package identifiers, CLI command names, extension and publisher identifiers, release versions, license, and required package metadata.
- Verify identifier ownership and obtain maintainer approval for values that require human authority.
- Declare supported macOS versions and processor architectures, exact Node.js 24 and TypeScript 7 limits, desktop VS Code range, and extension-to-compiler compatibility.
- Keep other hosts and major versions outside the first-release guarantee. Do not treat metadata approval as passing installation or release evidence.

## Acceptance Criteria

- All required metadata has explicit values and no unresolved authored placeholders.
- Identifier ownership is verified without exposing credentials or assuming account access.
- A maintainer approves the selected identifiers, license, host combinations, and version ranges.
- Supported Node.js and TypeScript combinations remain within the approved major versions.
- Supported combinations are declared for testing, and no untested combination is described as validated.

## Notes

The user approved npm package `@arcmantle/graphscript`, CLI command `graphscript`, Marketplace publisher `arcmantle`, extension name `graphscript-explorer`, Apache-2.0, and version `0.1.0` for both packages. The selected target is macOS 26.7.2 on arm64 with Node.js 24, TypeScript `7.0.2`, VS Code `^1.105.0`, and compiler `^0.1.0`. The user selected the package engine range `>=24.11.0`; later Node.js majors are installable but outside the first-release support guarantee. These approvals are not compatibility or publication evidence.

The user confirmed that an npm account can publish to the `@arcmantle` scope and a Marketplace account can publish as `arcmantle`. This is a maintainer attestation; the CI token permissions have not been tested. The scoped npm package returned 404 to an unauthenticated lookup.

The user selected tag-triggered CI with a protected environment and no manual publication. Existing organization workflows use `NPM_PUBLISH` for npm and `VS_MARKETPLACE_PAT` for Marketplace. Both secret names are available to this repository as organization secrets. The repository has no release environment. The artifact-specific release evidence gate is not implemented. Do not enable publication before the gate and required approval are in place.

The independent review found a Node.js minimum mismatch and a missing compiler-name test. The engine range and test were updated. The full package suite reported 231 passed, three failed, and one skipped: the failures concern TypeScript program-bundle initialization order and computed local helper staging and containment. The focused compiler resolver tests passed. These checks are not release artifact evidence.