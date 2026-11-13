## Work Mode

AFK

## Outcome

Every declared supported host and tool-version combination has test evidence for the actual release artifacts.

## Scope

- Run the declared macOS and processor combinations with the approved Node.js, TypeScript, and desktop VS Code ranges.
- Verify extension-to-project-compiler compatibility, including unsupported and missing compiler cases.
- Use the actual npm and extension artifacts produced for release validation.
- Record exact host, architecture, tool versions, artifact identities, results, and missing evidence.

## Acceptance Criteria

- Every declared supported macOS and processor combination has a recorded validation result.
- Tests exercise the supported version limits and the declared extension-to-compiler range.
- Missing or unsupported compilers produce the approved error and preserve ordinary source editing.
- Evidence identifies the exact artifacts and tool versions rather than only a source revision.
- An unavailable or failed required combination remains an explicit release blocker; it is not silently marked passed or removed from the declared matrix.