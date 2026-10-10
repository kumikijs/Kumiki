---
"@kumikijs/cli": patch
"@kumikijs/runtime": patch
---

A test whose body throws fails on its own, and the rest of the file still reports

The runner called each test unguarded, so one test whose body threw ended the
whole run: `kumiki test` printed the bare error and nothing else — no result for
the tests that had already passed, and no name for the one that threw. A test
whose own `given` panics is enough, with `check` clean
(`given = {slots: {items: [1], count: [0][1]}}`):

```
$ kumiki test app.kumiki
KumikiPanic: Index 1 is out of range for a List of length 1
```

That test is now a `FAIL` of its own, with what it threw on an `error:` line,
and every other test runs and reports as usual (exit 1, as for any failure):

```
FAIL  first-given-throws (0ms)
  error:    Index 1 is out of range for a List of length 1
PASS  inc-works (1ms)

1/2 passed
```

The guard sits in the one runner `kumiki test`, the MCP `kumiki_test` tool and
`kumiki fix --auto-patch` all go through, so they give the same answer. On the
`TestResult` they return, the thrown message is the new optional `error` field.

`kumiki fix --auto-patch` follows from that. A test elsewhere in the file that
throws no longer stops it from repairing the named one, where it used to stop at
`could not run tests` (`reason: test-runner-threw`). Naming the test that throws
gives `(no auto-patch available)` with its `error:` line, since there is no
value to patch from. A patch after which a test that passed starts throwing is
refused as `regressed`, naming that test, rather than as `test-runner-threw`.
Its failing-test lines are now the `kumiki test` ones, so a `diff at:` there
also carries the `expected -> actual` value arrow.
