---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A nested `for` renders at any depth: its key grows by one element per level

A node of a list is keyed by the JSON array `[callKey, nodeKey]` (runtime.md §10.3.10). One level up, `nodeKey` was already such an array, and it was written into the next array as a string, so its quotes and backslashes were escaped again: the key doubled in length at every level. At 20 nested `for`s every node's key was about two million characters long, and at 28 the render threw `RangeError: Invalid string length` from `_wk`. `check` and `build` passed, and `smoke` failed:

```kumiki
slot xs : List(Int) = [1]
tile Page = column(for x1 in xs for x2 in xs … for x28 in xs text("leaf"))
```

A chain of 28 tiles, each a `for` whose body calls the next, failed the same way.

A node's own key that is itself such an array (two or more elements, spelled as `JSON.stringify` writes it) now contributes its elements rather than itself: `[callKey, …nodeKey]`. A node of `for a in as for b in bs for c in cs text(c)` is keyed by the array of the three iteration keys, where it was the outer key paired with the escaped text of the inner pair. A key now holds one element per level and its length grows linearly with the depth. A two-element key — a `for` directly in a `for`, or a list-bodied call whose list one `for` renders — is spelled as before; what changes is a key three or more levels deep, and the key a list gives a node whose own explicit `{key: …}` is spelled as such an array. A reorder at any level still moves each node's element.

Only the compiler's output changes: the runtime treats keys as opaque strings. Both packages are bumped together, as the key contract ships as a matched pair.
