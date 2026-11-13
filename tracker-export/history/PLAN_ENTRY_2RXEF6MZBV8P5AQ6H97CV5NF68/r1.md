## Question
How should the compiler lay out output files to reduce file count?

## Recommendation
Write one bundle for each build. Put all selected roots and their reachable GraphScript nodes in that bundle. Keep external package imports as imports.