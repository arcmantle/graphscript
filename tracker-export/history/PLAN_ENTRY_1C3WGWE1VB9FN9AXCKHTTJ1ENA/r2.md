## Content-hub graph reference

The content-hub client uses `force-graph` 1.52.0. Its graph view shows the selected document and its nearby connections by default. It has depth controls for 1, 2, or 3 links, an option to show the full graph, an option to show unresolved links, and a separate list of direct connections grouped by kind. Selecting a graph node or list item opens that document. Hover highlights the node and its neighbors. The view sizes high-degree nodes with a logarithmic rule and curves backlink edges. The reviewed code does not show cycle detection or cycle highlighting.

This is a behavior reference, not a decision to use the same library.

## Sources

- [Force graph component](https://github.com/eye-share/content-hub/blob/4c7cb07a1c5927a3e35a5579809abaf8d66293c7/client/application2/src/components/force-graph.cmp.ts)
- [Atlas view](https://github.com/eye-share/content-hub/blob/4c7cb07a1c5927a3e35a5579809abaf8d66293c7/client/application2/src/pages/preview/components/preview-atlas.cmp.ts)
- [Graph model](https://github.com/eye-share/content-hub/blob/4c7cb07a1c5927a3e35a5579809abaf8d66293c7/client/application2/src/features/preview/preview-graph.ts)
- [Connection list](https://github.com/eye-share/content-hub/blob/4c7cb07a1c5927a3e35a5579809abaf8d66293c7/client/application2/src/pages/preview/components/preview-connections.cmp.ts)
- [Graph model tests](https://github.com/eye-share/content-hub/blob/4c7cb07a1c5927a3e35a5579809abaf8d66293c7/client/application2/src/features/preview/preview-graph.test.ts)