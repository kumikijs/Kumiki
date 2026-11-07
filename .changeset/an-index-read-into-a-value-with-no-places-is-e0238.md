---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
---

Report an index read into a scalar, an `Option`, a `Result`, a `Tuple` or a union (E0238), and name the value an index reached when it panics

An index names a place only in a `Map` or a `List` (language.md), and the
write `n[0] := v` into anything else was already E0602. The read took the
same step and passed, and nothing after it was checked either:

```kumiki
slot word : Text = "abc"
slot n : Int = 5
tile App = column(text(word[0]), text((n[0] + 1).show))
```

passed `check`, and the first render panicked with `Key 0 is not in the
Map`, naming a Map the program never had.

The read is now **E0238 `unindexable-read`**, `Cannot read through an index
into "Text": an index names a place only in a Map or a List`, at the index's
key and naming the receiver's type as the program writes it, however it is
reached: directly, through an alias or `nominal`, a record field, a `List`
element, a `Map` value or `.get`. The read has no type, so `t := n[0]`,
`if o[0] then …`, `(n[0] + 1).show` or a `fn` body checked against its `->`
report the one E0238. A `bind=` target that takes the step
(`input(bind=n[0])`) is E0238 rather than E0602, as a Set's is E0232, since
the control shows its target before it writes one; and the field of an
`error` tile, `error(field=pair[0])` on a `Tuple`, is E0238 where it was
E0230. A Set keeps E0232, and a record is not reported: through a literal
key it reads the field the key names, and through a computed key a value of
no type. A receiver whose type the checker cannot decide stays silent.

Where such a read still runs, its panic shows the value the index reached
instead of a Map: `Index 0 reaches no List or Map, but "abc"`, the sentence
a write through the same step already panics with.

**Migration.** Read the value with the member that answers it: part of a
`Text` with `.slice(start, end)`, an `Option`'s payload with `.get-or(d)` or
`.map(…)`, and a `Tuple`'s members with a `match` that takes it apart. For a
value stored under a key or at a position, declare a `Map(K, V)` or a
`List(T)`.
