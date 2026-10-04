---
"@kumikijs/mcp": patch
"@kumikijs/cli": patch
---

`kumiki_remove` says a cascade takes the definitions that reference the target

The tool description said `cascade=true` also removes "definitions that only it
referenced", which reads as the target's own dependencies. A cascade removes the
opposite set: the target's dependents, every definition that references it,
directly or transitively. An agent that followed the description to tidy up a
type it thought nothing else needed lost the rest of the app:

```
kumiki_remove :: Remove a definition. Set cascade=true to also remove definitions that only it referenced. …
removed type.N  (op_…)
  cascaded app.Counter
  cascaded reducer.inc
  cascaded slot.count
  cascaded tile.App
```

The description now reads:

```
Remove a definition. Set cascade=true to also remove its dependents: every definition that references it, directly or transitively, which can include the app. Without it, removing a definition that something references is refused. …
```

`kumiki remove --help` prints the same sentence for `--cascade`, from one shared
string (`CASCADE_HELP`, exported by `@kumikijs/cli`), so the two cannot state
different relations again. What a cascade removes is unchanged.
