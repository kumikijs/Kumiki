---
"@kumikijs/compiler": patch
---

A builtin tile's prop is checked against the type stdlib.md gives it, and a value that cannot have that type is **E0201** at the value.

Every non-handler prop of a builtin went through the checker with no expected type, so a value of the wrong type passed `check` and rendered as JavaScript reads it:

```kumiki
select(bind=fruit, options=["apple", "pear"])
modal(text("MODAL BODY"), open="false", title="Confirm", onClose=close)
button(text="dis", disabled="true")
```

Before, `check` said `ok`, and the page showed two `<option value="undefined">undefined</option>` entries, an open modal (`"false"` is a non-empty text) and an enabled button (`"true"` is not `true`). After, for the issue's program:

```
E0201 type-mismatch at 5:31: Expected {label, value} but got Text
E0201 type-mismatch at 5:40: Expected {label, value} but got Text
E0201 type-mismatch at 6:34: Expected Bool but got Text
E0201 type-mismatch at 7:31: Expected Bool but got Text
```

The same props written in the `{…}` block are reported the same way. The new table in stdlib.md §2.3.11 lists what is checked: the `Bool` and `Text` props forms.md §5.3 gives every input element (`disabled`, `readonly`, `required`, `auto-focus`, `placeholder`, `auto-complete`), the `form` props of forms.md §5.2.1, `select` `options` (a `List` of records with a `label` and a `value`; other fields are allowed), `open` on `modal` / `drawer` / `popover` / `details`, `button` `loading`, `input` `multiple`, `check` / `switch` `value`, `radio` `selected`, `link` `external`, `list` `ordered`, `video` `controls` / `autoplay`, and the numbers `heading` `level`, `slider` `value` / `min` / `max` / `step` and `progress` `value` / `max` (an `Int` is accepted wherever a `Float` is). A slot or computed value of the right type (`disabled=draft.is-empty`, `open=n > 3`), options from a `fn` or `.map`, and the props of a user tile are unaffected. Two forms that rendered before are now reported, because the spec types them: `placeholder=5` (forms.md §5.3 says `Text`) and `form {auto-complete: "off"}` (forms.md §5.2.1 says `Bool`).
