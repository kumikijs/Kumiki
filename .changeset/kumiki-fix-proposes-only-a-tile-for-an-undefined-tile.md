---
"@kumikijs/cli": patch
---

`kumiki fix` proposes only a tile's name for an undefined tile (E0105), so a slot or `fn` of a close name is no longer written where a tile is expected.

Where a tile is expected, E0105 is a name that is neither a tile nor a value, so a slot, `fn` or reducer written in its place is E0128. The regression gate then refused the whole batch, the correct repairs in it included:

```
slot c : Bool = true
slot total : Int = 1
tile Header = text("h")
tile App = column(when(c, totl), Hedaer)
# before: plans "totl" → "total" and "Hedaer" → "Header", and writes neither
# after:  plans "Hedaer" → "Header" alone, and writes it
```

The program's own tiles outrank the builtins when two names are equally close.
