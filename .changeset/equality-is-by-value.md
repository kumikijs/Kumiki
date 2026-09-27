---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

`==` / `!=`, `List.contains` and `List.unique` compare by value (language.md §1.9.4).

`==` compared anything but a primitive or a variant with a primitive payload by JavaScript reference, so `xs == []` was false on an empty list, `p == {x: 1, y: 2}` was false for that same record, and `Some(Some(1)) == Some(Some(1))` was false. `contains` lowered to `Array.prototype.includes` and `unique` to `new Set`, so `[Admin, Editor].contains(Admin)` was false and `[Admin, Admin].unique` kept both. A property test comparing a List slot with `==` could never pass. `check` said `ok` to all of it.

All three, and the test layer's own comparisons, now go through one helper, `valueEqual`: Lists and tuples compare element by element, records, variants, Maps and Sets by the same keys holding equal values, recursively. `unique` keeps the first occurrence of each value in order, and `Text.contains` is still a substring test.
