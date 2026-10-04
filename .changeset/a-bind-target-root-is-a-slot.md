---
"@kumikijs/compiler": patch
---

Report a `bind=` target whose root is not a slot (E0229)

The checker never asked what a `bind=` target names. It read the value like
any other, so every name in scope passed, and the lowering took whatever name
it reached as the slot to write:

```kumiki
slot todos : List(Todo) = [{text: "milk"}]
slot title : Text = "t"
tile Row in=Text = input(bind=$1)
tile P = column(
  for t in todos input(bind=t.text),
  Row(title),
  input(bind="title"))
```

```
$ kumiki check p.kumiki
ok
```

Each of the three fields took every edit and changed nothing the page reads.
The first two wrote into the live slot table under the local's name — after
typing in both, `Object.keys(app.live)` was `["todos", "title", "route", "t",
"$1"]` — so `todos` and `title` kept their values; the literal got no bind at
all.

A `bind=` target is a slot, or a field path into one (forms.md §5.1), and its
root has to be a slot where the target is written. Each of these is now
**E0229 `bind-target-not-slot`**, at the target, naming the root and what the
checker knows it to be:

> `input(bind=…) cannot write to "t": it is the variable of a for, not a slot — a bind writes back to a slot or a field path into one. To edit a row, show it with value= and update the list from a reducer (see docs/spec/forms.md §5.1)`
>
> `input(bind=…) cannot write to "$1": it is this tile's input, not a slot — …`
>
> `input(bind=…) cannot write to the text literal "title": a literal is a value, not a slot — … Write the slot's name without quotes: bind=title …`

A local named like a slot hides it, as for any read, so `for title in xs
input(bind=title)` is reported beside a slot `title`; so are a `match`
binding, the `route`, a number or `Bool` literal, and any other expression
(`bind=f(x)`, `bind=a + b`). Every control that writes back from a bind is
asked — `input`, `textarea`, `select`, `slider`, `check`, `switch`, `radio`,
`editable`. A slot, a field path into one (`bind=form.email`,
`bind=form.addr.city`) and an `Option`'s payload (`bind=d.get.title`) check as
before, and so does a slot bound by name inside a tile that takes an input.

The checker and the lowering read a target through one function, so the root
the checker asks about is the one the lowering writes. forms.md §5.1 now says
which targets `bind=` accepts and shows how a row of a list is edited: show it
with `value=`, carry its key in its props, and write the list from a reducer
on the row's event.
