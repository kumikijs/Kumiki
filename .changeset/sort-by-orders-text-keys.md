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
a `Bool`, an `Option`, a container — is E0201 at check time instead of a silent
no-op, whether it is written as a fragment (`$1.kind`) or as a `fn` passed by
name (`users.sort-by(kindOf)`), whose declared return type is the key's type.

`Text` order is UTF-16 code-unit order, not a locale's collation: `"Z"` sorts
before `"a"`, and kana and kanji by code point rather than by reading.

One case orders differently from before. A key declared numeric or `Time` whose
value arrives at runtime as `Text` — an HTTP JSON body is not converted to the
declared types, so `{"age": "30"}` lands in an `Int` field as a string — used to
be coerced by the subtraction and sorted numerically. It is now ordered as the
`Text` it is, the way `<` would order it: `"10"` before `"9"`.

A key with no value to order — absent, or `NaN`, which only a key the checker
could not type can be — now sorts after every other key, keeping its order.
Compared as "equal" to everything, a single one used to stop the rest of the
list from sorting.
