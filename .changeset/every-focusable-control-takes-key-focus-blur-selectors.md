---
"@kumikijs/compiler": patch
---

`ui.key` / `ui.focus` / `ui.blur` selectors now reach `slider`, `link` and `select`, and `ui.key` now reaches `check` / `radio` / `switch` (#456).

These are the same gap #367 closed for `editable`. The runtime attaches the three listeners to the element each tile renders, and these kinds receive the events there. Before this change the lift table left them out: codegen dropped the handler, and W0212 reported the tile as having "no descendant that fires" the event. That was untrue for an `<input type="range">`, an `<a href>` and a `<select>`.

The three rows are now built from two named lists in `ui-lifts.ts`, so they cannot drift apart:

- **Focusable roots** (`input`, `textarea`, `button`, `select`, `slider`, `editable`, `link`) are in `key`, `focus` and `blur`.
- **Label-wrapped controls** (`check`, `radio`, `switch`) are in `key` only. Their listener sits on a `<label>`. A `keydown` from the inner checkbox bubbles up to it, but `focus` and `blur` do not bubble, so W0212 stays for those two, and it is now true.

On a link, `ui.key` runs before the browser acts on the key. On Enter, the link is then activated and the router navigates as usual, so the reducer cannot cancel the navigation. `click` on a link stays reserved for navigation.
