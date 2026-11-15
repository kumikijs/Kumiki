---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
"@kumikijs/runtime": patch
---

A test whose body throws fails on its own, and the rest of the file still reports

The runner called each test unguarded, so one test whose body threw ended the
whole run: `kumiki test` printed the bare error and nothing else — no result for
the tests that had already passed, and no name for the one that threw. A
reducer-test whose `expect` indexes past the end of a list is enough, with
`check` clean:

```
$ kumiki test app.kumiki
KumikiPanic: Index 3 is out of range for a List of length 1
```

That test is now a `FAIL` of its own, with what it threw on an `error:` line,
and every other test runs and reports as usual (exit 1, as for any failure):

```
FAIL  expect-panics (0ms)
  error:    Index 3 is out of range for a List of length 1
PASS  inc-works (1ms)

1/2 passed
```

A panic is shown by its message, or as `KumikiPanic` when it has none. Anything
else keeps its kind — `TypeError: …` — since it points at the compiler or the
runtime rather than at the program, and a thrown value that is not an error is
shown as JSON. The guard sits in the one runner `kumiki test`, the MCP
`kumiki_test` tool and `kumiki fix --auto-patch` all go through, so they give
the same answer. On the `TestResult` they return, that text is the new optional
`error` field. `@kumikijs/runtime` now also exports `isPanic`.

`kumiki fix --auto-patch` follows from that. A test elsewhere in the file that
throws no longer stops it from repairing the named one, where it used to stop at
`could not run tests` (`reason: test-runner-threw`). Naming the test that throws
gives `(no auto-patch available)` with its `error:` line and
`reason: test-threw`, since there is no value to patch from:

```
$ kumiki fix app.kumiki --auto-patch expect-panics
(no auto-patch available) for failing test "expect-panics":
  error:    Index 3 is out of range for a List of length 1
  reason: test-threw
```

A patch after which a test that passed starts throwing is refused as
`regressed`, naming that test, rather than as `test-runner-threw`. A `regressed`
refusal now also says why: each test it would regress is printed with its
failing lines, and the refusal carries the patched run's results as
`failingTests` beside `regressed`:

```
refused fix for "inc-adds-two" — file left unchanged:
  replace 1 with 2 (from failing test "inc-adds-two" @ slots.count)
  reason: regressed
  would regress: step-picks
    error:    Index 2 is out of range for a List of length 2
```

The failing-test lines of `kumiki fix` are now the `kumiki test` ones, so a
`diff at:` there also carries the `expected -> actual` value arrow.
