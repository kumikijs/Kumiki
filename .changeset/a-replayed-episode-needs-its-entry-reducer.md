---
"@kumikijs/runtime": patch
"@kumikijs/cli": patch
---

An episode whose entry reducer is not in the program fails its replay (`runtime.md` §10.5.3, `testing.md` §8.6).

A log keeps the name each reducer had when it ran. After a rename, the episode's entry reducer — its first `reducer` step, or a `panic` step naming the reducer that threw — matched nothing in the program, and the replay executor behind `kumiki replay` and `episode-test` ended the episode there with a clean result. So a log recorded from `reducer inc …`, replayed against the same program with the reducer renamed to `bump` (and `bump` now panicking), printed the episode header with nothing under it, counted it, and exited 0:

```
episode ep_01M42Z… — ui.click on IncBtn
final slots: {"count":0}

1 episode(s) replayed
```

and an `episode-test` over that log with `expect = {no-panics: true, no-errors: true}` passed.

Such an episode is now reported instead of replayed. `kumiki replay` ends its line with the reason, leaves it out of the count, names it on stderr, and exits 1; the episodes after it still replay:

```
episode ep_01M42Z… — ui.click on IncBtn  (not replayed: no reducer named "inc")
final slots: {"count":0}

0 episode(s) replayed
not replayed: ep_01M42Z…: no reducer named "inc"
```

An `episode-test` fails for it whatever its `expect` names, ahead of any slot comparison, so the report names the reducer rather than a slot that did not move:

```
FAIL  replay-renamed
  expected: every episode replayed
  actual:   ep_01M42Z…: no reducer named "inc"
  diff at:  episodes
```

The words are the ones a scenario `{dispatch}` step naming no reducer fails with, from the same function, including its `— did you mean "…"?` for a close name. `ReplayReport.entryReducersMissing` lists the episodes, and the `episode-start` event carries `entryReducerMissing`.

An episode with no entry reducer at all — no `reducer` step and no named `panic` step — still replays clean: the live runtime records one only for an `ssr.hydrate` bootstrap whose `app.init` results reached no reducer, no reducer ran in it, and replay re-runs reducers only.
