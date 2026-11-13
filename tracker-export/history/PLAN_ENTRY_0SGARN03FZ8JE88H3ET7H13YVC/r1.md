## Question
For a static GraphScript program build, must exactly one source file have the first-statement `"graphscript:program";` directive? If no file has the directive, should the compiler report an error or infer a start file? If more than one file has it, should the compiler report an error or create a separate program output for each file? Dynamic-import builds already use separate bundles and need no program directive.

## Recommendation
Require exactly one program-start file for a static program build. If the compiler finds none or more than one, stop and report a clear diagnostic. For multiple files, list the candidate paths. Do not infer a start file or create multiple program outputs. Keep the existing exemption for dynamic-import builds.