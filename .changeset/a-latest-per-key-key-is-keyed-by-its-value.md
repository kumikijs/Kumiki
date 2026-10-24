---
"@kumikijs/compiler": patch
---

A `latest-per-key` key tells its values apart as `==` does

The key was lowered through `String(...)`, so a record, an `Option` or any
variant keyed to `"[object Object]"` and a `List` to its elements joined with
commas. Every request then shared one key with every other, and
`latest-per-key` behaved as `latest`: the second request aborted the first
whatever its input, and `kumiki check` said `ok`.

```kumiki
effect load cap=http.get in=Text out=Result(Text, HttpError)
            policy=latest-per-key({k: $1})
```

```
const __k = ((_d_1) => String({ "k": _d_1 }))(__a0);   // "[object Object]" for every input
```

The key is now written the way a Map key is stored — a `Text` as itself, a
structured value as its JSON with each record's fields in sorted order — at
the emit and in the effect table's `keyOf` alike, so `{k: "x"}` and `{k: "y"}`
run side by side and `["a,b"]` and `["a", "b"]` are two keys, while two `==`
keys still abort one another. The `EffectId` an `emit` yields is
`"<effect>:"` and that same text, so `emit cancel(id)` still names the request
it started. A `Text`, `Int` or nominal key is written as before.

A key whose type the key cannot tell apart by `==` is E0233 at the key: a
`Float` (`NaN` is not `==` to itself, and inside a record `NaN`, `Infinity`
and `-Infinity` are one key), a `File` (every `File` is one key) and a `Set`
(whose `==` depends on how it was built), or a type holding one of them —
`type Spot = {lat: Float, lng: Float}` keyed by `$1`, a `List(Set(Text))`.
language.md §1.5.2 lists which types a key may have.

The examples and benchmark corpus produce no new diagnostic; the generated
code of the four keyed programs among them differs only in the key's encoder.
`packages/examples/features/241-latest-per-key-record-key.kumiki` starts two
pages keyed by `{user, page}` records in one reducer body, and both complete.
