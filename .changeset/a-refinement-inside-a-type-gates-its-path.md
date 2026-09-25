---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

Check a refinement written inside a record, union or container at its path

```kumiki
slot form : {email: Text where email, age: Int where between(0, 120)} = {email: "ada@example.com", age: 36}
```

used to be emitted with no check at all: `form.email := "nope"` and `age := 999`
both committed, with `check`, `build` and `smoke` silent. A predicate is now
checked wherever in the type it is written — a record field, a union variant's
payload, a `List` / `Set` element, a `Map` key or value, `Option` / `Result`
payloads, a `Tuple` member — through names, generics and recursive types. A
refused write discards its reducer's batch like any other, and the report names
the predicate and where it failed:

```
slot "form" cannot hold {"email":"nope","age":36} (email at .email)
```

`error(field=form)` renders that predicate's message. A slot whose predicates
all sit on its own type is emitted exactly as before.

**Upgrading:** a program that declares refinements inside its types now
enforces them. A reducer that writes such a value — an empty `text` into a
`{text: Text where nonempty}` element, say — is now rejected rather than
committed; guard the write, or loosen the type.
