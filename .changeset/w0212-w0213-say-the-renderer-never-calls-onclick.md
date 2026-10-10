---
"@kumikijs/compiler": patch
---

W0212 and W0213 say a renderer never calls onClick, not that nothing fires click

Every element fires `click`. Only the `button`, `check`, `switch` and `radio`
renderers call `onClick`, but W0212 said a tile holding any other kind "has no
descendant that fires" `click`. W0213 said a `link` or a `row` "does not fire
it", and that a user tile "renders nothing that fires it". Before:

> Reducer "hit" subscribes to ui.click(Label) but tile "Label" has no descendant that fires "click" (DOM-allowed: button, check, switch, radio; observed in body: text). The handler is silently dropped.

> "onClick" on link() is dropped — link does not fire it. Put it on button / check / radio / switch, or subscribe with a reducer's on=ui.<event>(<Tile>)

After:

> Reducer "hit" subscribes to ui.click(Label) but "click" never reaches a reducer in tile "Label": a text fires "click", and its renderer never calls onClick (DOM-allowed: button, check, switch, radio; observed in body: text). The handler is silently dropped.

> "onClick" on link() is dropped — a link fires "click", and its renderer keeps it for navigation, never calling onClick. Put it on button / check / radio / switch, or subscribe with a reducer's on=ui.<event>(<Tile>)

> "onClick" on row() is dropped — a row fires "click", and its renderer never calls onClick. Put it on …

> "onClick" on Inner() is dropped — Inner renders nothing that calls it: a box / text fires "click", and its renderer never calls onClick (observed in body: box, text). Put it on …

W0213 now gives the reason W0212 gives for the same kind, from the same
record. That also covers `onInput` on a `slider`, `check`, `radio`, `switch`
or `select`: each fires `input`, and W0213 says what its renderer does with
the event instead. A clause names its kinds after `a` or `an`, as the first
kind takes (`an image / text fires "click"`).

Which diagnostics are reported is unchanged. So is the message where the
element fires nothing: `ui.focus` on a `box`, `ui.change` on an `editable`,
`ui.input` on a `text`, and `onChange` on a `row`.
