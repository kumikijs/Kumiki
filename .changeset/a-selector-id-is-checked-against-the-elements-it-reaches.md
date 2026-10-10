---
"@kumikijs/compiler": patch
---

Check a `Tile#id` selector against the ids of the elements it is wired onto (E0212)

`--strict-selector-id` compared a selector's `#id` with one thing: the `{id: "…"}`
props block on the root of the tile's body. At run time `#id` is compared with
the element that dispatched, and on a container that is a descendant. So the
check reported the selector that works and passed the ones that never fire:

```kumiki
tile Bar  = row(button(text="Save", id="save"), button(text="Other", id="other")) {id: "bar"}
tile Btn2 = button(text="Two", id="two")

reducer hitB on=ui.click(Bar#save) do= ...   # fires on Save
reducer hitA on=ui.click(Bar#bar)  do= ...   # never fires: a row dispatches no click
reducer hit2 on=ui.click(Btn2#tow) do= ...   # never fires: a typo against id="two"
```

```
$ kumiki check selid.kumiki --strict-selector-id
E0212 … ui.click(Bar#save) but tile "Bar" is declared with id "bar" — this selector can never match
```

Now the id set is the ids of the elements the subscription is wired onto: every
element under the tile whose kind fires the event, found by the same walk W0212
uses (through child tiles, every `for` / `when` / `if` / `match` branch, and the
`error-boundary` fallback of a tile called inside it), with the id read in
either spelling, `{id: "x"}` or `id="x"`, and as each user-tile call site leaves
it (`Btn(id="b")` gives the element `Btn` renders at its root the id `"b"`).
Where any of those ids is computed or missing, E0212 stays silent.

```
$ kumiki check selid.kumiki --strict-selector-id
E0212 … ui.click(Bar#bar) but every element of tile "Bar" that fires "click" has id "other" | "save" — this selector can never match
E0212 … ui.click(Btn2#tow) but every element of tile "Btn2" that fires "click" has id "two" — this selector can never match
```

The message changes wording to say which elements it read. One W0212 case
changes with it: a container whose only element that fires the event is in a
nested tile's `error-boundary` fallback is no longer reported, because the
subscription is wired onto that fallback when it renders.
