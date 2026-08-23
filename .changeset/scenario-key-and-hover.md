---
"@kumikijs/runtime": minor
---

feat(runtime): the scenario tier can fire keydown and mouseenter.

`ui.key` and `ui.hover` lift to `onKeyDown` / `onMouseEnter`, which the runtime
wires through the same per-element slot as `onFocus` / `onBlur`. `focus` and
`blur` exist as scenario actions precisely so that `addEventListener →
applyUiEventHandlers → reducer` path could be asserted; the other two had no
action, no example driving them and no reach from `smoke`, which dispatches only
click, input and change. A regression in either would have passed check, build,
smoke, every scenario and the whole suite.

`{"key": "<selector>", "value": "<key>"}` dispatches a `KeyboardEvent` carrying
that key, and `{"hover": "<selector>"}` dispatches a `mouseenter`. Both go to
the element the selector matches, not to a parent: neither event bubbles, and
the runtime attaches the listener on the tile element itself. A `ui.key`
reducer's payload carries `key` and `code`; only `key` is set from this tier,
because a `code` names a physical key that a scenario asking for `"Enter"` has
not chosen.

The browser tier does not run these two yet, and now says so by name rather
than reporting them as unknown actions.
