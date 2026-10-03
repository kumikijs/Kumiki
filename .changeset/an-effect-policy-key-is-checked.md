---
"@kumikijs/compiler": minor
---

Check the expression inside `policy=latest-per-key(...)`

Every expression rule the checker has — `checkCallee`, `checkAgainst`, the
undefined-name report — runs from `checkExpr`, and an effect's
`latest-per-key` key was not one of the places that called it. The key was
never checked at all.

Two failures came out of that. A misspelled name lowered to a bare identifier
inside the key lambda, so `check` and `build` were clean, the app imported,
mounted and rendered, and the first dispatch of the effect died on an
undefined global. A built-in call missing its argument reached codegen
instead, which threw a plain `Error` — no code, and a position only in the
message text — rather than a diagnostic. Before built-in calls were counted
at all, that same program built cleanly and keyed the effect on
`bytesFromText("")`, one key for every request, so `latest-per-key` silently
behaved as `latest`.

The key is now walked like any other expression, in the scope it is written
in: `$1` is the effect's input and the only bind, the same one `map-request`
is given. A misspelled name is **E0103** and a built-in call missing its
argument is **E0213**, both at the key's own line and column rather than at
the effect. A slot and a `fn` stay readable there — codegen lowers a slot read
in the key through the live slot map — and `$route`, which the key is never
applied with, is an undefined name.

`map-request`, `app.http`'s fields and the key all want the same pure,
payloadless scope and each built its own; they now share one `pureScope`
helper, so a change made for one reaches the others.

Upgrade note: a program whose key names something undefined now fails
`check`. It was already broken — it threw the first time that effect
dispatched — but the failure has moved from run time to check time. The
examples and benchmark corpus produce no new diagnostic.
