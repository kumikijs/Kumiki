---
"@kumikijs/compiler": patch
---

A property-test's `count` is a whole number, 1 or more

The `count` clause took any number literal. `count = 0` ran no case, so
`kumiki test` reported PASS for an invariant that fails on every input and the
test asserted nothing. `count = 0.5` was accepted and ran one case, and a
failure there read `counterexample (case 1/0.5)`. `count = -3` was refused, but
only as `Expected num, got op(-)`:

```
$ kumiki check pt.kumiki
ok
$ kumiki test pt.kumiki
PASS  zero (0 cases, 0ms)
```

Each of the three is now a parse error at the literal, naming the test and the
clause (testing.md §8.3.1):

```
$ kumiki test pt.kumiki
Error: Parse error at 11:21: property-test "zero" count must be a whole number, 1 or more (got 0)
```

`count = 1` runs one case and a test without `count` runs 100, as before. The
check is the same positive-Int rule a motion's `duration` and `iteration` are
held to.
