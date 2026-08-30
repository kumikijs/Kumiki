---
"@kumikijs/compiler": minor
---

Resolve what `.get-or` answers, and check its fallback against the same type

Nothing said what `.get-or` returns, so the unwrapped value was assignable back
to the container it came out of: `opt := opt.get-or(x)` on a slot declared
`Option(T)` passed `check` and left the slot holding a bare `T`. Every reader
then disagreed with the value — `is-some` false on a value that was there,
`match opt with | Some(v)` taking the `None` arm, and `opt.get` reading a field
that is not on the object. A blog example shipped that way and offered "Log in"
to a logged-in reader.

`.get-or` now resolves the way `.get` already did: `Option(T)` and
`Result(T, E)` answer `T`, and `Map(K, V).get-or(k, fallback)` answers `V`. The
fallback is checked against that same type, which is the report that names the
mistake rather than its consequence — `opt.get-or(None)` is reported at the
argument as well as at the assignment.

Which of the two readings a call takes is decided by its argument count, the
way the runtime decides it, so a count that does not fit its receiver still
resolves to nothing and is checked against nothing. No verdict changed across
the example and benchmark corpora.
