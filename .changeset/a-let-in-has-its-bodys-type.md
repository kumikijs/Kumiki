---
"@kumikijs/compiler": patch
---

A `let … in` expression has its body's type wherever it is read

`let x = v in body` evaluates to its body, read with `x` bound to `v`'s type
(language.md §1.9). A declared type already checked a `let` at its body — a fn
body against its `->`, a slot initialiser, an assignment, an `emit` argument —
but everywhere the type is *inferred*, the expression had none. So `check` said
`ok` to an operand, a condition or a receiver written as a `let`, where the
same body written in place was reported:

```
t := (let m = n in m).upper          # ok; `t := n.upper` is E0108
b := (let m = t in m) < 1            # ok; `b := t < 1` is E0201
t := if (let c = n in c) then "a" else "b"   # ok; `if n` is E0201
```

The member a receiver's type decides was also lowered by its name instead, so
`(let b = box in b).size` on a `{size: Int, …}` record counted the record's
fields (2) instead of reading `size`, and `.keys` of a `let` over a
`Map(Int, Text)` came back as text (`["1", "20"]`, summed to `"0120"`).

After, the expression has its body's type, so each of these is reported as the
body alone is, and `.size` / `.keys` read the field and the `Int` keys.

A name bound to a value whose type cannot be decided now shadows a slot of the
same name in the body as an undecidable value. Before, it took the slot's type:
`n := let name = xs.map($1) in name` beside a `slot name : Text` was a spurious
`E0201 Expected Int but got Text`; it now reports nothing. The same holds for
any bind with no type of its own — a `let` statement, a `for` bind or a
match-arm pattern.
