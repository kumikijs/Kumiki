---
"@kumikijs/compiler": minor
"@kumikijs/runtime": patch
---

Let a `ui.input` selector reach an `editable`

`reducer edited on=ui.input(Ed)` with `tile Ed = editable(…)` compiled to
nothing: the lift table listed `input` and `textarea` only, so codegen emitted
no handler and the reducer never ran. The checker reported it — as W0212, with
a reason that was not true, saying the tile has no descendant that fires
`input`. It does: the `editable` renderer registers its own `input` listener
and calls the tile's `onInput` from it, which is why writing the handler on the
tile (`editable(onInput=edited)`) already worked.

**A subscription that did nothing now runs.** An app carrying a
`ui.input(<editable tile>)` reducer got the W0212 warning and no behaviour;
after this it gets the behaviour and no warning.

`change` is deliberately not extended the same way — a `contenteditable`
element fires no `change` event, so that row's omission is the rule, not a gap.

The scenario runner's `fill` verb now writes an `editable` through
`textContent`, the property its renderer reads back, and dispatches `input`
alone. Filling one used to set a `value` the element does not read, so the
event carried the text the control held *before* the step.
