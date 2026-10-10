---
"@kumikijs/runtime": patch
---

Stop a request cancelled during its retry backoff at once

A request superseded by `policy=latest` (or cancelled with `http.cancel`) while
it waited out a `retry=` backoff kept waiting. The retry loop checked the abort
signal only before the wait, and the wait did not listen to it, so when it
ended the loop made another attempt with the aborted signal and only then
delivered `.err {status: 0, message: "aborted"}`. By that time the newer
request had answered, so the stale error arrived last and overwrote it.
`packages/examples/apps/08-http-retry` (`policy=latest` +
`retry=exponential(3, 200ms, 2.0)`), with a 503 and then a 200, clicked twice
50ms apart:

```
before: "Fresh quote — B", then "request failed"   fetch called 3 times
after:  "Fresh quote — B"                          fetch called 2 times
```

An abort during the wait now ends it at once: the request's `.err` fires right
away with the `aborted` `HttpError` (http.md §6.4.1), before the newer request
answers, and no further attempt is made. A `policy=queue` chain whose running
request is cancelled during its wait goes on to its next entry at once rather
than after the rest of the interval. On a capability that fails with `Text`
(storage, session, indexed) the err is the `Text` `"aborted"`, read the same
way a scripted or mocked err is. A request that is not cancelled keeps its
timing.

http.md §6.5 states the rule in both language tracks, and runtime.md §10.4.4
points to it. `packages/examples/features/192-retry-backoff-cancel.kumiki`
supersedes a request and stops another during their waits, and its scenario
reads the order the result reducers fired in.
