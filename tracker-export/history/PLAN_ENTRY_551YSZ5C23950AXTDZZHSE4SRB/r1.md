## Question
How will automatic root detection identify root functions?

## Recommendation
Treat each function that no other project function uses as a root. Require an explicit root marker for a project that has no such function, such as a cycle or a library.