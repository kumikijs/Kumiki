---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
---

An index write into a `List` leaves a `List`, an index into a `List` is an `Int`, and an index write into a `Set` is refused (#462).

`xs[i] := v` on a `List` replaced the list with an object keyed by its indices: the setter shared by reducer assignments and `bind=` write-back ended every step with an object spread, and `{...[1, 2, 3]}` is `{"0": 1, "1": 2, "2": 3}`. `check` said `ok`, and every reader after the write — `.length`, `.head`, a `for`, the state a scenario asserts — saw something other than a List.

The setter now copies a List and replaces the element at the index, at any depth, so `rows[1].n := 9` and `grid[1][0] := 0` keep every level's shape. An index that names no element — past the end, or negative — is a panic, as lifecycle.md §7.2.2 already listed: the reducer's writes roll back, the episode log records it and `app.error` runs. The read `xs[i]` panics at the same indices instead of reading `undefined`, so both sides of `:=` agree; `xs.get(i)` still answers `None`. An index that meets no List at all — a missing value, or a missing element to write through — panics too, rather than building `{"0": v}` or a partial record. The `Map` and record paths are unchanged.

A `List` index is checked against `Int` on both sides of `:=`, so `xs[k]` with `k : Text` or `k : Float` is E0201 rather than an index that names nothing at run time.

A `Set` has membership and no places, so `tags[x] := v` is now E0602, the code a member write already gets, and the message points at `.add` / `.remove` / `.toggle`.
