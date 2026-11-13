## Published library entry

Must a published GraphScript library provide one package-root entry with named exports and generated TypeScript declarations, usable without GraphScript in the consuming project?

The approved local source model already uses a common alias and resolves readable node names through stable IDs. Do not reopen that decision. The user requires one public import location rather than a separate subpath for each node.

For example, an ordinary consumer could use import { calculateTotal, Cart } from "example-library". The compiler generates the entry and declarations, while separate emitted node modules remain an output detail.

Recommendation, not an approved decision: provide the package-root entry and declarations. Consumers use ordinary JavaScript or TypeScript tools and do not need GraphScript to resolve graph IDs. Requiring GraphScript in consumers would add a tool dependency. This question does not propose merging external packages into the project's local graph alias.