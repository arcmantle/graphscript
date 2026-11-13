## Work Mode

AFK

## Outcome

Maintainers can run the complete implemented language, compiler, CLI, protected-edit, and VS Code workflow checks through repeatable release validation commands.

## Scope

- Collect the focused tests delivered with behavior slices into repeatable release validation entry points.
- Cover language, graph, compiler output, CLI diagnostics, source updates, and protected edits.
- Run automated VS Code workflows for creation, navigation, controls, cycles, updates, edits, and check or build operations.
- Preserve failure results and report missing required suites. Do not replace focused public-interface tests with source-shape assertions.

## Acceptance Criteria

- Documented validation commands run all required implemented contract and editor-workflow suites from a clean checkout.
- A deliberately failing required check produces a failing overall result rather than being hidden by a later successful check.
- The report identifies executed suites, failures, and required checks that did not run.
- Automated editor workflows verify observable behavior rather than only internal data or mocked command registration.
- Validation is repeatable and does not claim that later artifact, host-matrix, or manual checks have passed.