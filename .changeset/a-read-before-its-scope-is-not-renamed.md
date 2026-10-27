---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

Say when an E0103 is a read before the scope that declares the name, and stop `kumiki fix` renaming it

A name declared in a nested scope — an `if` branch, a `for` body or a match
arm, a `let … in`, a tile's `for`, a `match` expression's arm — is out of scope
on both sides of it. The checker named the scope only for a read after it
ended, so a read before it was a bare E0103 and `kumiki fix` renamed it to the
closest top-level name. The renamed read type-checked, so `--apply` counted it
as resolved and the program read another value:

```kumiki
slot id : Int = 0
slot xs : List(Int) = [1, 2]
tile App = column(text(idx.show), for idx in xs text(idx.show))
```

Before:

```
$ kumiki check app.kumiki
E0103 undef-ref at 3:24: Reference to undefined name "idx"
$ kumiki fix app.kumiki
E0103 Reference to undefined name "idx"
  fix: replace "idx" with "id" at 3:24
```

The same held for `total := idx` written before `id := let idx = 1 in idx` in
a reducer, and for a read before a `for` statement, an `if` branch or a match
arm that declares the name.

After, the message says where the name is declared, and the diagnostic
carries the kind of scope as `laterScope`, beside `endedScope` for a read after
it (the same kinds: `if`, `for`, `match`, `let-in`, `for-expr`, `match-expr`):

```
$ kumiki check app.kumiki
E0103 undef-ref at 3:24: Reference to undefined name "idx" — it is declared later, at 3:35, and scoped to a tile's "for" body: move the read into the body (see docs/spec/language.md)
$ kumiki fix app.kumiki
(no auto-patches available)
```

`kumiki fix` and the MCP `kumiki_fix` tool propose no rename for it — the skip
reason is `e0103-read-before-scope-begins` — and a genuine misspelling beside
it is repaired as before. For a name a statement body declares, the message
says to declare it before the read. Both directions are now answered from one
table of the names each definition declares in a nested scope, built before
the definition is checked, so a scope the checker reaches after the read is
still found.
