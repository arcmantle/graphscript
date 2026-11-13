## Work Mode

AFK

## Outcome

A developer can create class and shared-state nodes with the same persistent source contract as function nodes.

## Scope

- Extend CLI node creation and source validation to classes and shared state.
- Require one node-kind directive and one matching primary export per managed source file.
- A state node exports one object that can contain multiple shared values.
- Reject additional top-level exports and managed runtime definitions that violate the one-node-per-file contract. Document node-kind directive parsing and placement without treating planning examples as fixed syntax.

## Acceptance Criteria

- Parameterized creation and check tests pass for function, class, and state nodes.
- Each created file has the correct primary export kind and readable filename in the managed directory.
- A state object with multiple properties is accepted.
- Missing or mismatched directives, wrong export kinds, extra top-level exports, and unmanaged private runtime definitions produce GraphScript rule errors.
- The accepted node-kind syntax and placement rules are documented and tested.