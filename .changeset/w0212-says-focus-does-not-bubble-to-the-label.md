---
"@kumikijs/compiler": patch
---

W0212 no longer says a check, radio, switch, select, slider or link fires nothing when it does fire the subscribed event, and says what keeps the event from the reducer instead

W0212 said "tile has no descendant that fires" the event for every
subscription it reports. For some kinds that was not true: the element does
fire the event, and something else keeps it from the reducer.

**`ui.focus` / `ui.blur` on a `check`, `radio` or `switch`.** These render a
`<label>` around their `<input>`, the runtime listens for `focus` / `blur` on
the label, and `focus` / `blur` from the `<input>` do not bubble to it. Before:

> Reducer "r" subscribes to ui.focus(D) but tile "D" has no descendant that fires "focus" (…)

After:

> Reducer "r" subscribes to ui.focus(D) but "focus" never reaches a listener in tile "D": the runtime listens for "focus" on a check's <label>, and the "focus" its <input> fires does not bubble to the <label> (…)

**`ui.click` on a `link`, and `ui.input` on a `slider`, `check`, `radio`,
`switch` or `select`.** The `<a>` fires `click`, and its renderer listens for
it only to navigate. A range input, a checkbox, a radio and a `<select>` all
fire `input`. The slider's renderer listens for it only to write the bind, and
the others' renderers listen for `change` instead. None of them calls the
handler. Before:

> Reducer "r" subscribes to ui.input(D) but tile "D" has no descendant that fires "input" (…; observed in body: slider) …

After:

> Reducer "r" subscribes to ui.input(D) but "input" never reaches a reducer in tile "D": a slider fires "input", and its renderer listens for it only to write the bind, never calling onInput (…)

These reasons are also given when such a kind is reached through the tile's
body (`tile D = box(Inner)`). Kinds that share a reason are named together
(`a check / select fires "input", …`). Which diagnostics are reported is
unchanged. So is the message where the element fires nothing:
`box(text(…))` × `focus`, `editable` × `change`, and `ui.submit` on a `check`.
`text` × `click` keeps its message too, although a `<span>` does fire `click`.
