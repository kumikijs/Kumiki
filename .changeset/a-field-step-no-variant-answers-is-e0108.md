---
"@kumikijs/compiler": minor
---

Report a field step on a union that no variant answers (E0108), on either side of `:=`

A member step on a union was left undecided, so a name no variant has
passed `check` on both sides of `:=`, and so did any index after it:

```kumiki
type U = A(Int) | Z
slot u : U = Z
reducer viaKey on=ui.click(ByKey) do= u.a["k"] := "x"
reducer viaPos on=ui.click(ByPos) do= u.a[0] := "x"
```

From `u = Z`, the first write left `u` holding `{"_tag":"Z","a":{"k":"x"}}`,
and the second panicked in the reducer (`Index 0 reaches no List or Map, but
undefined`). `u.a := "x"` alone added the same key.

A union has no fields: a variant carries its payloads by position, and a
`match` reads them. A name the runtime has no member for can only be a field
step, so on a union it is now **E0108**, at the field, on either side of `:=`:

> `Type "U" has no member ".a" — a union has no fields; read a variant's payload with a match`

The union is named as the program writes it, through an alias, a record
field, a `List` element, `.get`, a generic union (`Box(Int)`) or one written
inline (`A(Int) | Z`). The step has no type, so whatever follows it — an
index, another field, the right-hand side — adds nothing. A `bind=` target
and an `error(field=…)` step read it first, so `error(field=d.shape.nmae)` is
E0108 where it was E0230.

A name the runtime has a member for (`.length`, `.get`, `.is-ok`, `.show`)
still dispatches on the variant the value holds and is not reported. A
program's own union may name a variant `Ok` or `Some`, and such a member
reads it by its tag. A name that a variant's record payload declares
(`p.x` on `type P = A({x: Int}) | Z`) is left undecided as before. So is a
name on a union with a payload whose type the checker cannot decide.

**Migration.** Read a payload with a `match`, and write the union whole:
`u := match u with | A(n) -> A(n + 1) | Z -> A(1)`.
