---
"@kumikijs/compiler": patch
---

A key on a call to a user tile whose body is a `for` keys each node the list renders, instead of rendering nothing (`runtime.md` §10.3.10).

```kumiki
slot xs : List(Text) = ["a", "b"]
tile Items = for x in xs text(x)
tile App = column(Items {key: "k"}, text("end"))
```

passed `check` and failed `smoke` with `no renderer registered for tile kind "undefined"`: the key was spread into the list itself, an object of its indices with no `kind`. The implicit key a surrounding `for` stamps on a call (`for id in ids Items(id)`) reached the same path, and that form also left each iteration's list nested inside the child list, which drew the same nothing.

Each node now takes the pair of the call site's key and its own key — its position when it has none — encoded as `[callKey, nodeKey]`, so the nodes stay distinct in the keyed reconciler and a reorder moves their elements rather than rebuilding them. A container's children are flattened however deeply the `for`s that produced them nest.
