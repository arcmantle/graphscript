## Decision

Both program projects and library projects support an explicit library-output build. Developers do not need to remove the program directive to request this output.

This build emits graph-node modules for normal imports. It does not use the program-start file as the build root or execute that file. External tests can import individual nodes and use an ordinary test runner.

The automatic build choice remains unchanged: a program-start file selects a program build unless the developer explicitly requests library output.

Exact command syntax, output location, and package scripts remain open.