---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
---

Bind a control through an index (`bind=rows[i].title`)

A `bind=` target that stepped through an index passed `check` and bound
nothing. The lowering read only field steps, so it dropped the whole bind:

```kumiki
type Todo = {title: Text, done: Bool}
slot rows : List(Todo) = [{title: "a", done: false}]
tile App = column(input(bind=rows[0].title))
```

```
$ kumiki check app.kumiki
ok
```

The input rendered empty, typing into it wrote nothing, and every scenario
step that filled it stayed clean. With a `for` variable as the root already
refused (E0229), there was no way to bind a field of a list element at all.

An index step is now a step of a bind target, as it is of the left of `:=`
(forms.md, language.md). The control shows what the read
`rows[i].title` reads and writes what `rows[i].title := v` writes, through
the same setter: the element of a `List` at an `Int`, the entry of a `Map` at
a key. The key is any expression of the index's type and is read again on
every render, so a control bound through `rows[i]` follows the slot `i`, and
`for k in m.keys input(bind=m[k].text)` binds each entry of a Map where it is
shown. An index
that names no element panics the render, as the read does. Every control that
binds takes one — `input`, `textarea`, `select`, `slider`, `check`, `switch`,
`radio`, `editable` — and an `input` reads its text as the bound element's or
entry's `Int`, `Float` or `Time`, as it does for a slot. A refinement on the
element or entry refuses a write through the index as it refuses the same
write by `:=`, and `error(field=…)` and a `form`'s submit judge what the
control shows.

Only a `Map` and a `List` have places to index, so an index into anything
else is **E0602**, with the sentence the same step gets on the left of `:=`
(`bind` for `assign`). On `slot s : Set(Text)`, `bind=s["a"]` gets:

> `Cannot bind through an index into "Set(Text)": a Set has members, not places — use .add / .remove / .toggle`

E0229's message says a bind writes back to "a slot or a path into one" (it
said "a field path"), and for a `for` variable it names binding the row
through the slot by a Map key or an index the page holds. The `data-kumiki-bind` marker spells an index step as
the key it names (`rows[0].title`, `notes["a"]`), and the focus a render
restores finds the control by comparing markers as strings rather than
splicing one into a selector, which a quoted key would break.
