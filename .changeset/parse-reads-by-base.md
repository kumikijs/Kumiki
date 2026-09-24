---
"@kumikijs/compiler": minor
---

`T.parse(text)` now reads its text by the base `T` is declared over, and `Duration.parse` / `Bytes.parse` have the `Option` type the spec gives them (#424, #431).

The lowering branched on the qualifier's *name*: `Int`, `Float` and `Time` converted, and every other qualifier wrapped the raw text in `Some`. A `nominal` is named for itself, not for its base, so with `type Cents = nominal Int`, `total + Cents.parse("12").get-or(0)` concatenated — `check` said `ok`, and the slot held a string. `Duration`, the standard library's `nominal Int` of milliseconds, did the same, and `Bool.parse("false")` answered `Some("false")`, a non-empty string that every `if` reads as true.

What `parse` produces is now decided by the base the qualifier unaliases to (`stdlib.md` §2.4.3):

- `Int` / `Float` — the number the text spells (`Int` truncated), `None` for blank text or text that spells no finite number
- `Time` — the instant as a millisecond number, as before
- `Bool` — `true` for `"true"`, `false` for `"false"`, `None` otherwise
- `Text` — the text, `None` when it is empty, as before
- `Bytes` — the UTF-8 bytes of the text, `None` when it is empty

A type whose base is none of these — a record, a union, `File`, `EffectId`, `Unit`, or a `nominal` over one of them — has no reading of a text, and `T.parse(t)` on it is now reported as [E0802](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/errors.md#e0802-unimplemented-function) rather than lowering to the raw string under an `Option(T)` type.

`Duration.parse(t)` and `Bytes.parse(t)` were typed as a bare `Duration` / `Bytes`, because the qualifier's constructor namespace caught them first. So the documented `o : Option(Duration) := Duration.parse(t)` was E0201 and `d : Duration := Duration.parse(t)` was clean. They are `Option(Duration)` / `Option(Bytes)` now, like every other qualifier.
