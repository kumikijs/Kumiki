---
"@kumikijs/compiler": patch
---

A positional argument on a builtin that renders none — `button`, `input`, `progress`, `divider`, … — is E0129 `unrendered-arg`, tile or value, and the message names what the builtin shows instead.

Only the containers (`column`, `row`, `card`, `form`, `modal`, `tooltip`, …) render their positional arguments. The checker counted every builtin that is not a value builtin as one, so a tile written on `button` or `progress` passed `check` and was dropped from the page:

```
tile Header = text("header")
tile P = column(button(Header, text="Go"), progress(text("a")), text("end"))
# before: ok, and the page shows "Go" and "end" but no "header" and no "a"
# after:  E0129 2:24 button renders no positional argument, so this one is never rendered. Write it as `text=`, or show it beside the button
#         E0129 2:53 progress renders no positional argument, so this one is never rendered. Write it as `value=` or `max=`, or show it beside the progress
```

A value there was E0128, whose advice did not help — `button(text("Go"))` renders nothing either:

```
tile P = column(button("Go", text="x"))
# before: E0128 A value is not a tile: button renders a positional argument only when it is a tile, so this one renders nothing. Show the value with a tile — `text(…)` — …
# after:  E0129 button renders no positional argument, so this one is never rendered. Write it as `text=`, or show it beside the button
```

`divider`, `spinner`, `skeleton` and `route-outlet` show nothing an argument gives them, and are told to show it beside the builtin. `image("a.png")` and `icon("home")` draw the same form, naming `src=` and `name=`, where they said ``image takes its src as `src=` …``; like the others, the argument is not checked inside, so `image(nope)` is E0129 alone where it was E0129 and E0103.

A container keeps E0128 and its `text(…)` advice for a value, and renders a tile as before. `divider` no longer lowers its positional arguments as children, which the runtime never rendered.
