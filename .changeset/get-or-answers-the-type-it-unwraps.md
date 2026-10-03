---
"@kumikijs/compiler": minor
---

Resolve what `.get-or` answers, and check its fallback against the same type

Nothing said what `.get-or` returns, so the unwrapped value was assignable back
to the container it came out of: `opt := opt.get-or(x)` on a slot declared
`Option(T)` passed `check` and left the slot holding a bare `T`.

Every reader then disagreed with the slot, and none of them said so. A bare
record carries no `_tag`, and every reader tests for one — `is-some` and
`is-none` are both false, so a `when(is-some, …)` / `when(is-none, …)` pair
renders neither arm, and a `match` whose arms are all variant patterns falls
through to nothing. A blog example shipped that way: its nav dropped both the
session row and the "Log in" link for a reader whose session had been restored.

`.get-or` now answers from its receiver's type argument, the way `.get` already
did: `Option(T)` and `Result(T, E)` answer `T`, and `Map(K, V).get-or(k, d)`
answers `V`. The fallback is checked against that same type, which is the
report that names the mistake rather than its consequence —
`opt.get-or(None)` is reported at the argument as well as at the assignment.

Which of the two readings a call takes is decided by its argument count, so a
count that does not fit its receiver still resolves to nothing here. No verdict
changed across the example and benchmark corpora.

**What this does not reach.** The blog's own line was
`session := $s.get-or(None)` in a reducer on an effect's ok event, and that
still passes `check`: an effect payload bind carries no type at all, so the
receiver decides nothing — an assignment straight out of one is accepted
whatever the slot declares. What this catches is the shape whose receiver has a
declared type: a slot, a `fn` parameter, or a `let` of either.
