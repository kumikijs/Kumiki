---
"@kumikijs/compiler": patch
---

Chains nested in one another count together against the 256-level depth budget

`language.md` §1.2.3 bounds the tree a program builds at 256 levels. Each chain
the parser reads with a loop (a `+` chain, `x[0][0]…`, a type's `where`s, an
assignment path) was charged only for its own steps, on top of the level it was
read at. But the operand an early step reads ends up under every later step,
and so does whatever is nested in it, so chains nested inside one another
multiplied instead of adding up:

```
type Id(T) = T
type T = Id(Id(…Id(Text) where nonempty ×200…) where nonempty ×200) where nonempty ×200
slot s : T = "a"
```

Before, with 10 levels of `Id(…)` (a tree about 2,000 levels deep) this
compiled `ok`, and with 20 it crashed with a bare `RangeError` from the
checker. Eight `+` chains of 200 terms, each the parenthesised second term of
the one around it (`x := 1 + (1 + (…) + 1 …) + 1 …`, in a reducer or a tile's
text), and sixteen 200-step index chains, each the first index of the next
(`xs[xs[…][0]…][0]…`), crashed the same way.

Now each chain measures how deep every operand it reads goes, and each step is
charged for the deepest of them, so all of these are the positioned parse error
a single overlong chain gives, at the step that takes the tree to level 256.
For the 10-level type above, that is the 47th `where` of the second run from
the inside:

```
Parse error at 2:3737: Nesting is deeper than 256 levels — extract part of this into a definition of its own
```

The same holds for anything else nested in a chain's operand: a product inside
a sum, a nested list that is then indexed, a `match` pattern, a nested type
application under `where`s. A binary operator's right operand counts one level
under its operator, as an index already did under its `[`.

A single chain's limits and the positions it is refused at are unchanged, and a
program inside the budget is unaffected: a 10-level `Id(…)` type 255 levels
deep still compiles.
