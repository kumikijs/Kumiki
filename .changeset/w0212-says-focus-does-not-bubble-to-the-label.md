---
"@kumikijs/compiler": patch
---

W0212 gives the true reason when the element fires the event and no reducer hears it

W0212 said "tile has no descendant that fires" the event for every
subscription it reports. For some kinds that was not true: the element does
fire the event, and something else keeps it from the reducer.

**`ui.focus` / `ui.blur` on a `check`, `radio` or `switch`.** These render a
`<label>` around their `<input>`, the listener sits on the label, and `focus` /
`blur` from the `<input>` do not bubble to it. Before:

> Reducer "r" subscribes to ui.focus(D) but tile "D" has no descendant that fires "focus" (…)

After:

> Reducer "r" subscribes to ui.focus(D) but "focus" never reaches a listener in tile "D": a check listens on the <label> around its <input>, and the "focus" that <input> fires does not bubble to the <label> (…)

**`ui.click` on a `link`, and `ui.input` on a `slider`, `check`, `radio`,
`switch` or `select`.** The `<a>` fires `click`, and its renderer keeps it for
navigation. A range input, a checkbox, a radio and a `<select>` all fire
`input`. The slider's renderer listens for it only to write the bind, and the
others' renderers listen for `change` instead. None of them calls the handler.
Before:

> Reducer "r" subscribes to ui.input(D) but tile "D" has no descendant that fires "input" (…; observed in body: slider) …

After:

> Reducer "r" subscribes to ui.input(D) but "input" never reaches a reducer in tile "D": a slider fires "input", and its renderer listens for it only to write the bind, never calling onInput (…)

These reasons are also given when such a kind is reached through the tile's
body (`tile D = box(Inner)`). Kinds that share a reason are named together
(`a check / select fires "input", …`). Which diagnostics are reported is
unchanged. So is the message where the element fires nothing:
`box(text(…))` × `focus`, `editable` × `change`, and `ui.submit` on a `check`.
`text` × `click` keeps its message too, although a `<span>` does fire `click`;
that wording is #823.

Each reason comes from the lift table row that leaves the kind out. The
label-wrapped focus / blur case is read from whether the event bubbles. The
others are read from a record of the runtime-policy absences on the `click`
and `input` rows. A row and the reason W0212 gives for it cannot disagree.
