## Work Mode

AFK

## Outcome

A developer can control graph depth and inspect direct dependencies without relying on a dense full-graph view.

## Scope

- Provide depth choices 1, 2, and 3 and a full-graph option.
- Provide a separate direct-dependency list for the selected node.
- Keep selected-node identity and source navigation consistent between views.
- Use the approved content-hub behavior as a reference, not a required library or extra feature list.

## Acceptance Criteria

- A known multi-level graph fixture shows the expected node set at each depth and in full-graph mode.
- The default remains depth 1.
- The direct-dependency list excludes indirect-only dependencies and matches the compiler graph.
- Selecting a listed dependency opens the correct source.
- Automated editor workflows verify these controls with a dense graph fixture without requiring unrelated content-hub features.