---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
---

Supply every field of `PanicInfo`

`PanicInfo` declares five fields and the runtime supplied three. `episode-id`
and `cause` were never written, so a program that read them got JavaScript's
`undefined` — through `+`, that renders:

```kumiki fragment
reducer onPanic
    on=app.error
    do= caught := "episode " + $event.episode-id
```

```
episode undefined
```

`episode-id` was typed `Text`, so "absent" was not something the program could
match on, and `lifecycle.md` §7.2.3 told reducers to "treat both as
None-equivalent" — a rule nothing could enforce and, for a `Text`, nothing could
even express.

`episode-id` is now `Option(Text)`, and is supplied: it carries the id of the
episode the panic happened in, which is the join between a panic a user saw and
what `kumiki replay` / `kumiki_episode_tail` read back. It is `None` when there
is no episode to name — a host that attached no episode logger, or a panic
raised outside any dispatch — so the absent case is a value the language can
say:

```kumiki fragment
text("episode: " + $event.episode-id.get-or("(none)"))
```

`cause` is now supplied too: the **nearest** `Error.cause` message when the
throw carried one, `None` otherwise. The chain behind it and the stack with it
stay in the episode log, where §7.2.3 already says they belong; `episode-id` is
how to reach them.

All three paths a panic reaches a program — an `app.error` reducer, a
`route.error` reducer, and an `error-boundary` fallback — are handed the same
record, built by one function (`userPanicInfo`) rather than three literals. #362
aligned the boundary's payload with the live one by hand, and both were then
missing the same two fields in the same way; a shared builder is what keeps them
from drifting again.

The runtime's `EpisodeLogger` gains `currentId()` — the question `hasOpenEpisode`
answers, with the answer a caller can name — and a mounted app publishes an
episode seam so the boundary path, which runs inside an app's own inlined
runtime copy, can read it across that boundary.

**A hand-written `EpisodeLogger` needs a `currentId()`.** It is a required
member, so a logger built against the previous shape no longer satisfies the
type. Anything from `createEpisodeLogger()` already has it. The runtime does not
assume it at runtime: a logger without one degrades to `episode-id: None` and
warns once, rather than throwing from inside a panic catch.
