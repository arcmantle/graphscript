## Work Mode

AFK

## Outcome

Maintainers have repeatable measurements of TypeScript behavior for a representative project that uses persistent per-node source files.

## Scope

- Provide a representative managed project with function, class, state, and dependency cases.
- Measure TypeScript checking and graph-analysis behavior for the selected one-file-per-node model.
- Record project size, measurement method, host, and tool versions.
- Keep the approved persistent-source model and do not invent a numeric performance acceptance target.

## Acceptance Criteria

- A documented command repeats the measurement with a known project shape and node count.
- The fixture uses real persistent managed files rather than a single-file source projection.
- Results identify the host and exact tool versions and separate measured facts from unsupported performance claims.
- The measurement completes and records its results for release review.
- No arbitrary numeric performance threshold or architecture replacement is introduced as a planning requirement.