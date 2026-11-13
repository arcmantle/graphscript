## Published library imports

How must consumers import graph nodes from a published GraphScript library?

The approved library-output rule emits every graph node as a separate module and makes each node available by its unique GraphScript name. An index file is not an approved requirement.

Options:
- Expose package subpaths, such as example-library/calculateTotal, through package exports. Each subpath identifies one node module.
- Expose nodes as named exports from a root index, such as calculateTotal from example-library.
- Provide both package subpaths and root named exports. This provides two import forms but requires rules for both public interfaces.

Recommendation, not an approved decision: require package subpaths based on node names and do not require a root index in the first release. This follows the separate-module rule and avoids an additional public interface. Exact export syntax, declaration files, metadata generation, and rename compatibility remain open.