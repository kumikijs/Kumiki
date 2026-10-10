---
"@kumikijs/compiler": patch
---

W0213 reports onFocus / onBlur on a check, radio, switch or details

A `check`, `radio` or `switch` renders a `<label>` around its `<input>`, and a
`details` renders a `<details>` around its `<summary>`. A handler written on
the tile is attached to that wrapper, and the `focus` / `blur` the inner
element fires does not bubble there, so `onFocus=` / `onBlur=` on one of these
never ran. W0212 already reported the subscription form (`ui.focus(Agree)`).
The prop form compiled with no diagnostic. Before, for
`tile Agree = check(bind=agreed, onFocus=agreeFocus)`: nothing.

After:

> "onFocus" on check() is dropped — a check listens on the <label> around its <input>, and the "focus" that <input> fires does not bubble to the <label>. Put it on button / editable / input / link / select / slider / textarea / video, or subscribe with a reducer's on=ui.<event>(<Tile>)

A user tile whose body renders only such controls is reported too:

> "onFocus" on Inner() is dropped — Inner renders nothing where "focus" reaches it: a check listens on the <label> around its <input>, and the "focus" that <input> fires does not bubble to the <label> (observed in body: check). Put it on …

The reason is the clause W0212 gives for `ui.focus` / `ui.blur` on the same
kind, read from the same record in `ui-lifts.ts`. The pairs newly reported are
`onFocus` and `onBlur` on `check`, `radio`, `switch` and `details`, written on
the builtin or on a user tile that renders one. `onKeyDown` on these four is
still not reported: a keydown bubbles to the `<label>` and the `<details>`, so
it runs. A container (`row(onFocus=r)`) is still not reported either.
