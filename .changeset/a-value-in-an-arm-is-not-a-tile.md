---
"@kumikijs/compiler": patch
---

A value written as a `when` / `if` / `for` / `match` arm, a tile body or a tile-test's `expect` is E0128 `value-as-child`, and a builtin tile named without its call in a container is told to call it.

The parser reads a name in an arm as a tile call, so a value named there was reported as a tile that does not exist, and the fix it pointed at did not help:

```
slot total : Int = 1
tile P = column(when(c, total), text("end"))
# before: E0105 Reference to undefined tile "total"
# after:  E0128 A value is not a tile: a `when` arm has to be a tile. Show the value with a tile — `text(…)`
```

The same held for `if c then total else Other`, a `match` arm `-> total`, `for x in xs x`, `when(c, greeting())` with `greeting` a `fn`, and `tile P = total`. `kumiki fix` read that E0105 as a misspelling and proposed the closest definition name, so a slot `item` beside a tile `Item` had `when(c, item)` rewritten to render the tile. It is E0128 now, which has no rename.

A builtin's bare name in a container renders nothing, and the advice was to show a value:

```
tile P = column(divider)
# before: E0128 A value is not a tile: column renders … Show the value with a tile — `text(…)` …
# after:  E0128 `divider` is a builtin tile named without its call: column renders … Call it — `divider()`
```

In an arm or a body the same name is read as the call, so `when(c, divider)` renders a divider and is not reported. A loop variable or slot of a builtin's name is that value.

E0105 is a name there that is neither a tile nor a value, and keeps its suggestion: `when(c, Hedaer)` is still E0105 and `kumiki fix` still proposes `Header`. In a container, a lower-cased name that names nothing (`column(foo)`) is E0105 too, where it was E0128. A capitalised value in a container (`column(Big)` with `slot Big`) is E0128, where it was E0105.
