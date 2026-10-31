---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
---

`error(field=…)` takes a path into a slot (`form.email`, `rows[0].email`) and renders only that path's failure; anything else in `field=` is E0230

`error(field=form.email)` passed `check` and rendered nothing, whatever `form`
held: codegen lowered only a bare slot name and turned anything else into an
empty field, which the runtime has no message for. `error(field=form)` did
render, but only the record's first failure, so on

```kumiki
type Contact = {email: Text where email, age: Int where between(18, 120)}
slot form : Contact = {email: "", age: 0}
```

there was no way to put "Must be between 18 and 120" beside the age field
while the email also failed.

`field=` now takes a slot or a path into one — record fields, `.get` into an
`Option` / `Result` payload, and literal-key indices into a `List` or a
`Map` (`form.email`, `draft.get.title`, `rows[0].email`, `book["b"]`) — and
the tile renders only a failure at or below that path. The slot is judged at
the path the way a `bind` to it is, so a sibling that fails first no longer
hides the field's own message: above, `error(field=form.email)` shows
"Invalid email format" and `error(field=form.age)` shows "Must be between 18
and 120". Text a bound `input` cannot read is a failure at the path the
input binds, so its own tile and the bare slot's say it, and a sibling's
does not. `error(field=form)` is unchanged and still covers the whole slot. A
path that reaches no value (`.get` on `None`, an index past the end, a
missing key) renders nothing instead of reading it.

Anything else in `field=` is **E0230 `error-field-not-path`**: a literal
(`field="form"`, which suggests the unquoted name), a local such as a `for`
variable or `$1`, the `route` slot, a `for` or `when` tile, a member like
`.length`, a step into a `Tuple` or a union, a call, an expression, an index
into something that is not a `List` or `Map`, or an index whose key is
computed (`rows[i].email`). So is an `error()` with no `field=`, and a
`field` written in the `{…}` block, which the tile never read: with
`.get` on a `None` there, the page panicked. These all passed `check`
before and rendered nothing. A misspelled field is still E0108.

The refinement walk for `List` and `Map` element types now follows an index
step, so the generated JS of a program with a refined `List` / `Map` element
type changes shape. What it accepts and refuses does not change.
