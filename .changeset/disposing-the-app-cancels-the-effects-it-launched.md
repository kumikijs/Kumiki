---
"@kumikijs/runtime": patch
---

Cancel, at dispose, every effect the app has launched

Disposing an app aborted the effects it had launched but did not cancel their
episode tokens, so an effect still running, or waiting in a `retry=` backoff,
finished after the app was gone. Its result was recorded as an `effect-end`,
and its episode committed then, after `dispose` (and `runScenario`) had
returned. `packages/examples/apps/08-http-retry` with the last step of its
scenario removed, run with `kumiki run … --episode-log f.jsonl` and replayed
with `kumiki replay … --from-log f.jsonl --mock 'loadQuote: from-log'`:

```
before: click episode ends in effect-end err "aborted"   replay ends in Failed("request failed")
after:  click episode ends in effect-cancel loadQuote    replay ends in Loading, as the run did
```

`dispose` now cancels every launched effect, whether its invoke is still
running or it waits between retry attempts, as it already cancelled a pending
`debounce` timer or a queued entry. Each records an `effect-cancel`
(`targetId = <effect-name>`) on the episode that started it, and that episode
commits before `dispose` returns. A result that arrives afterwards, including
one from an invoke that ignored its abort, reaches no reducer, records no step,
and is not reported as an unhandled error. If the logger's `onEpisode` throws
on one of those commits, the other episodes still commit and `dispose`
rethrows the first error afterwards; the app is unmounted either way, so its
shape can be mounted again. An emit that reaches the app after its dispose
launches nothing.

runtime.md states the rule, under Dispose, in both language tracks; the retry
sections of http.md and runtime.md point to it for a request in its retry
backoff, and runtime.md's episode-log section no longer says
`kumiki run --episode-log` leaves out an episode that commits after the run. `packages/examples/features/260-dispose-cancels-launched-effects.kumiki`
ends its scenario while a request waits in its backoff.
