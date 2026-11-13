---
"@kumikijs/compiler": patch
---

E0212 says its ids are those of the elements that hand the event to a reducer, not of every element that fires it

E0212 (`--strict-selector-id`) lists the ids of the elements a
`ui.<ev>(Tile#id)` subscription is wired onto, and called them every element
of the tile "that fires" the event. Every element fires `click`, though, and
only the `button`, `check`, `radio` and `switch` renderers hand it to a
reducer. For `tile Toolbar = row(button(text="Save", id="save"), text("label", id="label")) {id: "toolbar"}`,
before:

> Reducer "hit" subscribes to ui.click(Toolbar#toolbar) but every element of tile "Toolbar" that fires "click" has id "save" — this selector can never match

After:

> Reducer "hit" subscribes to ui.click(Toolbar#toolbar) but every element of tile "Toolbar" that hands "click" to a reducer has id "save" — this selector can never match

Which selectors E0212 reports is unchanged.
