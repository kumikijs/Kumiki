---
"@kumikijs/runtime": patch
---

`sort` orders a `List(Float)` holding `Infinity` or `NaN` as numbers

`[10.0, 9.0, 1.5, 1.0 / 0.0].sort` was `[1.5, 10.0, 9.0, Infinity]`. `sort` took
the numeric path only when every element was a finite number, and one
`Infinity`, `-Infinity` or `NaN` sent the whole list to the string comparator,
so `10` sorted before `9`. stdlib.md §2.2.7 makes those three ordinary `Float`
results (`1.0 / 0.0`, `(0.0).log`, `(-1.0).sqrt`), so any `List(Float)` built
from division, `log` or `sqrt` could reach it.

The numeric path is now chosen by the elements' type, not their values, and
orders with the comparator `sort-by` already uses for its keys, `<`: an
infinity sorts below or above every finite value, so the list above is
`[1.5, 9.0, 10.0, Infinity]`, and `NaN`, which `<` orders against nothing,
sorts after every other element, `Infinity` included (`[(-1.0).sqrt, 2.0,
1.0].sort` is `[1.0, 2.0, NaN]`), as a `NaN` key does in `sort-by`. stdlib.md
§2.2.3 and §2.2.7 state both. Lists of finite numbers, `Time` lists, `Text`
lists and mixed lists sort as before.
