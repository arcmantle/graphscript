## Progress

Added the approved relative runtime import rule to project checks, graph reads, and emitted library and program code. External package imports, type-only imports, and locally bound functions remain supported. Updated the package-root consumer fixture and replaced obsolete runtime-helper fixtures with graph-node coverage.

Two independent read-only reviews identified require aliases, optional calls, graph validation, and URL-based imports. Added focused fixes and checks for the identified loader forms and for known or directly constructed relative URLs. A computed URL stored before an import can still resolve to a file URL without the rule error. PLAN_4F6XRW4N7Q9ZRR0603DMY9DGFT records the open file-URL policy question.

REFACTOR: shared the Node loader binding check and the program guard expression; removed obsolete helper-only tests while retaining graph-node and type-only coverage.

## Evidence

- The final focused CLI run passed 15 tests, including JavaScript and TypeScript package-root consumers and relative import checks.
- The final graph analyzer run passed 20 tests.
- The last full suite reported 215 passed, three failed, and one skipped. Two failing fixtures were corrected and passed focused reruns. The third still reaches the existing TypeScript program external import evaluation-order guard after conversion to graph nodes. The full suite was not rerun after these changes.
- VS Code reported no errors in the changed source or test files.