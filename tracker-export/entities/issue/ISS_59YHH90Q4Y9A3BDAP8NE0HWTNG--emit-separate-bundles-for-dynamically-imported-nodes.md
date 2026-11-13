## Work Mode

AFK

## Outcome

A dynamic import of a new GraphScript node loads a separate bundle for that node and its reachable graph.

## Scope

- Resolve managed-node dynamic imports during program compilation.
- Emit the dynamically imported node and its reachable graph as a separate bundle.
- Keep the dynamic node separate from program-start root validation.
- Preserve ordinary dynamic import behavior and the approved initialization contract.

## Acceptance Criteria

- An executable program fixture dynamically imports a managed node from a separate emitted bundle.
- The dynamic node has no program-start directive and is not treated as an additional program entry.
- The bundle contains the dynamic node's reachable graph without unrelated nodes.
- Repeated imports preserve shared exports and once-only setup per runtime instance.
- Both supported output-language paths retain valid dynamic import behavior.