---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

Say when an E0103 is a read after its scope ended, and stop `kumiki fix` renaming it

A name declared in an `if` branch, a `for` body or a match arm ends with it
(language.md §1.6.7), so a read after it is E0103. `kumiki fix` read every
E0103 as a misspelling and replaced the name with the closest top-level
definition. For a scope violation that is the one repair that cannot be right:
the renamed read type-checks, so `--apply` counted it as resolved and wrote it,
and the program then read a different value. Short loop variables are within
reach of most slots:

```kumiki
slot id    : Int = 0
slot total : Int = 0
...
do= for idx in [1] { () }
    total := idx
```

Before:

```
$ kumiki check app.kumiki
E0103 undef-ref at 8:18: Reference to undefined name "idx"
$ kumiki fix app.kumiki --apply
applied 1 fix(es) — file now clean
```

and the file read `total := id`.

After, the checker says which body the name ended with, and the diagnostic
carries it as `endedScope` (`if`, `for` or `match`):

```
$ kumiki check app.kumiki
E0103 undef-ref at 8:18: Reference to undefined name "idx" — it is scoped to a "for" body, which ends with it: declare it before the "for", or move the read into the body (see docs/spec/language.md)
$ kumiki fix app.kumiki --apply
(no auto-patches available)
```

and the file is left as written. `fix` proposes no rename for such a read,
whatever is close to it — the skip reason is `e0103-read-after-scope-ended` —
and a genuine misspelling is repaired as before, the same file included. The
hint is given for names a reducer's nested statement bodies declared; a
misspelling keeps its message unchanged.
