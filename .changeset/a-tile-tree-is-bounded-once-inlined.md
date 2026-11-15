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
tile T299 = column(text("leaf"))
```

Before, on Node's default stack, a chain of about 253–450 tiles compiled `ok` to
a module that `node --check` refused and that threw
`RangeError: Maximum call stack size exceeded` when run, and from about 500
tiles `compile()` itself threw that `RangeError` from code generation, with no
position. Other shapes ran out sooner, and on Windows sooner still.

Now the same 256-level bound holds for the tree with every user tile inlined,
and past it the checker reports **E0237 `tile-depth`**, once for each tile that
no tile with a depth expands into, at the call where the tree goes over:

```
error E0237 tile-depth at 127:20: Tile "T0" nests 602 levels deep once the tiles in it are inlined, past the limit of 256; it goes over where "T126" expands into "T127"
```

A tile that reaches a loop has no depth and is left to E0005; a deep tree below
it is reported on its own. A `tile-test`'s expected tree is inlined where the
test is compiled, so it is held to the same bound and reported for the test.

A tile's own body is counted as the parser counts one definition, the
expressions in it included, and a user tile's body hangs one level below its
call. Code generation wraps some of those calls once more, and each wrapper is a
level: one for a call that passes an argument, and one for a keyed call, keyed
by a `{key: …}` it writes or by the `for` that renders it. An `error-boundary` is
a level of its own, with the tile's body and the fallback's beneath it. Siblings
do not add up. The check is iterative and measures each tile once, so a
5,000-tile chain is reported rather than overflowing the checker.

When the parser refuses a tile tree as too deep, its message now says that
moving part of the tree into another tile does not help, since every call to a
tile is inlined back, and points at `for`, `when` and `match` instead.

The walk W0212 and W0213 take through the tiles a tile inlines, to learn what
it renders, is iterative too. Before, it recursed once per tile: from about
6,500 tiles, a chain with a `reducer … on=ui.click(T0)`, or a handler prop on a
call to `T0`, made `check()` throw `RangeError: Maximum call stack size
exceeded`, and a handler prop on every link took time quadratic in the chain
(about 8 s at 6,000 tiles). Now each tile is walked once however many positions
ask about it, so a 20,000-tile chain gets its E0237 and its warnings in about
half a second. So is the walk E0113 takes to find a `sub-routes` tile's
`route-outlet` in the tiles it renders, which threw the same `RangeError` on a
20,000-tile chain.

With `text("leaf")` at its end, a chain `tile Tn = column(Tn+1)` is two levels a
link, so 127 links compile and the 128th is refused; a chain of keyed calls that
pass an argument is three levels a link (85 links), and one a `for` renders,
passing an argument, four (64 links). A plain chain of 128 to about 250 tiles,
which compiled and loaded on Linux before, is refused now. The longest chain of
each shape the bound admits parses with `node --check` on a 757 KB stack, 77% of
V8's default, where on Linux the plain chain parses up to 193 links and the
`for` passing an argument up to 118. The deepest tree in the examples and
benchmarks is 31 levels, and the output for every program that compiles is
unchanged.
