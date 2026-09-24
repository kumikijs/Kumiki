---
"@kumikijs/compiler": patch
---

Report a refinement predicate written over a base type it cannot test

```kumiki
slot name : Text where positive = "ada"
```

passed `check` and `build`, and at runtime refused every value — `positive`
tests a number, and a text answers it with `false` — so every write to the slot
discarded its reducer's batch. It is now **E0804**:

> `Refinement "positive" tests a number but is written over Text, so no value satisfies it`

The text family (`nonempty`, `len-*`, `email`, `url`, `uuid`, `regex`) needs
`Text`; `between`, `positive` and `negative` need `Int`, `Float` or `Time`;
`one-of` takes any base. The base is read through aliases, `nominal` wrappers
and earlier `where`s, and a generic's own type parameter is not judged until it
is applied. `len-lt(0)` — a legal count that no text is shorter than — is E0804
as well.
