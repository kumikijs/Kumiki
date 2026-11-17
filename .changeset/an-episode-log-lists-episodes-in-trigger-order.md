---
"@kumikijs/runtime": patch
---

An episode log lists episodes in the order their triggers began, so `kumiki replay` and `episode-test` apply a click that came while an earlier episode still waited on its effect after that episode, as the run did.

An episode commits when its causal chain is done, and the chain of a deferred or in-flight effect stays on the episode that emitted it, so that episode commits late. The logger stored episodes as they committed: `list()`, its localStorage mirror, `onEpisode` and the `kumiki run --episode-log` file all listed the later click ahead of the earlier one, and a replay, which runs the log in its order, applied the later click first and ended in a state the run never had:

```
before: final slots: {"x":"a"}   pickB, then pickA and its save answer
after:  final slots: {"x":"b"}   pickA and its save answer, then pickB
```

`list()` and the localStorage mirror now take an episode when it commits, at its trigger's place. `onEpisode` is handed an episode once it and every episode begun before it have committed, so a file appended from it, the `kumiki run --episode-log` file among them, keeps the same order without inserting a line. While an episode waits on an effect, the episodes begun after it wait for it there.

Replay still runs each episode whole: an effect's recorded answer, and the `.ok` / `.err` reducers it runs, come before the next episode's trigger, though in the run they came after it. A chain reducer that reads a slot the later trigger wrote reads the earlier value in the replay (docs/spec/runtime.md).
