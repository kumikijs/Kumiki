---
"@kumikijs/runtime": patch
---

A reducer-test with `given.mocks` reports only a panic as its panic, and anything else its reducers throw as a throw in its body, with its kind

A reducer-test with mocks reported anything its reducers threw as the test's panic. A `TypeError` from a compiler or runtime fault printed `actual: panic: "x.map is not a function"`, and a test with `expect = {panic: "not a function"}` passed on it. It now fails on an `error:` line that keeps the kind, as a reducer-test without mocks does:

```
FAIL  loads (0ms)
  error:    TypeError: x.map is not a function
```

A panic is reported as before.
