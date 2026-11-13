## Decision
For a static program build, exactly one source file must have the first-statement `"graphscript:program";` directive. If no file has the directive, treat the build as a library build. If more than one file has the directive, stop and report an error that lists the candidate paths. Dynamic-import builds remain exempt and need no program directive.

## Source
[Define program-start file validation](ISS_6XSZCZP7A59QP8GES27Y6QY9TV)