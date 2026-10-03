---
"@kumikijs/compiler": minor
---

Read `app.http`'s base-url, timeout and credentials when a request is made

`headers` was lowered into a thunk, so a slot reference in it worked and was
re-read per request. The other three were lowered as values into
`const _http = { … }`, which the module emits before `_live` — so
`http = {base-url: endpoint}` on a slot came out as `baseUrl: _live["endpoint"]`
reading a binding still in its temporal dead zone. `check` and `build` passed
and the app threw `ReferenceError: Cannot access '_live' before initialization`
at **import**: nothing mounted, and no diagnostic named the field.

All three are now getters, so each is read when the runtime consults it — which
is per request, matching `headers`. A reducer that writes the slot changes what
the next request is made with, with no remount: `base-url: endpoint` switches
host the moment `endpoint` is assigned. A literal is emitted the same way, so
the shape of the config never depends on what the author wrote.

Deferring moves where an unresolved name lands, so `check` now walks these
four expressions — nothing did before, and a misspelt slot in one of them used
to be a `ReferenceError` at import. It would have become a throw inside the
first request instead, which the dispatcher turns into an `err` result and an
`.err` reducer absorbs completely. It is E0103 at the field now, before a
build. The values are still untyped: a name resolves or it does not, and
nothing compares what a field is given against what it needs.

`docs/spec/http.md` (both tracks) now states the evaluation time of every
`app.http` field, since "once at construction" and "per request" are
observably different and nothing said which applied. `credentials` was missing
from that table entirely and is in it now.

The other expression positions lowered outside a closure were audited rather
than assumed: an `app.init` argument lands in the app object literal, which is
built after the slot table, and a slot initialiser that reads another slot is
already rejected (E0304). Everything else — route tiles, effect bodies, policy
keys, reducer bodies — is inside a closure and was never eager.
