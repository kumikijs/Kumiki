---
"@kumikijs/compiler": minor
---

feat(compiler): the arithmetic the spec documented now exists, as methods.

`docs/spec/stdlib.md` §2.4.4 listed twelve names under a `math` namespace. None
of them worked, and none could: a call qualifier is a capitalised name, so
`math.abs(x)` parses as a reference to a name called `math` and every call
reported `E0103`. Four of them — `abs`, `min`, `max`, `clamp` — already existed
one section earlier as methods on the number.

The rest are methods now: `floor`, `ceil`, `round`, `sqrt`, `log`, `exp` and
`pow(n)`, in both the `x.m` and `x.m()` forms for the argument-less ones.
`floor` / `ceil` / `round` are typed `Int` whatever they are given, `sqrt` /
`log` / `exp` are typed `Float`, and `pow` has no result type at all — `2.pow(3)`
is an `Int` and `2.pow(-1)` is `0.5` — so a `pow` expression is not checked
against its target, as `min` / `max` / `clamp` never were.

`math.random` becomes `random()`, a builtin call beside `now` and `fmt`. §2.4.4
made it "callable only inside a reducer (treated as an effect)" — a purity rule
no other builtin has, including `now`, which is just as non-deterministic. It is
callable wherever an expression is. It takes no arguments, and unlike the other
builtins says so: `random(1, 6)` is `E0213` rather than a silently ignored range
and a die that always rolls 1.

**Breaking**: `random` is now a reserved callee. A program that declares
`fn random()` still compiles, but the builtin wins at every call site, so the
calls take its `Float` result — reported at the call site rather than at the
definition that lost.

The arithmetic methods are also **members of a number only**. They were added to
a receiver-blind table, where `someText.round` passed and lowered to
`Math.round("hello")` — `NaN` into whatever it was assigned to. Every name in
§2.2.7 now reports `E0108` on a receiver whose type is known and is not `Int` or
`Float`, in both spellings; a receiver whose type is not known keeps the dynamic
pass-through. This also reaches four names that predate this change (`abs`,
`neg`, `to-float`, `to-int`), which had the same hole.

Writing a method that takes arguments without them — `f.pow`, `f.min` — is
`E0213` too. The parser produces a field access when there is no argument list,
which the arity check never saw, so those reached codegen's bracket fallback and
wrote `undefined` into the slot.

An argument outside a function's domain produces what the platform produces:
`(-1.0).sqrt` is `NaN` and `(0.0).log` is `-Infinity`, which `.show` renders as
those words. `round`'s ties go up, toward +∞ — `(-2.5).round` is `-2`. The spec
says both now rather than leaving them to be discovered.
