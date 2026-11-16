---
"@kumikijs/compiler": patch
---

A record field named `_tag` is refused (E0240), since the runtime reads a record that has one as a variant

At run time a variant is a record whose `_tag` field holds its name, and that
field is how the runtime tells a variant from a record. The checker accepted a
record field of that name, so the record ran as a variant:

```kumiki
type R = {_tag: Text, n: Int}

slot r : R = {_tag="a", n=1}

tile App = text("r is " + r.show)

app Shown
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Before, `kumiki check` printed `ok`, and the page read `r is a`: `show`
renders a variant as its tag, where the record `{tag="a", n=1}` shows as
`{tag: "a", n: 1}`.

After:

```
$ kumiki check app.kumiki
error E0240 reserved-field-name at 1:11: Record field "_tag" is reserved: the runtime marks a variant with a field of that name, so a record that has one is read as a variant. Name the field something else — "tag"
error E0240 reserved-field-name at 3:15: …
```

It is reported at each field so named, in a record type wherever one is
written (a type, a payload, a slot, a `fn`'s parameter or result, an effect's
or a tile's `in=`) and in a record literal wherever an expression goes. Only
`_tag` is refused: `tag`, `_tags`, `_Tag` and `_0` are names of their own, and
a Map keyed by the text `"_tag"` names no field.
