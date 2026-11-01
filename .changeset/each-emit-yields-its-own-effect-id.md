---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

Under every policy but `latest` and `latest-per-key`, each `emit` yields an `EffectId` of its own, so `cancel` stops only the request it names

Under the default policy, and under `queue`, `debounce`, `throttle` and
`once`, every emit of an effect yielded the same id, `"<effect>:_"`. The
dispatcher keeps one controller per id, so a second request in flight replaced
the first one's: after `idA := emit upload("a")` and `idB := emit upload("b")`,
`emit cancel(idA)` aborted request `b`, and neither a cancel nor unmounting the
app could stop request `a`. Under `queue`, one cancel dropped every entry
still waiting.

Each such emit now yields an id of its own: `"<effect>#"` followed by a new id
from the generator `<T>.fresh()` uses. `idA == idB` is false, and
`emit cancel(idA)` aborts request `a` (its `.err` fires with `aborted`) while
`b` runs to completion. Under `queue`, a cancel removes only the entry its id
names, or aborts it if it is running, and the queue goes on with the others.
`latest` and `latest-per-key` keep `"<effect>:<key>"`: they run one request
per key, and that id names it.

The id of an emit the policy drops names the request that absorbed it, so
`lastId := emit work(x)` followed by `emit cancel(lastId)` still reaches the
request the policy kept: under `throttle`, the one that opened the window;
under `once`, the one that input launched; under `debounce`, whatever the emit
that replaced it names. Once that request settles, the id names nothing.

One idiom changes under `debounce`: a request the timer already fired is a
request of its own. With `lastId := emit search(q)` on every keystroke,
`emit cancel(lastId)` clears the emit still waiting on the timer and leaves
running the request an earlier keystroke started, where it used to abort that
one too. `policy=latest` aborts the earlier request whenever a new one starts.

The id comes from one rule in the runtime, `emitId`. A compiled `emit`
expression asks it where the emit runs and keeps the answer on the record
(`EmitSpec.id`, optional), and the dispatcher runs the request under that id.
Inside a reducer body the new part is recorded as an environment read of a new
kind, `effect-id`, so a replayed episode yields the ids the recording did, and
a `<T>.fresh()` read never takes the answer an `emit` was recorded with.

The compiler's output now calls `_s.emitId`, so it needs a runtime from this
release or later; both packages are bumped together.
