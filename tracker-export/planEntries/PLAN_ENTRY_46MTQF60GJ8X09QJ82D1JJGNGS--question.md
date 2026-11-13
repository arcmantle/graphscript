## Question
Which initialization effects must a build keep, and in what order?

## Recommendation
Keep the effects in the selected roots' dependency closure. Run each effect once, in dependency order. Do not run effects from unused units.