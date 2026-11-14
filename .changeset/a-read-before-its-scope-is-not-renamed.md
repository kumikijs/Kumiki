---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

Say when an E0103 is a read before the scope that declares the name, and stop `kumiki fix` renaming it

A name declared in a nested scope — an `if` branch, a `for` body or a match
arm, a `let … in`, a tile's `for`, a `match` expression's arm — is out of scope
on both sides of it. The checker named the scope only for a read after it
ended, so a read before it was a bare E0103 and `kumiki fix` renamed it to the
closest top-level name. A renamed read can type-check, and then `--apply`
counted it as resolved and the program read another value:

```kumiki
slot id : Int = 0
slot xs : List(Int) = [1, 2]
tile App = column(text(idx.show), for idx in xs text(idx.show))

app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Before:

```
$ kumiki check app.kumiki
error E0103 undef-ref at 3:24: Reference to undefined name "idx"
$ kumiki fix app.kumiki
error E0103 undef-ref at 3:24: Reference to undefined name "idx"
  fix: replace "idx" with "id" at 3:24
```

The same held for `total := idx` written before `id := let idx = 1 in idx` in
a reducer, for a read before a `for` statement, an `if` branch or a match arm
that declares the name, and for a bare name in tile position read before the
tile `for` that declares it, which was reported as an undefined tile and
renamed to a close tile name.

After, the message says where the name is declared, at the name, and how to
repair the read, and the diagnostic carries the kind of scope as `laterScope`,
beside `endedScope` for a read after it (the same kinds: `if`, `for`, `match`,
`let-in`, `for-expr`, `match-expr`):

```
$ kumiki check app.kumiki
error E0103 undef-ref at 3:24: Reference to undefined name "idx" — it is declared later, at 3:39, in a tile's "for": move the read into the loop's body (see docs/spec/language.md)
$ kumiki fix app.kumiki
(no auto-patches available)
error E0103 undef-ref at 3:24: Reference to undefined name "idx" — it is declared later, at 3:39, in a tile's "for": move the read into the loop's body (see docs/spec/language.md)
```

The read cannot see a value computed after it, so the repair moves it into
the scope, after the declaration; a `let … in` value can instead be bound once
where both reads see it. Of nested scopes, the one that declares the name is
named. `kumiki fix` and the MCP `kumiki_fix` tool propose no rename for such a
read, and a genuine misspelling beside it is repaired as before; a dry run
that has other patches to show lists the read with the reason
`e0103-read-before-scope-begins`. The scopes a definition declares names in
are collected before it is checked, so a scope the check reaches after the
read is still found.

A read in a declaration's own right-hand side — the list a `for` iterates, the
value a `let … in` binds, or the scrutinee of a `match` whose arm's pattern
binds the name — keeps the plain message, as a read ahead of a `let` in the
same body does.
