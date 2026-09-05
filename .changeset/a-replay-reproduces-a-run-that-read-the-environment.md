---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
"@kumikijs/cli": minor
---

Reproduce a run that read the environment when replaying its episode

An episode recorded what a reducer *wrote* and nothing about what it read, and
`replayEpisodes` re-executes the reducer body. So the one episode most worth
replaying — the one whose reducer rolled a die or stamped a time — was the one
replay could not answer for. Recorded `roll: 0 -> 3`, then three separate runs
of the same command:

```
$ kumiki replay r.kumiki --from-log ep.jsonl
  [reducer] roll6  roll: 0 -> 2, inRange: false -> true
$ kumiki replay r.kumiki --from-log ep.jsonl
  [reducer] roll6  roll: 0 -> 1, inRange: false -> true
$ kumiki replay r.kumiki --from-log ep.jsonl
  [reducer] roll6  roll: 0 -> 3, inRange: false -> true
```

A `reducer` step now carries `env-reads`: what the body read from the
environment while it ran, in the order it asked, each entry `{kind, value}` with
`kind` one of `now` / `random` / `fresh-id` / `prefers-dark` — the builtins whose
answer comes from outside the program, so that nothing in the slots determines
it. Replay installs that reducer's recorded reads before running its body, and
those builtins return what they returned during the recording instead of reading
the clock / the random source / the id generator / the OS preference again.
Replaying an episode that read the environment now reproduces its recorded
`slot-diffs` exactly, every time.

A `panic` step carries the same, plus the `name` of the reducer that threw. A
reducer that panicked wrote no `reducer` step at all, so the episode a bug
report is most worth carrying — the one that crashed — would otherwise have
replayed as an episode with nothing in it, re-read the environment, taken a
different branch, and exited 0.

The scope that is recorded is the reducer body: a read in a tile expression or
during a render is not journalled, and nothing replays those. What a read
*answers* is recorded; the local time zone that `now.format(...)` later resolves
in is not.

`random()` used to lower to an inline `Math.random()`, which is invisible to the
log; it lowers to `_s.random()` now, beside the three that already went through
the runtime. That is a **generation requirement**, not a log-format one: an app
built by this compiler against an older `@kumikijs/runtime` fails at runtime
with `_s.random is not a function`, exactly as `_s.prefersDark()` did when it
was introduced. Compiler and runtime move together.

`kumiki replay` now reports environment-read provenance — `(env: N read live)`
on a step, and an `environment reads:` summary at the end — so "returned the
recorded value" and "read the clock again" are distinguishable after the fact.
An entry whose `value` is missing or is the wrong type for its `kind` is
rejected when the scope opens rather than handed to a reducer body as
`undefined`, and counted as `malformed`.

`withEnvRecord` / `withEnvReplay` are exported for a host that runs reducer
bodies itself; they take the body as a callback so the process-wide scope is
balanced by construction.

Log-format compatibility holds in both directions: the field is omitted when a
reducer read nothing, so a log written before this is byte-identical to one
written now, and a log that carries no `env-reads` still parses and replays,
reading live as before. A read with no recorded answer left falls through to the
live source rather than failing the replay.
