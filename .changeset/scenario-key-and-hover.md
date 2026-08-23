---
"@kumikijs/runtime": minor
---

feat(runtime): the scenario tier can fire keydown and mouseenter.

`ui.key` and `ui.hover` lift to `onKeyDown` / `onMouseEnter`, which the runtime
wires through the same per-element slot as `onFocus` / `onBlur`. `focus` and
`blur` exist as scenario actions precisely so that `addEventListener →
applyUiEventHandlers → reducer` path could be asserted; the other two had no
action, no example driving them and no reach from `smoke`, which dispatches only
click, input, change and submit. The runtime's own tests fire all four directly,
so a wiring regression was not invisible — but nothing in the example corpus
could reach these two, so a program that renders and then ignores a key press
passed check, build, smoke and every scenario.

`{"key": "<selector>", "value": "<key>"}` dispatches a `KeyboardEvent` carrying
that key, and `{"hover": "<selector>"}` dispatches a `mouseenter`. Both are
dispatched on the element the selector matches, which is where the runtime
attaches its listener. `keydown` bubbles from there — that is what lets
`ui.key(Container)` be driven from a focusable descendant — while `mouseenter`
does not, since a browser fires a separate one on each ancestor rather than
propagating a single event.

A `ui.key` reducer's payload carries `key` and `code`; only `key` is set from
this tier, because a `code` names a physical key that a scenario asking for
`"Enter"` has not chosen. `value` is required and must be non-empty: the event's
`key` defaults to the empty string and the listener never reads it, so a step
pressing nothing would fire the reducer and report success.

The browser tier does not run these two yet, and now says so by name rather
than reporting them as unknown actions.
