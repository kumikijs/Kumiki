---
"@kumikijs/compiler": patch
---

An index read into a `Set` is E0232 `index-into-set`

A Set has membership and no places (language.md), and the write
`s[x] := v` was already E0602. The read took the same step and passed: the
checker typed `s[x]` as the element, so

```kumiki
slot s : Set(Int) = [5]
tile App = column(text("x: " + s[5].show))
```

passed `check` with `s[5] : Int`, and at run time read the marker the Set
stores for a member, or panicked with a message about a Map for a value it
does not hold.

The read is now **E0232**, `Cannot read through an index into "Set(Int)": a
Set has members, not places — use .has`, at the index's key and naming the
Set's type as the program writes it, however the Set is reached: directly,
through an alias or `nominal`, a record field, a `List` element, a `Map`
value, `.get` or a call that answers a Set. The write keeps E0602. Both sides
go through one check, and one rule gives an index step its type, so a Set
index has none on either side: `n := s[5]`, `if s[5] then …` or a `fn` body
checked against its `->` report the one E0232 and no type mismatch beside it,
where `b := s[5]` on a `Bool` slot used to report only `Expected Bool but got
Int`. A `bind=` target that takes the step (`input(bind=tags["a"])`,
`check(bind=tags["a"])`) is reported too, and so is the field of an `error`
tile: `error(field=tags["a"])` is E0232, where it was E0230. A receiver whose
type the checker cannot decide, such as the accumulator of a `fold` from `{}`,
stays silent.

**Migration.** Read membership with `s.has(x)`, a `Bool`. To show it in a
`check`, pass `value=s.has(x)` and toggle it in a reducer with
`s := s.toggle(x)`. For a value stored under a key, declare a `Map(K, V)`.
