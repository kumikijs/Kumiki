---
"@kumikijs/compiler": patch
---

Bound a tile tree's depth once its user tiles are inlined (E0237)

Code generation inlines every call to a user tile, so a chain of definitions
each calling the next nests the emitted module once per link. The parser's
256-level limit applies within one definition, so nothing bounded the chain:

```
tile T0 = column(T1)
tile T1 = column(T2)
# … one definition per level …
tile T499 = column(text("leaf"))
```

Before, on Node's default stack, a chain of about 253–450 tiles compiled `ok` to
a module that `node --check` refused and that threw
`RangeError: Maximum call stack size exceeded` when run, and from about 500
tiles `compile()` itself threw that `RangeError` from code generation, with no
position.

Now the same 256-level bound holds for the tree with every user tile inlined,
and past it the checker reports **E0237 `tile-depth`**, once per tile nothing
else expands into, at the call where the tree goes over:

```
E0237 tile-depth at 128:20: Tile "T0" nests 600 levels deep once the tiles in it are inlined, past the limit of 256; it goes over where "T127" expands into "T128"
```

The tree is counted in tile levels, as the parser counts one definition: every
call (builtin or user) and every `for` / `when` / `if` / `match` is a level, a
user tile's body hangs one level below its call, and an `error-boundary` is a
level of its own with the tile's body and the fallback's beneath it. Siblings do
not add up. The check is iterative and measures each tile once, so a
5,000-tile chain is reported rather than overflowing the checker.

The walk W0212 and W0213 take through the tiles a tile inlines, to learn what
it renders, is iterative too. Before, it recursed once per tile: from about
6,500 tiles, a chain with a `reducer … on=ui.click(T0)`, or a handler prop on a
call to `T0`, made `check()` throw `RangeError: Maximum call stack size
exceeded`, and a handler prop on every link took time quadratic in the chain
(about 8 s at 6,000 tiles). Now each tile is walked once however many positions
ask about it, so a 20,000-tile chain gets its E0237 and its warnings in well
under a second.

A chain `tile Tn = column(Tn+1)` is two levels a link, so 128 links compile and
the 129th is refused — a chain of 129 to about 250 tiles, which compiled and
loaded before, is refused now. The longest of those loaded on V8 only just: the
plain chain's own limit there is 252 links for `node --check`, and 251 for a run
that mounts it. Each chain shape measured at the new limit loads with headroom,
from 13% for a chain of keyed calls that pass an argument to about 50% for the
plain chain. The deepest tree in the examples and benchmarks is 21 levels, and
the output for every program that compiles is unchanged.
