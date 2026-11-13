## Decision
For a library build with no program-start file, emit every graph node as a separate library module. Consumers import each node by its existing unique GraphScript name.