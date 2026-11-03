---
"@kumikijs/cli": patch
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A tile-test whose tile panics as it renders reports it as an unexpected panic, as a reducer-test does

A reducer-test whose reducer panics where the test expects state fails with `actual: panic: "…"` and `diff at: (unexpected panic)`. A tile-test whose target panics as it renders, check-clean (`items[0]` of an empty list), failed instead as a test whose body threw:

```
FAIL  first-shows (0ms)
  error:    Index 0 is out of range for a List of length 0
```

It now fails in the reducer-test's lines, with the snapshot as what was expected:

```
FAIL  first-shows (0ms)
  expected: heading("First: 1")
  actual:   panic: "Index 0 is out of range for a List of length 0"
  diff at:  (unexpected panic)
```

A tile-test still has no way to expect the panic: its `expect` is a tile, with no section to write one in (testing.md). Only the target's render is reported this way. A panic while the test evaluates its own `given` (`given.in` included) or `expect` is a throw in the test's body and keeps its `error:` line.

The generated tile-test binds `given.in` ahead of the render, runs the render under the same guard as a reducer-test's reducer, and passes what it caught to `runTileTest`, whose input gains `panic: string | null` beside `actual`. Both runners build the unexpected-panic report through one function.
