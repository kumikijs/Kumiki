---
"@kumikijs/runtime": patch
"@kumikijs/compiler": minor
---

An index write into a `List` leaves a `List`, and an index write into a `Set` is refused (#462).

`xs[i] := v` on a `List` replaced the list with an object keyed by its indices: the setter shared by reducer assignments and `bind=` write-back ended every step with an object spread, and `{...[1, 2, 3]}` is `{"0": 1, "1": 2, "2": 3}`. `check` said `ok`, and every reader after the write — `.length`, `.head`, a `for`, the state a scenario asserts — saw something other than a List.

The setter now copies a List and replaces the element at the index, at any depth, so `rows[1].n := 9` and `grid[1][0] := 0` keep every level's shape. An index that names no element — past the end, negative, or not a whole number — writes nothing, the same no-op as a write through an empty `.get`; language.md §1.6.3 now says so. The `Map` and record paths are unchanged.

A `Set` has membership and no places, so `tags[x] := v` is now E0602, the code a member write already gets, and the message points at `.add` / `.remove` / `.toggle`. It used to typecheck against the element type and lower to the same object spread.
