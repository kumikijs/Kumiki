---
"@kumikijs/compiler": minor
---

Let a `ui.key` / `ui.focus` / `ui.blur` selector reach an `editable`

`reducer entered on=ui.focus(Ed)` with `tile Ed = editable(…)` compiled to
nothing, and the same for `ui.key` and `ui.blur`: the lift table's three rows
listed `input` / `textarea` / `button` (/ `select`), so codegen emitted no
handler and the reducer never ran. The checker reported it as W0212, with a
reason that was not true — that the tile has no descendant firing the event.

It does. A `<div contenteditable="true">` is an editing host, so it is
focusable without a `tabindex` and `focus`, `blur` and `keydown` all reach it
— which is why writing the handler on the tile (`editable(onFocus=entered)`)
already worked. What those rows list is where a *selector* lands, so an
omission there is a gap in the table rather than a fact about the DOM, the
same shape as #287's `ui.input`.

This moves `editable` only. The same three rows still omit `slider`, `link`,
and `select` under `key`, each for no recorded reason, and `check` / `radio` /
`switch` are half a case (their `<label>` sees a bubbled `keydown` but not
`focus` / `blur`). Those are behaviour changes for kinds #367 did not name, so
they are tracked separately and the §W0212 note says which blanks are rules
and which are coverage.

**A subscription that did nothing now runs.** An app carrying a
`ui.key` / `ui.focus` / `ui.blur` reducer aimed at an `editable` got the W0212
warning and no behaviour; after this it gets the behaviour and no warning.

`change` is still deliberately not extended, and `errors.md` now says why in
both language tracks, alongside the code comment that already did: a
`contenteditable` element fires no `change` event at all, so `ui.change` on an
`editable` is W0212 for a reason that is true.
