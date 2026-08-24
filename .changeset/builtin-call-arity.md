---
"@kumikijs/compiler": minor
---

fix(compiler): count a built-in call's arguments, and stop supplying the ones it left out.

`checkCallee` resolved a builtin by name and then returned. The arguments were
whatever the lowering happened to read, and every lowering that read one
substituted a default when it was absent — so an omission became a plausible
value rather than a diagnostic:

| Written | Lowered to |
|---|---|
| `Duration.s()` | `((0) * 1000)` — zero milliseconds |
| `Bytes.from-text()` | `_s.bytesFromText("")` |
| `file-url()` | `_s.fileUrl(undefined)` |
| `panic()` | `_s.panic("")` — a stop with no message |
| `fmt()` | `""` |

`Duration.s()` is the sharpest: a timer written with an empty duration fires
immediately and forever, with `check`, `build` and `smoke` all green. Extra
arguments were equally unchecked — `Duration.s(1, 2, "x")` dropped the tail.

The callee tables now carry the count beside the name, so resolving a builtin
and knowing its arity are one lookup and a builtin cannot be added without
deciding it. A mismatch is `E0213` at the call site. What is checked is the
count and not the argument's type: `Decoder.Json(User)` still lowers to a
sentinel that ignores the type it was given.

Two names are not held to an exact number. `fmt` requires its template and
substitutes as many values as it is given, so its message names a minimum.
`now` is a keyword, so the parser builds its zero-argument call itself.

Codegen's defaults are gone rather than unreachable: a lowering that needs an
argument and does not have one throws, so a caller that runs `codegen()` on
source it never checked gets a named failure instead of a zero.

**Breaking**: a call that was accepted because nothing counted it is now
rejected. `Duration.s()` and the rest of the table above are the ones that
mattered; two more are worth naming because they read as correct today —
`Decoder.Json` written without its payload type (the type is what makes the
decode type-safe, and a decoder that forgot it was indistinguishable from one
that had it), and `Decoder.Text(Text)` / `Decoder.Bytes(…)` / `Decoder.None(…)`
written *with* an argument, which those three constants never had.
