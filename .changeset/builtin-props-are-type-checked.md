---
"@kumikijs/compiler": patch
---

A builtin tile's prop is checked against the type stdlib.md gives it, and a value that cannot have that type is **E0201** at the value. This also refuses `placeholder=5`, `form {auto-complete: false}` and a `select` option whose `label` is not a `Text`.

Every non-handler prop of a builtin went through the checker with no expected type, so a value of the wrong type passed `check` and rendered as JavaScript reads it:

```kumiki
slot fruit : Text = "apple"
slot n : Int = 0
reducer close on=ui.click(_) do= n := n + 1
tile App = column(
  select(bind=fruit, options=["apple", "pear"]),
  modal(text("MODAL BODY"), open="false", title="Confirm", onClose=close),
  button(text="dis", disabled="true"),
  text("fruit=" + fruit))
app M
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Before, `check` said `ok`, and the page showed two `<option value="undefined">undefined</option>` entries, an open modal (`"false"` is a non-empty text) and an enabled button (`"true"` is not `true`). After:

```
E0201 type-mismatch at 5:31: Expected {label: Text, value} but got Text
E0201 type-mismatch at 5:40: Expected {label: Text, value} but got Text
E0201 type-mismatch at 6:34: Expected Bool but got Text
E0201 type-mismatch at 7:31: Expected Bool but got Text
```

The same props written in the `{…}` block of the builtin's own call are reported the same way. The new table in stdlib.md §2.3.11 lists what is checked: the `Bool` and `Text` props of forms.md §5.3 on the input elements (`disabled`, `readonly`, `required`, `auto-focus`, `placeholder`, `auto-complete`), the `form` props of forms.md §5.2.1, `select` `options` (a `List` of records with a `Text` `label` and a `value`; other fields are allowed), `open` on `modal` / `drawer` / `popover` / `details`, `button` `loading`, `input` `multiple`, `check` / `switch` `value`, `radio` `selected`, `link` `external`, `list` `ordered`, `video` `controls` / `autoplay`, and the numbers `heading` `level`, `slider` `value` / `min` / `max` / `step` and `progress` `value` / `max` (an `Int` is accepted wherever a `Float` is). A value written as an `if`, `match` or `let` is judged branch by branch, so `options=if flag then opts else names` is E0201 at `names`. A slot or computed value of the right type (`disabled=draft.is-empty`, `open=n > 3`) and options from a `fn` are accepted. A prop written on a user tile is not checked against the table, and neither is a list built with `.map`, whose type is not inferred.

Of those three, `placeholder=5` rendered a placeholder of "5", and forms.md §5.3 types it as `Text`. forms.md §5.2.1 now types `form`'s `auto-complete` as `Text`, the `on` / `off` HTML's `<form autocomplete>` takes, where it said `Bool`; no renderer reads it yet. An option's `label` is the `Text` it shows: `{label: Some("x"), value: "a"}` rendered `[object Object]`, and `{label: 7, value: "a"}`, which showed `7`, is refused as well; show a number with `.show`.
