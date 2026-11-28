---
"@kumikijs/runtime": patch
---

A `select` tells apart options that are Sets holding the text `"_tag"` or Maps with it as a key

A Set is held as an object keyed by its members, and a Map as one keyed by its
keys, so a `Set(Text)` holding `"_tag"` has the field a variant is marked
with. The key a `select` matches an option by read any value with that field
as a variant, so the Sets `["_tag"]` and `["_tag", "a"]` were both keyed
`true`: after choosing "one", choosing "two" wrote `["_tag"]` again. A
`Map(Text, Text)` with `"_tag"` as a key was keyed by what it mapped `"_tag"`
to, whatever its entries beside `_0`, `_1`, ….

A value is now keyed as a variant only when its `_tag` is an identifier and it
has no field beside its payload, so each of those options keeps a key of its
own. A value with no `_tag` field, and a variant, keeps the key it had.
