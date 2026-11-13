## Work Mode

AFK

## Outcome

The graph identifies the exact shared-state property used by a node and distinguishes read access from write access.

## Scope

- Extend runtime graph analysis to shared-state objects.
- Represent state-node identity, property identity, and read or write access in the graph contract.
- Keep different properties of the same state object distinct.
- Use the same static-resolution limits as other managed dependencies.

## Acceptance Criteria

- Graph fixtures distinguish reads of one state property from reads of another property.
- Writes and accesses that both read and write are represented correctly.
- State edges resolve to the stable ID of the state node and the exact property.
- Type-only and unused references remain absent.
- Unresolvable access is not represented as a falsely exact property edge.