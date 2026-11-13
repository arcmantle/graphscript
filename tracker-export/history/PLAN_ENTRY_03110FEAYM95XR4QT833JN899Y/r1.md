The existing design sets these boundaries for library output:

- A graph node is one function, class, or shared state object. Each node has one source file and exports only its primary node.
- The program-start file is the only program root. Each program-start file gets one entry bundle. A dynamic import of a new node emits a separate bundle for that node and its reachable graph.
- A build with no program-start file is a library build. More than one program-start directive is an error.

These facts come from the decisions in [Define graph nodes and dependencies](ISS_43YTB2BDST9WVVVNGXPMABZ0YN), [Define compilation and output](ISS_536KZ0SMFQ83HREJE2Y9A429Y5), and [Define program-start file validation](ISS_6XSZCZP7A59QP8GES27Y6QY9TV).