## Q1: Release checks and evidence

Which checks must prevent publication, and which evidence must each check provide?

Recommendation: Require automated checks for the agreed language, graph, compiler, CLI, diagnostics, and protected-edit contracts. Require clean-install checks with the actual npm package and extension package, ordinary JavaScript and TypeScript library consumers without GraphScript, and automated VS Code workflow checks with a recorded manual review. Keep results tied to the exact release artifacts and tool versions. A missing or failed required check prevents publication. Planning defines the checks; it does not claim that they passed.

Alternative: Accept a manual demonstration for the first release. This costs less initially but gives weaker repeatability and regression evidence.