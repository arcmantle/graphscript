## Work Mode

AFK

## Outcome

Local graph imports resolve readable names to stable node identities rather than lasting source paths.

## Scope

- Provide the project-wide node index and one common alias for local graph imports.
- Resolve function, class, and state-node names to stable IDs.
- Enforce unique names across all node kinds during creation and source checking.
- Preserve identities when valid source is read again. Report inconsistent identity data instead of silently assigning new identities.

## Acceptance Criteria

- Automated CLI and compiler fixtures resolve imports for each node kind through the documented common alias.
- Repeated reads of the same valid project retain each existing node ID.
- A duplicate name across any two node kinds is rejected with a clear diagnostic.
- An import uses readable identity rather than requiring the managed file path.
- Inconsistent or missing required identity data is reported without source rewriting or replacement identities.