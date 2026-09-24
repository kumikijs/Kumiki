---
"@kumikijs/compiler": patch
---

A test's `given`, `expect` or `mocks` that is not a record is now reported as **E0713**, instead of being read as empty and letting the test pass (#420).

Every reader of these clauses asks them for their fields. A name or a literal has none, so the whole clause silently did nothing:

- `given = setup` set no slots, so the reducer ran from the declared defaults.
- `expect = 41` asserted nothing.
- An `episode-test`'s `mocks = 41` scripted nothing. It also skipped the undefined-effect and mock-policy checks, which only looked inside a record.

`check` passed all of these, and each test passed against a state or outcome nobody chose.

The same rule covers the `mocks` and `event` sections of a `given`, which the lowering reads the same way. `{}` is still accepted as the empty record. A `tile-test`'s `expect` (a tile expression) and a `property-test`'s `invariant` are unaffected.

A `given` that is not a record is reported once, at the clause. Nothing inside it is resolved, and a `tile-test` does not also report its argument as missing. The lowering now throws the same message instead of answering `{}`, so a caller that skips `check` gets a named failure.
