---
"@kumikijs/compiler": patch
---

`ui.key` / `ui.focus` / `ui.blur` reach a `video`, and W0212 says why they do not reach a `details` (#525)

A `<video>` rendered with `controls` is focusable and in the tab order, and the
runtime's listeners are on that element. The lift table left `video` out of all
three rows, so codegen dropped the handler and W0212 said the tile had "no
descendant that fires" the event. Before:

> Reducer "r" subscribes to ui.focus(V) but tile "V" has no descendant that fires "focus" (DOM-allowed: input, textarea, button, select, slider, editable, link; observed in body: video). The handler is silently dropped.

After, `video` is in all three rows: `ui.focus(V)` over
`tile V = video(src=…, controls=true)` runs when Tab or a click focuses the
video, `ui.blur(V)` when focus leaves it, and `ui.key(V)` for a key pressed
while the `<video>` itself has focus. A key pressed while one of its own play /
volume / fullscreen buttons has focus does not reach it. A `video` without
`controls` takes no focus at all, so none of the three fires. That is a property
of the instance, as `disabled` is of a button, so the rows list `video` either
way.

A `details` stays out of all three rows, and W0212 now gives the reason instead
of saying no descendant fires the event. Its `<summary>` takes focus inside the
`<details>` the listener would sit on. `focus` and `blur` do not bubble from the
summary to it:

> Reducer "r" subscribes to ui.focus(D) but "focus" never reaches a listener in tile "D": a details listens on the <details> around its <summary>, and the "focus" that <summary> fires does not bubble to the <details> (…)

`keydown` does bubble there, and so does the keydown of every tile in the panel.
A control in the panel that the `key` row lists already carries the subscription
lifted onto it, so a listener on the `<details>` as well would run the reducer
twice for each key pressed in that control (measured in Chromium). So:

> Reducer "r" subscribes to ui.key(D) but "key" never reaches a listener in tile "D": a details takes no "key" listener on the <details> around its <summary>, since one there would also hear every "key" from the tiles inside it (…)

A key on the summary reaches a handler written on the details itself
(`details(…, onKeyDown=r)`), which hears every key from its panel too.

**A subscription that did nothing now runs.** The rows only grow. A reducer
aimed at a `video` with `ui.key`, `ui.focus` or `ui.blur` used to get W0212 and
no behaviour; it now gets the behaviour and no warning. A reducer aimed at a
container (`ui.focus(Player)` over `tile Player = column(video(…), button(…))`)
used to wire only to the `button`; it now also wires to the `video`. Check such
reducers for keys or focus changes they did not expect. Which `details`
subscriptions run is unchanged: `ui.key(D)` still reaches a listed control in
its panel, once per key, and nothing else.

The W0212 message lists `video` among the DOM-allowed kinds of the three rows,
so the parenthesised list in every `ui.key` / `ui.focus` / `ui.blur` W0212
message is longer by one.
