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

**Migration.** A tile that reads `m[k]` at a key that may be absent used to
render `undefined` there; it now panics during render (the first render
included), and the nearest `error-boundary` or the built-in panic display
takes the page. Read such a key in a tile through `m.get-or(k, d)`, or through
`m.get(k)` and a `match` on the Option.

A write path whose index key is a record with a `get: true` field
(`Map({get: Bool}, V)`) now writes the entry under that key. It used to be
taken for a `.get` unwrap, so `m[{get: true}] := v` replaced the whole slot
with `v`.
