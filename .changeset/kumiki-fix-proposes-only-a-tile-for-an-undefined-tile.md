---
"@kumikijs/cli": patch
---

`kumiki fix` repairs an undefined tile (E0105) only with one of the program's own tiles, and leaves a variant written where a tile is expected alone, so the correct repairs beside them are written.

Where a tile is expected, E0105 is a name that is neither a tile nor a value, so a slot, `fn` or reducer written in its place is E0128. The regression gate then refused the whole batch, the correct repairs in it included:

```
slot c : Bool = true
slot total : Int = 1
tile Header = text("h")
tile App = column(when(c, totl), Hedaer)
# before: plans "totl" → "total" and "Hedaer" → "Header", and writes neither
# after:  plans "Hedaer" → "Header" alone, and writes it
```

A builtin's bare name in a container is E0128 as well (`column(link)`), so no builtin is proposed either. A variant tag is not looked up as a value there, so `when(c, Some(1))` is E0105 too; it was renamed to a tile of a close name (`Home`) and the batch refused, and its skip reason is now `e0105-variant-tag-is-a-value`.
