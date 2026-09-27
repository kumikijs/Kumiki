---
"@kumikijs/runtime": patch
"@kumikijs/compiler": minor
---

`sort-by` orders a `Text` key, and reports a key with no order

`users.sort-by($1.name)` returned the list unchanged. The comparator subtracted
the two keys, and two `Text`s subtract to `NaN`, which a JavaScript sort reads
as "equal", so no element moved. It passed `check`. Numeric and `Time` keys
worked, which is why it went unnoticed.

The comparator now asks `<`, so a key is ordered the way `a < b` orders it
(language.md §1.9.4): numbers and `Time` numerically, `Text` as two `Text`s
compare. The sort stays stable. A key `<` does not order — a record, a variant,
a `Bool`, a container — is E0201 at check time instead of a silent no-op.
