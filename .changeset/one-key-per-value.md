---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A Set element or a Map key is one entry per value, whatever its type (stdlib.md §2.2.1 / §2.2.2).

The Set and Map members disagreed about how a key becomes an object key. `add` / `has` / `toggle` wrote `String(x)`, `get` / `insert` / `m[k]` / `m[k] := v` used the raw value as a property name, and `remove` compared the stored string with the raw key. So every union value and every record was the one key `"[object Object]"`: `picked.add(Red).has(Blue)` was `true`, and `votes[Red]` and `votes[Green]` were one count. `remove` on an `Int`, `Float`, nominal-`Int` or `Bool` key removed nothing. `check` said `ok` to all of it.

Every member now stores and looks a key up through one encoder, `entryKey`: `String(x)` for a primitive, as before, and for a record, variant, tuple or `Option` its JSON with each record's fields in sorted order. `to-list` / `keys` / `entries` and a `Map.filter` predicate read such a key back as the value it was written from: the checker records the new `"value"` key kind for it. The slot gate now walks a `Set` of records too (language.md §1.3.3), since its members come back out of their keys.

A key written in a Map literal is stored through the same encoder, and a `Map.filter` predicate is handed each entry as one `(key, value)` pair, so `$2` is the value even when the key is itself a two-element tuple.

**Persisted structured keys no longer read back.** A record or variant key stored before this change (as `"[object Object]"`), or a decoded `Map` whose structured keys are bare variant names, is not the JSON a structured key reads back from: `keys` / `entries` / `to-list` and a `Map.filter` over it now panic with a message naming the key, where they used to answer the wrong string. Rebuild such a container through its members to re-key it.
