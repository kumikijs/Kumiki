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

The same failure hit every list of records, the most common shape a `for`
renders: a record shows as `[object Object]`, so `for t in todos text(t.title)`
over two todos failed on its first re-render with
`duplicate TileNode.key "[object Object]"`. A list of `None`s failed the same
way, and an element whose shown value is empty was an empty key that `_wk`
refused.

The implicit key now has three parts, in this order: the loop, which
occurrence of the element's shown value this is, and that shown value
(`_s.loopKeys`). A loop is named by the tile it is written in and its ordinal
there (`App_0`, `App_1`, …), so a blank line or an edit elsewhere in the file
leaves the keys as they were. The key is unique among a parent's children,
except when one loop in the source is expanded twice into one parent's
children (`column(Items, Items)` for `tile Items = for …`), which keeps the
duplicate-key panic; give each use its own container. A loop whose every tile
call has its own `{key: …}` computes no implicit keys.

A reorder of elements with distinct shown values keeps every key, so it moves
the elements it already has, as before. Two limits (runtime.md §10.3.10): an
insert or remove before a repeated value renumbers its later occurrences, so
the elements of equal values may trade places; and where `show` is not
injective (records, variants with a payload) the implicit key is the
element's position, so a reorder patches rows in place instead of moving them.
A reorderable list of records wants an explicit key, `{key: t.id}`.

Explicit `{key: …}` keys are unchanged: the author promises they are unique
among their siblings. When every child at that level is keyed, colliding
explicit keys stay a reconcile panic (`duplicate TileNode.key …`) followed by
a full rebuild, not a fallback to position, and a test pins it.

The compiler's output now calls `_s.loopKeys`, so it needs a runtime from this
release or later; both packages are bumped together.
