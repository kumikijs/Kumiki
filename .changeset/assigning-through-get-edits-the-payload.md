---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

Write through `.get` into the payload instead of a field named `get`

`language.md` §1.6.3 documents assignment through `.get` — `draft.get.title := v`
— and says a write against a `None` is a no-op. A write against a `Some` was
not a write at all: the lvalue was flattened into a plain field path, so the
assignment set a sibling field named `get` beside `_tag` / `_0` and left the
payload untouched. The read side has always lowered `.get` through the
polymorphic unwrap, so the same path read correctly and wrote wrong — the
editor in `03-blog` typed into a field nothing read back.

**A write that used to do nothing now edits the payload.** An app that reads
the phantom `get` field, or that relied on the payload not changing, changes
behaviour.

**And a `bind=` through `.get` now panics while the value is empty.** It used
to walk the path defensively and hand the control an empty string; it reads
through the same unwrap as every other `.get` now, so `input(bind=draft.get.title)`
with `draft = None` fails during the first render and the app does not mount.
Reach the control through a `match` on the Option. This is the more disruptive
half of the change for an app already written against the old behaviour.

Both spellings are fixed together and now share one implementation: the
assignment a reducer lowers to and a `bind=` path's write-back both call the
runtime's setter, so they cannot disagree about what a path means. A `.get`
segment travels as `{get: true}` in `TileNode.bindPath`, which widens from
`string[]` to `(string | {get: true})[]`.

The name stays dispatched rather than reserved: on a record that declares a
field named `get`, both sides still resolve it as that field. `Result` is
covered the same way `.get` covers it when read — an `Ok` payload is edited, an
`Err` is skipped.
