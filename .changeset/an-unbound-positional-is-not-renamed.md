---
"@kumikijs/cli": patch
---

`kumiki fix` no longer replaces a `$` name such as `$1` with the nearest declared name when nothing binds it where it is read.

Only a binder in scope supplies a `$` name, such as the fragment that binds
`$1` or a tile's `in=`, and no top-level definition starts with `$`. `kumiki fix`
read an E0103 on one as a misspelling and wrote the closest top-level
definition in its place. With a slot one edit away, the renamed read
type-checked, so `--apply` wrote it and the program read the slot:

```kumiki
slot s1    : Text = "draft"
slot after : Text = ""
reducer go on=ui.click(Btn)
    do= s1 := ["a"].map($1).head.get-or("")
        after := $1
```

`kumiki fix --apply` printed `applied 1 fix(es) — file now clean`, exited 0, and
line 5 became `after := s1`. Now the E0103 is skipped with the reason
`e0103-positional-unbound`: `--apply` leaves the file as written and exits 1,
and the read is left for the author. The same holds for a `$2` after the `fold`
that bound it, for a `$1` in a tile that declares no `in=` or in a `fn` with no
parameters, and for any other `$` name. A `$` name at the root of an
assignment's target, as in `$el.x := "x"`, names no slot, and is skipped with
`e0103-positional-not-a-slot` rather than renamed to one.
