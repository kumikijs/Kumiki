---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

Read `.parse-int` / `.parse-float` the way `Int.parse` / `Float.parse` read

`Int.parse` reads an optional sign and decimal digits, and `Float.parse` reads
decimal text with an optional fraction and exponent (stdlib §2.4.3). The method
spellings `t.parse-int` / `t.parse-float` (§2.2.6) went through `Number()`
instead, so the same text was a different value depending on which documented
spelling a program used:

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

One input changes for `Int.parse` itself: decimal digits spelling a number too
large to be finite (past about 1.8 × 10³⁰⁸) were `Some(Infinity)`, an `Int`
that is no number; they are `None` now, as `.parse-int` and `Float.parse`
already answered.

**Migration.** A program that relied on the lenient method reading gets
`None` where it got a number. Trim text that may carry blanks
(`t.trim.parse-int`); read a fraction you mean to truncate as a `Float` and
convert it (`t.parse-float.map($1.to-int)`); a hex, binary or exponent
spelling has no reading as an `Int`, so convert it in a `fn` if the program
accepts one.
