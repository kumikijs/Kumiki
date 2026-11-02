---
"@kumikijs/cli": patch
---

`kumiki run --episode-log` writes every episode the run commits

The file was the logger's in-memory store, written once after the scenario,
and that store keeps only the most recent 100 episodes. A run that committed
more lost its head without a word, and replay, which starts from slot
defaults, then stopped short of where the run ended:

```
$ kumiki run many.kumiki many.scenario.json --episode-log many.log.jsonl
scenario passed                  # 105 clicks, count = 105
$ wc -l < many.log.jsonl
100                              # first line: count 5 -> 6
$ kumiki replay many.kumiki --from-log many.log.jsonl
final slots: {"count":100}
```

Each episode is now appended to the file as it commits, so the same run writes
105 lines, the first going `0 -> 1`, and replays to `{"count":105}`. The path
given through `KUMIKI_EPISODE_LOG` behaves the same way. Episodes that fit in
100 are written in the same order as before.

A path that cannot be written fails the run with exit code 1 and
`could not write episode log <path>: …`. The path is tried before the
scenario runs, by appending nothing, so a run that commits no episode is
refused too, and an existing file keeps what it holds. A write that fails
during the run is held until the scenario's own output is printed, rather than
surfacing as an error of the app on whichever step was running, and nothing is
appended after it. As before, an episode that commits after the scenario has
finished, such as one whose effect was still waiting in a `retry=` backoff, is
not written (#942).
