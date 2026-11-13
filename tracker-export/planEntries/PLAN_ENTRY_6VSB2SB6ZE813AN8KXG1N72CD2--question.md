## Question
When the program-start file uses a function from another GraphScript file, should top-level code in that file run when it loads?

## Example

`program.ts`:

```ts
"graphscript:program";
import { start } from "./start";
start();
```

`start.ts`:

```ts
console.log("start.ts loaded");
export function start() {
  console.log("start() called");
}
```

In standard TypeScript or JavaScript modules, the first message appears when the import loads `start.ts`. The second appears when `start()` runs. The import syntax here is an example, not a GraphScript syntax decision.

## Recommendation
Follow TypeScript and JavaScript module behavior. Run each imported file's top-level code once when it loads. Run a function body only when the program calls it.