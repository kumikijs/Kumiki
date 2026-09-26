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

A value of the wrong shape at a position — a decoded `{}` where a list belongs,
an untagged value where an `Option` does — is refused against that position's
first predicate, rather than passing untested or throwing. A `Set` member that
is not text or a number is not walked, because the runtime keys a set by the
member's text. A generic that applies itself to a growing argument more than 32
levels deep, with a refinement along it, is `E0803` at build time.

`HttpStatus` is now `nominal Int where between(0, 599)`: a request that got no
response (an abort, a `policy=latest` cancellation, a timeout, a network
failure) reports `status: 0` (http.md §6.4.1), and a slot holding the
`HttpError` has to accept it.

For a host that builds `SlotMeta` itself: `refineFailure`, when present, is the
whole gate (`slotAccepts`), and `RefinementFailure.path` is a list of
`RefinementStep`s, `[]` for the value itself; `showRefinementPath` writes one
the way the report does.

**Upgrading:** a program that declares refinements inside its types now
enforces them. A reducer that writes such a value — an empty `text` into a
`{text: Text where nonempty}` element, say — is now rejected rather than
committed; guard the write, or loosen the type.

**Data persisted before the upgrade** is checked the same way when it comes
back. Storage written by an older build can hold what the type now refuses — a
`Map(TodoId, Todo)` keyed by a non-uuid id from the old `fresh()`, a todo whose
`text` was saved empty — and the reducer that restores it (`todos :=
$m.get-or({})` in `02-todomvc`) is then rejected as a whole, including a
`ready := true` in the same batch, so an app that waits on that flag stays on
its boot screen. Before shipping, either migrate or clear the stored data, or
restore it through a `fn` that drops the entries the type refuses.
