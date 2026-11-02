---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

`.parse-int` / `.parse-float` read a text as `Int.parse` / `Float.parse` do

`Int.parse` reads an optional sign and decimal digits, and `Float.parse` reads
decimal text with an optional fraction and exponent (stdlib.md's type-conversion
section). The method spellings `t.parse-int` / `t.parse-float` (stdlib.md's Text
section) went through `Number()` instead, so the same text was a different value
depending on which documented spelling a program used:

| text     | `Int.parse` | `.parse-int` before | `.parse-int` after |
|----------|-------------|---------------------|--------------------|
| `"0x10"` | `None`      | `Some(16)`          | `None`             |
| `"1e3"`  | `None`      | `Some(1000)`        | `None`             |
| `" 12 "` | `None`      | `Some(12)`          | `None`             |
| `"3.7"`  | `None`      | `Some(3)`           | `None`             |

`.parse-float` read `"0x10"`, `"0b11"`, `" 12 "`, `".5"` and `"1."` the same
way; `Float.parse` refuses them, and so does `.parse-float` now.

The runtime's `parseIntOpt` / `parseFloatOpt` are now the one definition of
each reading, and every spelling lowers to a call to them: `T.parse` on an
`Int` / `Float` base (a nominal or refined one too), the method forms with and
without parentheses, and the reader of an `input` bound to an `Int` / `Float`.
Codegen no longer inlines a second copy of the rule.

Two inputs change for `Int.parse` itself. Decimal digits spelling a number past
±(2^53 − 1) were `Some` of the nearest number a JavaScript number holds, another
number than the one spelt, and digits spelling a number too large to be finite
(past about 1.8 × 10³⁰⁸) were `Some(Infinity)`, no integer at all. Both are
`None` now: ±(2^53 − 1) is the range an `Int` literal is held to (`E0217`). An
`input` bound to an `Int` reads its text the same way, so such digits typed
there are refused with the "whole number" message, where they used to write the
rounded number or `Infinity` into the slot.

**Migration.** A program that relied on the lenient method reading gets `None`
where it got a number:

- Trim text that may carry blanks: `t.trim.parse-int`.
- Read a fraction or an exponent you mean as an `Int` through a `Float` and
  convert it: `"3.7".parse-float.map($1.to-int)` is `Some(3)`, and
  `"1e3".parse-float.map($1.to-int)` is `Some(1000)`. Only a hex or binary
  spelling has no reading; convert it in a `fn` if the program accepts one.
- A value that is already a number is no text, and `.parse-int` /
  `.parse-float` on it is now `None`. A `slider`'s `$event.value` is a number,
  and so is a `select`'s when its options are not `Text`. Either used to read as
  `Some(n)` through `.parse-int`, and now reads as `None` with no diagnostic, so
  `vol := $event.value.parse-int.get-or(0)` always writes `0`. Use the value as
  it is.
