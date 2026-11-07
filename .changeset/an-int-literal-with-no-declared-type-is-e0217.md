---
"@kumikijs/compiler": patch
---

An `Int` literal past the safe range is E0217 where nothing declares a type too — a `let` value, an operand, the body of a `fn` with no `->` — not only where an `Int` is declared

E0217 was reported only where a declared `Int` read the literal, so in the
program below only lines 2 and 8 were reported:

```kumiki
fn f(x: Int) = 9007199254740993
fn g(x: Int) -> Int = 9007199254740993
slot n : Int = 0
slot b : Bool = false
reducer r1 on=ui.click(B) do= n := let x = 9007199254740995 in x
reducer r2 on=ui.click(B) do= n := n + 9007199254740997
reducer r3 on=ui.click(B) do= b := n == 9007199254740999
reducer r4 on=ui.click(B) do= n := 9007199254741001
```

The build wrote `function f(x) { return 9007199254740992; }`,
`const x = 9007199254740996`, `_s.add(…, 9007199254740996)` and
`_s.eq(…, 9007199254741000)`. Where nothing declares a type a literal has
the type it is written as, and one with no point is an `Int`, so each of the
six lines is now one E0217 at its literal. A literal a declared type reads is
still judged there, once: where a `Float` is declared it is a `Float` and is
taken, and where another type is declared that type reports it. The literal
a second sign negates, `-9007199254740993` in `- -9007199254740993`, is
reported too.
