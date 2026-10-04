---
"@kumikijs/compiler": patch
---

W0212 gives the true reason for `ui.focus` / `ui.blur` on a `check`, `radio` or `switch`

`reducer r on=ui.focus(D)` with `tile D = check(value=done)` is W0212, and
correctly so: a `check` renders a `<label>` around its `<input>`, its listener
sits on the label, and `focus` / `blur` from the `<input>` do not bubble to it.
The message gave a different reason, which was not true:

> Reducer "r" subscribes to ui.focus(D) but tile "D" has no descendant that fires "focus" (…)

The `<input>` does fire `focus`. The message now says what happens:

> Reducer "r" subscribes to ui.focus(D) but "focus" never reaches a listener in tile "D": a check listens on the <label> around its <input>, and the "focus" that <input> fires does not bubble to the <label> (…)

The same reason is given for `ui.blur`, for `radio` and `switch`, and for a
tile that reaches one of them through its body (`tile D = box(Inner)`). When
the body holds several, all of them are named (`a check / switch listens …`).
Which diagnostics are reported is unchanged, and so is the message everywhere
else, including a tile with nothing focusable in it (`box(text(…))`) and an
event the control does not fire at all (`ui.submit` on a `check`).

The reason comes from the same table that leaves these kinds out of the
`focus` and `blur` rows, so the row and the reason cannot disagree.
