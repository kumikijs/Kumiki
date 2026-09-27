---
"@kumikijs/compiler": patch
---

A slot read inside a reducer body sees what the body has already written, in every nested position (`language.md` §1.6.4).

```kumiki
reducer go on=ui.click(B) do= noteKey := "b"
                              out1 := match 1 with | n -> noteKey
                              out2 := let k = "x" in noteKey
                              hits := names.filter($1 == noteKey).size
```

read `noteKey` as it was before the click in a `match` binding, variant or tuple arm, in a `let … in` body, and in a method's predicate or element lambda. Each of those lowerings rebuilt its scope without the reducer's view of the slots, so the read lowered to `_live[...]`; a wildcard arm and a top-level read already saw the write.

Every nested scope is now opened through one helper that carries the view down. A tile's nested forms have no reducer view to carry and still read the live slots.
