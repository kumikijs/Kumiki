---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
---

Reproduce a run that read the environment when replaying its episode

An episode recorded what a reducer *wrote* and nothing about what it read, and
`replay` re-executes the reducer body. So the one episode most worth replaying —
the one whose reducer rolled a die or stamped a time — was the one replay could
not answer for:

```
$ kumiki replay r.kumiki --from-log ep.jsonl     # recorded: roll 0 -> 3
  [reducer] roll6  roll: 0 -> 2, inRange: false -> true
  [reducer] roll6  roll: 0 -> 1, inRange: false -> true
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

`random()` used to lower to an inline `Math.random()`, which is invisible to the
log; it lowers to the runtime helper now, which is where the recording happens.

The field is omitted when a reducer read nothing, which is most of them, so an
episode log written before this is byte-identical to one written now — and one
that carries no `env-reads` still parses and replays, reading live as it did
before. A read with no recorded answer left falls through to the live source
rather than failing the replay.
