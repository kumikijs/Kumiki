---
"@kumikijs/compiler": minor
---

feat(compiler): the arithmetic the spec documented now exists, as methods.

`docs/spec/stdlib.md` §2.4.4 listed eleven functions under a `math` namespace.
None of them worked, and none could: a call qualifier is a capitalised name, so
`math.abs(x)` parses as a reference to a name called `math` and every call
reported `E0103`. Four of the eleven — `abs`, `min`, `max`, `clamp` — already
existed one section earlier as methods on the number.

The rest are methods now: `floor`, `ceil`, `round`, `sqrt`, `log`, `exp` and
`pow(n)`, in both the `x.m` and `x.m()` forms for the argument-less ones.
`floor` / `ceil` / `round` answer `Int` whatever they are given, `sqrt` / `log`
/ `exp` answer `Float`, and `pow`'s result follows its receiver, so the checker
leaves that one open rather than guessing.

`math.random` becomes `random()`, a builtin call beside `now` and `fmt`. §2.4.4
made it "callable only inside a reducer (treated as an effect)" — a purity rule
no other builtin has, including `now`, which is just as non-deterministic. It is
callable wherever an expression is.

An argument outside a function's domain produces what the platform produces:
`(-1.0).sqrt` is `NaN` and `(0.0).log` is `-Infinity`, which `.show` renders as
those words. The spec says so now rather than leaving it to be discovered.
