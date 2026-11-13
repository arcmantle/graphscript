## Question

Which conditions must stop a first-release build, and which conditions must produce warnings only?

## Known boundary

Valid TypeScript or JavaScript syntax stays valid when the graph analyzer cannot show a static edge.

## Recommended answer

Stop the build for compiler errors and GraphScript contract violations. Show analyzer gaps as warnings with source locations; do not treat them as language errors.