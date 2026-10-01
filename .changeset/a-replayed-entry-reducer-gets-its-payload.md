---
"@kumikijs/runtime": patch
"@kumikijs/cli": patch
---

A replayed episode hands its entry reducer the payload the live run handed it (`runtime.md` §10.5.3).

The live runtime records `trigger.payload` as the reducer payload itself — `{$el, $event}` for a UI event, `{$1}` for an effect result — and the replay executor behind `kumiki replay` and `episode-test` wrapped it a second time as `{$el: payload, $event: payload}`. So `$el.idx` and `$event.value` replayed as `undefined`, and an episode opened by an effect result panicked on its `$1`:

```
[reducer] clicked  n: 0 -> undefined
[panic:reducer] Cannot read properties of undefined (reading 'text')  reducer "loaded"
```

The payload is now passed on unchanged. An `ssr.hydrate` bootstrap episode, whose trigger carries no payload, hands its first `.ok` / `.err` reducer the value of the last `effect-end` of that effect and outcome recorded before it, and a `from-log` mock of that effect continues after it. An `episode-test` with `slots-equal: from-log, no-panics: true` over a log of the unchanged program now passes for both.

When the log carries no such `effect-end` (a trimmed or hand-edited log), the reducer still runs with no `$1`, but replay now says so instead of leaving the panic to read as a reducer bug: the episode line ends in `(no recorded result for <reducer>)`, the run ends with an `entry results missing:` summary, and `ReplayReport.entryResultsMissing` lists the episodes.
