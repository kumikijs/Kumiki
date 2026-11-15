---
"@kumikijs/compiler": patch
---

A record field named `_tag` is refused (E0240), since the runtime reads a record that has one as a variant

At run time a variant is a record whose `_tag` field holds its name, and that
field is how the runtime tells a variant from a record. The checker accepted a
record field of that name, so the record ran as a variant:

```kumiki
type R = {_tag: Text, n: Int}

slot pick : R = {_tag="a", n=2}

fn picks() -> List({label: Text, value: R})
   = [{label: "one", value: {_tag="a", n=1}},
      {label: "two", value: {_tag="a", n=2}}]

tile App = column(
             select(bind=pick, options=picks()) {id: "pick"},
             text("n: " + pick.n.show))
```

Before, `kumiki check` printed `ok`. A `select` keys a variant by its `_tag`
and its payload, so the two options were one: after choosing "one", choosing
"two" left `n: 1` on the page.

After:

```
$ kumiki check app.kumiki
error E0240 reserved-field-name at 1:11: Record field "_tag" is reserved: the runtime marks a variant with a field of that name, so a record that has one is read as a variant. Name the field something else — "tag"
error E0240 reserved-field-name at 3:18: …
error E0240 reserved-field-name at 6:30: …
error E0240 reserved-field-name at 7:30: …
```

It is reported at each field so named, in a record type wherever one is
written (a type, a payload, a slot, a `fn`'s parameter or result, an effect's
or a tile's `in=`) and in a record literal wherever an expression goes. Only
`_tag` is refused: `tag`, `_tags`, `_Tag` and `_0` are names of their own, and
a Map keyed by the text `"_tag"` names no field.
