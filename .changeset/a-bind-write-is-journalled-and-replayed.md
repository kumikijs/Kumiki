---
"@kumikijs/runtime": minor
"@kumikijs/cli": minor
---

A write a `bind=` control makes is now recorded in the episode log, so `kumiki replay` and `episode-test` replay a form someone filled in and submitted to the state the run ended in, not against the field's default.

Typing into a bound input wrote the slot and recorded nothing. The submit that read the slot was recorded with a `before` that showed the typed value, but replay starts from slot defaults and nothing in the log made the write again, so the replayed submit read `""`:

```
before: [reducer] add  items: [] -> [""]           final slots: {"draft":"","items":[""]}
after:  [bind] draft  draft: "" -> "milk"
        [reducer] add  items: [] -> ["milk"], ...  final slots: {"draft":"","items":["milk"]}
```

Each write the slot takes is now an episode of its own: `trigger.kind` is `ui.input` (`input`, `textarea`, `editable`, `slider`) or `ui.change` (`select`, `check`, `switch`, `radio`), `trigger.target` is the bind path, and its one `bind` step carries the slot, the path, the value written there and the slot's `slot-diffs`. A write the refinement refuses, text a number or date field cannot read, and any write to a `volatile` slot are not recorded. Replay makes the write again at its path, through the program's refinement, and `slots-equal: from-log` reads the slot's value from the `bind` step, so a log that ends with typing expects what was typed. `kumiki replay` prints the write as `[bind] <path>  <slot>: <before> -> <after>`, ending in `(refused <value>)` when the program now refuses it, and the dev panel lists it.

`EpisodeLogger` gains `recordBind`, which a hand-written logger passed to `mount` has to implement (docs/spec/runtime.md).
