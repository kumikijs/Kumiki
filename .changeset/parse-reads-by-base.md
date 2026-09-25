---
"@kumikijs/compiler": minor
---

`T.parse(text)` now reads its text by the base `T` is declared over, holds the value to `T`'s refinement, and `Duration.parse` / `Bytes.parse` have the `Option` type the spec gives them.

The lowering branched on the qualifier's *name*: `Int`, `Float` and `Time` converted, and every other qualifier wrapped the raw text in `Some`. A `nominal` is named for itself, not for its base, so with `type Cents = nominal Int`, `total + Cents.parse("12").get-or(0)` concatenated — `check` said `ok`, and the slot held a string. `Duration`, the standard library's `nominal Int` of milliseconds, did the same, and `Bool.parse("false")` answered `Some("false")`, a non-empty string that every `if` reads as true.

What `parse` produces is now decided by the base the qualifier unaliases to (`stdlib.md` §2.4.3):

- `Int` — an optional sign and decimal digits, `None` for anything else. `Number()` used to read the text, so `"0x10"` was `Some(16)`, `"1e3"` `Some(1000)`, `" 12 "` `Some(12)` and `"1.5"` `Some(1)`; each is `None` now. `Duration.parse("1.5")` is `None` for the same reason.
- `Float` — an optional sign, decimal digits, an optional fraction and an optional exponent, spelling a finite number; `None` for hex, `.5`, `1.`, `Infinity` and surrounding blanks.
- `Time` — the instant as a millisecond number, as before
- `Bool` — `true` for `"true"`, `false` for `"false"`, `None` otherwise
- `Text` — the text, `None` when it is empty, as before
- `Bytes` — the UTF-8 bytes of the text, `None` when it is empty

The value read is then checked against every `where` refinement `T` carries, and one it fails is `None`: with `type Cents = nominal Int where positive`, `Cents.parse("-5")` is `None`, not `Some(-5)`. An `Option(Cents)` never passes through a slot-write guard, so `parse` could hand the program a `Cents` its own type refuses.

The argument of `T.parse` is checked to be a `Text` (E0201); `Int.parse(true)` used to be `Some(1)`.

A type whose base has no reading — a record, a union, `File`, `EffectId`, `Unit`, or a `nominal` over one of them — is now reported by `check` as [E0802](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/errors.md#e0802-unimplemented-function), with the message `"<T>" has no reading of a text — parse into Int, Float, Time, Bool, Text or Bytes and build it in a fn`. It used to lower to the raw string under an `Option(T)` type. A type constructor written without its arguments (`List.parse(t)`, `Box.parse(t)`) is not a type at all and is reported as E0126 instead. A qualifier whose own definition resolves to nothing (an alias of an undefined name, a cycle) gets only the report at that definition.

`Duration.parse(t)` and `Bytes.parse(t)` were typed as a bare `Duration` / `Bytes`, because the qualifier's constructor namespace caught them first. So the documented `o : Option(Duration) := Duration.parse(t)` was E0201 and `d : Duration := Duration.parse(t)` was clean. They are `Option(Duration)` / `Option(Bytes)` now, like every other qualifier.
