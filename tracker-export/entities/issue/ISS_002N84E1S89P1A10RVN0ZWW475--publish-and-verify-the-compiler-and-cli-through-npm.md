## Work Mode

HITL

## Outcome

The approved compiler and CLI artifact is available through npm and can be installed as a project-local development dependency.

## Scope

- Obtain explicit maintainer approval for publication after the required evidence check passes.
- Publish the exact approved compiler and CLI artifact under the confirmed npm identifier and version.
- Verify registry availability and clean project-local installation of the published version.
- Use the maintainer's approved authentication path without exposing secrets. Do not substitute an archive-only release.

## Acceptance Criteria

- The required evidence check passes for the exact artifact selected for publication.
- A maintainer explicitly authorizes publication using the confirmed package identity and version.
- The npm registry serves the published artifact, and a clean project can install and use its compiler and CLI.
- Published metadata matches the approved identifiers, version, license, dependency declarations, and supported limits.
- The publication record identifies the released artifact and verification result without claiming unsupported hosts.