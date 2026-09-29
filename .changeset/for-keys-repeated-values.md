---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A `for` over a list that repeats a value re-renders in place

Every tile a `for` renders gets an implicit key so the reconciler can match it
across renders. The key was `show(x)` alone, so `[7, 3, 7]` gave two siblings
the key `"7"`, and so did two `for` loops under one parent that shared a
value. The first paint worked. Every later render, including one caused by an
unrelated slot, then failed with `duplicate TileNode.key "7"` and rebuilt the
whole tree. That replaced every element on the page, including an `<input>`
beside the list, which lost its focus and caret on every keystroke.

The implicit key now also names the loop and which occurrence of the value
this is (`_s.loopKeys`), so it is unique among the siblings it can meet. A
list of distinct values keeps the key each element had, so reorder, insert
and remove reuse elements exactly as before. Explicit `{key: …}` keys are
unchanged: the author promises they are unique, and a loop whose explicit
keys collide stays a reconcile panic (`duplicate TileNode.key …`) followed by
a full rebuild. That is now the specified behaviour (runtime.md §10.3.10), not
a fallback to position, and a test pins it.
