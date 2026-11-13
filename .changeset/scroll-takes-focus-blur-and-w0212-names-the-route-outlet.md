---
"@kumikijs/compiler": patch
---

`ui.focus` / `ui.blur` reach a `scroll`, and W0212 says why `ui.key` does not reach one and why no subscription reaches the tile a `route-outlet` shows

A `scroll` renders a `<div>` with `overflow: auto`. In Chromium, Tab stops on
that `<div>` when its content overflows and it holds nothing focusable, and
`focus`, `keydown` and `blur` fire on the `<div>` itself. The lift table left
`scroll` out of all three rows, so W0212 said the tile had "no descendant that
fires" the event. `scroll` is now in the `focus` and `blur` rows: `ui.focus(Pane)`
over `tile Pane = scroll(…)` runs when Tab or `.focus()` focuses an overflowing
scroll. One whose content fits takes no focus, so neither fires; that is a
property of the instance, as `controls` is of a `video`.

`ui.key` is still not lifted onto a scroll. The `keydown` of every tile inside
it bubbles to its `<div>`, and a control there already carries the
subscription, so a listener on the `<div>` as well would run the reducer twice
for each key pressed in that control. W0212 now says so:

> Reducer "r" subscribes to ui.key(Pane) but "key" never reaches a listener in tile "Pane": a scroll takes no "key" listener on its <div>, since a control inside it takes the subscription instead — write onKeyDown= on the scroll to hear a "key" on its <div> (…)

A tile that holds a `route-outlet` got the same untrue wording: the tile the
route shows in the outlet is a descendant once the app runs. The route picks it
at runtime and renders it on its own, so the subscription is not lifted onto it
(the reducer does not run for it, in Chromium or in happy-dom). W0212 now says
that, beside its clauses for the rest of the body:

> Reducer "shellKey" subscribes to ui.key(Shell) but "key" never reaches a reducer in tile "Shell": the tile its route-outlet shows is picked by the route at runtime and rendered on its own, so ui.key(Shell) is not lifted onto it — subscribe to that tile instead (…)

**A subscription that did nothing now runs.** A reducer aimed at a scroll with
`ui.focus` or `ui.blur` used to get W0212 and no behaviour; it now runs when an
overflowing scroll takes focus. A reducer aimed at a container that holds a
scroll (`ui.focus(Page)` over `tile Page = column(scroll(…), input(…))`) used to
wire only to the `input`, and now also wires to the scroll. The W0212 message
lists `scroll` among the DOM-allowed kinds of the `focus` and `blur` rows, and
W0213 names it among the tiles to put `onFocus` / `onBlur` on.
