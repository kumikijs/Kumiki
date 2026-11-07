---
"@kumikijs/compiler": patch
---

Say when an E0103 is a read after a `let … in`, a tile `for` or an arm of a `match` expression ended, and stop `kumiki fix` renaming it

An expression that binds a name binds it for its own body: a `let … in`, a
tile's `for`, an arm of a `match` expression (a tile's or a value's). A read
after one — in a later statement or operand, or in a sibling argument of a
tile — is E0103. The checker named the scope only for a reducer's `if`
branches, `for` bodies and match arms, so `kumiki fix` read these as
misspellings and renamed them to the closest top-level name; a renamed read
can type-check, and then `--apply` counted it as resolved and the program read
another value:

```kumiki
slot id : Int = 0
slot xs : List(Int) = [1, 2]
tile App = column(for idx in xs text(idx.show), text(idx.show))

app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Before:

```
$ kumiki check app.kumiki
E0103 undef-ref at 3:54: Reference to undefined name "idx"
$ kumiki fix app.kumiki
E0103 Reference to undefined name "idx"
  fix: replace "idx" with "id" at 3:54
```

The same held for `id := let idx = 1 in idx` followed by `total := idx` in a
reducer, and for a tile `match` arm's `v` read in a sibling, which was renamed
to the app's name `A`.

After, the message names the kind of expression and gives the repair for it,
and the diagnostic carries the kind as `endedScope` — `let-in`, `for-expr` (a
tile's `for`) or `match-expr` (an arm of a `match` expression), beside `if` /
`for` / `match` for statement bodies:

```
$ kumiki check app.kumiki
E0103 undef-ref at 3:54: Reference to undefined name "idx" — it was declared in a tile's "for", and a name carries no value out of a loop: move the read into the loop's body (see docs/spec/language.md)
$ kumiki fix app.kumiki
(no auto-patches available)
E0103 Reference to undefined name "idx" — it was declared in a tile's "for", and a name carries no value out of a loop: move the read into the loop's body (see docs/spec/language.md)
```

A read after a `let … in` is told to move into its body, or to bind the value
where both reads see it: with a `let` statement in a reducer, with one
`let … in` around both reads in a `fn` or a slot initializer, and in a tile by
moving both reads into a tile that declares `in=`. A read in a later arm of the
same `match` expression is pointed at the arm that declares the name. Inside a
reducer's `if`, `for` or `match` body, the expression is still the scope named,
even when a statement earlier in that body ended the name too, since a read
moved into that body would still be after it. `kumiki fix` and the MCP
`kumiki_fix` tool propose no rename for any of these, in a reducer, a tile, a
`fn` or a slot initializer, and a genuine misspelling beside one is repaired as
before. docs/spec/language.md states that these bindings end with their
expression.
