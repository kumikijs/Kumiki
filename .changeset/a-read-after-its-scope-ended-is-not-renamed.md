---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

Say when an E0103 is a read after its scope ended, and stop `kumiki fix` renaming it

A name declared in an `if` branch, a `for` body or a match arm ends with it
(docs/spec/language.md), so a read after it is E0103. `kumiki fix` read every
E0103 as a misspelling and replaced the name with the closest top-level
definition. For a scope violation that is the one repair that cannot be right:
a renamed read can type-check, and then `--apply` counted it as resolved, wrote
it, and the program read a different value. Short loop variables are within
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

After, the checker names the kind of body the name was declared in and gives
the repair for that kind, and the diagnostic carries the kind as `endedScope`
(`if`, `for` or `match`):

```
$ kumiki check app.kumiki
E0103 undef-ref at 8:18: Reference to undefined name "idx" — it was declared in a "for" loop, and a name carries no value out of a loop: move the read into the loop's body, or write the value to a slot there (see docs/spec/language.md)
$ kumiki fix app.kumiki --apply
(no auto-patches available)
```

and the file is left as written. `fix` proposes no rename for such a read,
whatever is close to it, and a genuine misspelling is repaired as before, the
same file included; a dry run that has other patches to show lists the read
with the reason `e0103-read-after-scope-ended`. The hint is given for a read,
later in the same reducer, of a name one of its `if` / `for` / `match`
statement bodies declared; any other undefined name keeps its message.
