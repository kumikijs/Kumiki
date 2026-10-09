---
"@kumikijs/compiler": patch
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
(forms.md §5.1, language.md §1.6.3). The control shows what the read
`rows[i].title` reads and writes what `rows[i].title := v` writes, through
the same setter: the element of a `List` at an `Int`, the entry of a `Map` at
a key. The key is any expression and is read again on every render, so a
control bound through `rows[i]` follows the slot `i`, and `for k in m.keys
input(bind=m[k].text)` binds each entry of a Map where it is shown. An index
that names no element panics the render, as the read does. Every control that
binds takes one — `input`, `textarea`, `select`, `slider`, `check`, `switch`,
`radio`, `editable` — and a number field reads its text as the element's
`Int` / `Float` / `Time`.

A `Set` has no places, so an index into one is **E0602**, with the sentence
`s[x] := v` gets:

> `Cannot bind through an index into "Set": a Set has members, not places — use .add / .remove / .toggle`

E0229's message says a bind writes back to "a slot or a path into one" (it
said "a field path"). The `data-kumiki-bind` marker spells an index step as
the key it names (`rows[0].title`, `notes["a"]`), and the focus a render
restores finds the control by comparing markers as strings rather than
splicing one into a selector, which a quoted key would break.
