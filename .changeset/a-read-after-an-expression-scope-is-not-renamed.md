---
"@kumikijs/compiler": patch
---

Say when an E0103 is a read after a `let … in`, a tile `for` or a `match` arm ended, and stop `kumiki fix` renaming it

An expression that binds a name binds it for its own body: a `let … in`, a
tile's `for`, an arm of a `match` expression (a tile's or a value's). A read
after one — in a later statement or operand, or in a sibling argument of a
tile — is E0103. The checker named the scope only for a reducer's `if`
branches, `for` bodies and match arms, so `kumiki fix` read these as
misspellings and renamed them to the closest top-level name; the renamed read
type-checked, so `--apply` counted it as resolved and the program read
another value:

```kumiki
slot id : Int = 0
slot xs : List(Int) = [1, 2]
tile App = column(for idx in xs text(idx.show), text(idx.show))
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

After, the message names the expression, and the diagnostic carries it as
`endedScope` — `let-in`, `for-expr` (a tile's `for`) or `match-expr` (an arm of
a `match` expression), beside `if` / `for` / `match` for statement bodies:

```
$ kumiki check app.kumiki
E0103 undef-ref at 3:54: Reference to undefined name "idx" — it is scoped to a tile's "for" body, which ends with it: move the read into the body (see docs/spec/language.md)
$ kumiki fix app.kumiki
(no auto-patches available)
```

A `let … in` read after it says `it is scoped to the body of a "let … in",
which ends with it: move the read into that body, or bind it where both reads
see it`. `kumiki fix` and the MCP `kumiki_fix` tool propose no rename for any
of these, in a reducer, a tile, a `fn` or a slot initializer, and a genuine
misspelling beside one is repaired as before. language.md §1.6.7 states that
these bindings end with their expression.
