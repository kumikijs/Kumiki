---
"@kumikijs/compiler": patch
---

A type's `where` chain and an assignment target's path now count against the 256-level depth budget

`language.md` §1.2.3 bounds every tree at 256 levels, including a chain the
parser reads with a loop, because every stage after the parse walks the tree by
recursion. The binary, prefix and postfix chains were already charged to that
budget. Two other loops that build one node per step were not: the `where`s on
a type (one refinement each) and the `.field` / `[index]` steps of an
assignment target.

```
slot s : List(Int) = [1]
reducer r on=ui.click(App) do= s[0][0][0]…[0] := 1   # 10,000 steps
```

Before, 300 `where`s on a type checked `ok`. A few thousand of them, or the
10,000-step path above, parsed clean, and then `kumiki check` crashed with a
bare `RangeError: Maximum call stack size exceeded` and no position. Now both
report the same positioned parse error a long `+` chain does, at the `where`,
`.` or `[` that went over — here the 255th `[`:

```
Parse error at 2:795: Nesting is deeper than 256 levels — extract part of this into a definition of its own
```

A program inside the budget is unaffected, and that covers every program in the
examples and benchmarks. At the top of a definition a type takes up to 255
`where`s and an assignment target up to 254 steps; whatever a chain sits inside
spends the same budget.
