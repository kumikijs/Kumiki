---
"@kumikijs/compiler": patch
---

Report a field step on a union as E0108 even when a variant's payload declares that field, since the step reads the variant and never the payload

A name a variant's payload declares as a field was left undecided on a union,
so it passed `check` on both sides of `:=`:

```kumiki
type P = A({x: Int}) | Z
slot p : P = Z
slot q : P = A({x: 5})
```

`text(q.x.show)` rendered nothing though `q` held `A({x: 5})`, `p.x := 1` left
`p` holding `{"_tag":"Z","x":1}`, and `p.x[0] := "x"` panicked in the reducer.
A variant object holds its payloads at `_0`, `_1`, …, so the step read and
wrote a key of the variant, never the record. It is now **E0108**, as any
other field step on a union is:

> `Type "P" has no member ".x" — a union has no fields; read a variant's payload with a match`

The same holds for a named record payload, a variant's later payload, and a
`File`'s fields: `fv.name` on the stdlib `FormValue` is E0108. A member's name
written on such a union is **E0602** even when the payload declares it
(`p.length := 1` on `A({length: Int}) | Z`), and a payload whose type name
resolves to nothing no longer hides the step: E0117 is reported at the type,
and E0108 or E0602 at the step.

**Migration.** Read the field in the arm that binds the payload, and build the
variant again to write it:
`p := match p with | A(r) -> A(r.copy(x=r.x + 1)) | Z -> A({x=1})`.
