---
"@kumikijs/compiler": minor
---

A stdlib member is now a member only of the receivers stdlib.md §2.2 lists it for. `res.filter(…)` on a `Result`, `opt.keys` / `.size` / `.entries` on an `Option`, `res.values`, `st.map(…)` on a `Set`, `xs.size` on a `List`, `n.copy(…)` on an `Int` and `d.ms` on a `Duration` are **E0108 `undef-member`**, in both spellings (`recv.m` and `recv.m(…)`) and on both sides of `:=`. The message names the receivers that do have the member: `Type "Result" has no member ".filter" — it is a member of Map / Set / List / Option`. A `Duration` keeps its own row through an alias, a `where` and a `nominal` over it (`d.to-ms` on a `Duration where between(0, 1000)` is fine), and is named `Duration` in the message rather than the `Int` beneath it.

These used to pass `check` because the checker asked whether the runtime knew the name on *any* receiver. The runtime then answered with another container's reading: `Ok(3).filter($1 > 2)` was read as a `Map` and gave `{}`, and `Some(3).keys` gave the Option's own `_tag` / `_0` as data. The members come from one per-receiver table (`stdlib-members.ts`), which the result types the checker infers are keyed by as well, and a test holds it equal to the §2.2 signature blocks on both spec tracks. A receiver whose type the checker cannot decide keeps the name-based dispatch, as before.

`Time.to-ms` (milliseconds since the epoch), which the apps already used, is now listed in §2.2.8, and `Set(T).filter(pred) : Set(T)`, which the apps also use, in §2.2.2: its predicate is handed each element.
