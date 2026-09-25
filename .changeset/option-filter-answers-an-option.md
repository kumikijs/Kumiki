---
"@kumikijs/runtime": patch
---

`Option(T).filter` answers an `Option` (#466).

`.filter` is polymorphic, and an `Option` is an object at runtime, so the helper read `Some(3)` as a Map: the predicate was called with the Option's own fields (`"_tag"`, `"_0"`), and the result was an object built from whichever of them survived — neither a `Some` nor a `None`. `is-some` on it was false, `get-or` could not unwrap it, and `match` found no arm, while `check` and `build` both said `ok`.

A `Some` whose value passes the predicate now stays that `Some`, one whose value fails it becomes `None`, and a `None` stays `None` without calling the predicate, as stdlib.md §2.2.4 gives it.
