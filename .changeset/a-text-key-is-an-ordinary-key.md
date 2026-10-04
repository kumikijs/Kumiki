---
"@kumikijs/runtime": patch
---

A Map or Set key spelled like an object member is an ordinary key

A Map and a Set are plain JavaScript objects, and `has`, `get`, `get-or`,
`update`, `toggle`, `intersect` and `diff` looked a key up with `m[k]` or
`k in m`, which also find what `Object.prototype` holds. So a key spelled
`constructor`, `toString`, `valueOf`, `hasOwnProperty` or `__proto__` was
always there. On an empty `Map(Text, Int)`, `has("constructor")` and
`get("constructor").is-some` were `true`, and a word counter written as
`counts[w] := counts.get-or(w, 0) + 1` stored text in an `Int` map:

```
counts = {"a":1,"constructor":"function Object() { [native code] }1"}
```

`update("hasOwnProperty", $1 + 1)` on that map added an entry where it should
have written nothing, `toggle("toString")` on an empty Set "removed" the
inherited name and never added it, and on a Set holding `"constructor"`,
`diff({})` dropped the element and `intersect({})` kept it. `check` and
`build` both said `ok`.

Every one of those members now asks whether the key is one the container
holds itself, the same question the index read `m[k]` already asked. An empty
Map has no key `"constructor"`: `has` is `false`, `get` is `None`, `get-or`
answers the default, and the counter counts every word from 0.

`insert`, `add`, a Map literal and `m[k] := v` already stored a `"__proto__"`
key as an entry. The members that rebuilt the container one key at a time
assigned each key into a fresh object, and assigning `"__proto__"` sets the
object's prototype instead: `remove` of another key, `intersect`, `diff`,
`filter` and `map` dropped the entry, and `toggle("__proto__")` on an empty
Set never added it. They now keep and add it like any other entry.
stdlib.md §2.2.2 states the rule.
