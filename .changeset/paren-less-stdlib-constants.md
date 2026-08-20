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
`Decoder.Json(User)` — one decision site instead of three. A misspelt member
(`Decoder.Nope`, `EffectId.nope`) is an **E0116** now rather than silence
followed by `undefined`.

`Duration.*` and `Bytes.*` are deliberately not read this way: they take an
argument, and codegen defaults a missing one to `0` / `""`, so the bare form
would turn a mistake into a silent zero.
