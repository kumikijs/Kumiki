---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

`m[k].f := v` writes nothing at an absent key, and `m[k]` read there is a panic

language.md §1.6.3 expands `todos[id].done := true` to
`todos := todos.update(id, $1.copy(done=true))`, and `update` does nothing when
the key is absent. The setter behaved differently: it built the missing entry,
so `todos` ended up as `{"t9": {"done": true}}`, an entry with no `title` that
the declared type `Todo` does not describe.

The setter could not tell a missing Map entry from a missing record field,
because each is a string step that finds `undefined`. A reducer's index step now
reaches the setter as `{at: key}`, separate from a field step, and a write
through an absent key leaves the Map as it was. `m[k] := v` still inserts.

The read had the matching gap. `todos["zz"].title` threw a JavaScript
`TypeError`, which bypassed the panic model. `m[k]` at an absent key is now a
panic (lifecycle.md §7.2.2), as an index past the end of a List already is:
the reducer's writes roll back and `app.error` runs. `m.get(k)` is still the
read that answers `None`.
