---
"@kumikijs/compiler": minor
---

`ui.key` / `ui.focus` / `ui.blur` selectors now reach `slider` and `link`, and `ui.key` now reaches `select` and `check` / `radio` / `switch` (#456). `ui.focus` / `ui.blur` already reached `select`.

These are the same gap #367 closed for `editable`. The runtime attaches the three listeners to the element each tile renders, and these kinds receive the events there. Before this change the lift table left them out: codegen dropped the handler, and W0212 reported the tile as having "no descendant that fires" the event. That was untrue for an `<input type="range">`, an `<a href>` and a `<select>`.

The three rows are now built from two named lists in `ui-lifts.ts`, so they cannot drift apart:

- **Focusable roots** (`input`, `textarea`, `button`, `select`, `slider`, `editable`, `link`) are in `key`, `focus` and `blur`.
- **Label-wrapped controls** (`check`, `radio`, `switch`) are in `key` only. Their listener sits on a `<label>`. A `keydown` from the inner `<input>` bubbles up to it, but `focus` and `blur` do not bubble, so W0212 is still correct to emit for those two events. Its message says no descendant fires them, which overstates it; the wording is tracked separately (#526).

On a link, `ui.key` runs before the browser acts on the key. On Enter, the link is then activated and the router navigates as usual, so the reducer cannot cancel the navigation. `click` on a link stays reserved for navigation.

**A subscription that did nothing now runs.** The rows only grow. A `ui.key` reducer aimed at a container (`ui.key(Form)` over `tile Form = column(…)`) used to wire only to an `input` / `textarea` / `button` descendant. It now also wires to a `link` / `slider` / `select` / `check` / `radio` / `switch` descendant. The same holds for `ui.focus` / `ui.blur` with `link` / `slider`. A reducer aimed directly at one of those kinds used to get W0212 and no behaviour; it now gets the behaviour and no warning. Check such reducers for keys or focus changes they did not expect.

`video` (with `controls`) and `details` are not in these rows yet (#525).
