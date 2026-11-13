## Ticket type

grilling

## Question

How does a GraphScript import identify a function through the common alias, and how are name collisions and renames handled?

## Resolution

[GraphScript design plan](PLAN_6T5CSA42KH8DGBT7GNTBRM43GJ): Imports use readable function names mapped to stable IDs. Names are unique across the project. Renames update imports and source files.