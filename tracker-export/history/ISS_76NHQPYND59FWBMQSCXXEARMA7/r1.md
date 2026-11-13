## Work Mode

AFK

## Outcome

Publication cannot proceed when any required release check is missing, failed, or tied to different artifacts.

## Scope

- Provide a repeatable release-evidence check for the approved contract, workflow, installation, consumer, compatibility, performance-measurement, and manual-review requirements.
- Bind the evidence to exact compiler and extension artifacts and tool versions.
- Distinguish required passing checks from the existence of the required performance measurement without inventing a numeric performance target.
- Report missing, failed, or stale evidence and leave publication blocked. Planning approval and completed issue status do not substitute for evidence.

## Acceptance Criteria

- A complete evidence fixture for the exact release artifacts passes the release check.
- A missing required check, a failed check, or evidence for a different artifact causes a failing result.
- A missing manual review or unsupported declared host combination prevents publication.
- The release check preserves failures from all required validation steps and does not hide them behind a later success.
- The recorded output identifies what passed, what failed, and what remains missing without claiming publication has already occurred.