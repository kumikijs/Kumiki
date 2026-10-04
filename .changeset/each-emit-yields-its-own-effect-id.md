---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

Two emits of one effect yield two `EffectId`s, so `cancel` aborts the request it names

Under the default policy, and under `queue`, `debounce`, `throttle` and
`once`, every emit of an effect yielded the same id, `"<effect>:_"`. The
dispatcher keeps one controller per id, so a second request in flight replaced
the first one's: after `idA := emit upload("a")` and `idB := emit upload("b")`,
`emit cancel(idA)` aborted request `b`, and request `a` could not be cancelled
at all. Under `queue`, one cancel dropped every entry still waiting.

Each such emit now yields an id of its own: `"<effect>#"` followed by a new id
from the generator `<T>.fresh()` uses. `idA == idB` is false, and
`emit cancel(idA)` aborts request `a` (its `.err` fires with `aborted`) while
`b` runs to completion. Under `queue`, a cancel removes only the entry its id
names, or aborts it if it is running, and the queue goes on with the others.
Under `debounce`, the id of an emit that a later one replaced before the timer
fired names nothing. `latest` and `latest-per-key` keep `"<effect>:<key>"`:
they run one request per key, and that id names it.

The id comes from one rule in the runtime, `emitId`. A compiled `emit`
expression asks it where the emit runs and keeps the answer on the record
(`EmitSpec.id`, optional), and the dispatcher runs the request under that id.
Inside a reducer body the new part is recorded as a `fresh-id` environment
read, so a replayed episode yields the ids the recording did.
`docs/spec/http.md` §6.4 / §6.4.1, `stdlib.md` §2.1.1.1 and `runtime.md`
§10.5.1 / §10.5.3 state the scheme.

The compiler's output now calls `_s.emitId`, so it needs a runtime from this
release or later; both packages are bumped together.
