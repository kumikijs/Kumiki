---
"@kumikijs/compiler": patch
---

A `.get-or` call whose argument count does not fit its receiver is now an arity error instead of a silent lowering to the other reading (#382).

`.get-or` is one name with two readings, told apart by the argument count: `Option(T).get-or(d)` and `Result(T, E).get-or(d)` against `Map(K, V).get-or(k, d)` (`stdlib.md` §2.2.1 / §2.2.4). The count selects the lowering, so a count that did not fit its receiver passed `check` and reached the *other* helper on the receiver it was given.

`m.get-or("k")` lowered to `_s.getOr(m, "k")`, whose last line hands the value back unchanged when it carries no `_tag` — so a slot declared `Int` received the whole map. The mirror shape is worse: `opt.get-or("k", 0)` lowered to `_s.mapGetOr(opt, "k", 0)`, which indexes the `Option` object by a key it does not have and answers the fallback on a `Some` as well. That is a wrong value of the right type, so nothing downstream trips over it.

Neither existing check could see it. `METHOD_MIN_ARGS` states a minimum, which one argument meets, and no maximum. `getOrResultType` takes the receiver and the count together and resolves to nothing when they disagree — the right answer for an inference table, since a wrong result type rejects working programs, but it leaves inference silent by construction. The report belongs in the arity check, where the receiver is what decides the count, and it is **E0213 `call-arity-mismatch`**: the message names the receiver, the count that fits it, and the reading the written count would have selected, because both counts are legal for the name.

A receiver whose type the checker cannot decide reports nothing: the count selects a reading but decides nothing about whether it is the right one.

Refs #382.
