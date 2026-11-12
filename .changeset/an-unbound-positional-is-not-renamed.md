---
"@kumikijs/cli": patch
---

`kumiki fix` no longer renames a `$1` or `$2` that nothing binds where it is read to the nearest declared name.

A positional is bound by the fragment, the tile's `in=` or the handler around
it. `kumiki fix` read an E0103 on one as a misspelling and wrote the closest
top-level definition in its place. With a slot one edit away, the renamed read
type-checked, so `--apply` wrote it and the program read the slot:

```kumiki
slot s1    : Text = "draft"
slot after : Text = ""
reducer go on=ui.click(Btn)
    do= s1 := ["a"].map($1).head.get-or("")
        after := $1
```

`kumiki fix --apply` printed `applied 1 fix(es) — file now clean` and line 5
became `after := s1`. Now the E0103 is skipped with the reason
`e0103-positional-unbound` and the read is left for the author. The same holds
for a `$2` after the `fold` that bound it and for a `$1` in a tile that declares
no `in=`.
