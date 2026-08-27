---
"@kumikijs/compiler": minor
---

fix: read a stdlib constant written without its parentheses.

`Decoder.Text` / `Decoder.Bytes` / `Decoder.None` are values, and `http.md`
§6.1.4 writes them bare. Only `EffectId.none` ever parsed that way — the parser
carried a one-off for exactly that spelling — so every other constant fell
through to a field read on a variant named after the qualifier and emitted
`undefined`. `check` had no reason to object, and the emitted module was valid
JavaScript.

**It was not harmless.** The HTTP handler reads `decode ?? "json"`, so
`undefined` means json: a body meant to be discarded was parsed, and a 204 with
no body threw inside `res.json()` and took the `.err` branch. Two effects in the
blog example shipped that way.

The parser now reads a member of a constant namespace as a zero-argument call,
which is the channel typecheck and codegen already share with
`Decoder.Json(User)` — one decision site instead of three. A member these
namespaces do not have is an **E0116** now rather than silence followed by
`undefined`, and that includes the ones `TYPE_MEMBER_CALLS` used to resolve on
any capitalised qualifier: `EffectId.fresh` passed `check` and lowered to
`_s.freshId()`, minting a real id where the author wrote the empty sentinel, so
a later `http.cancel` on it cancelled nothing. `EffectId.show(h)` — the
qualified spelling of `h.show` — is unaffected; only the zero-argument form is
refused.

`Duration.*` and `Bytes.*` are deliberately not read this way: they take an
argument, and codegen defaults a missing one to `0` / `""` / `[]`. Both
outcomes are silent, so the choice is between two silences — a duration
defaulted to zero reads as a plausible value and survives, while `undefined`
fails the first thing that touches it.
