---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

Render the input props the stdlib tables list: `check`'s `label`, `fieldset`'s `legend`, a radio's `name=` and a slider's one-way `value=`

All four passed `kumiki check` and were then dropped:

```kumiki
check(value=agreed) {label: "I agree to the terms"}
fieldset(legend="Billing", input(placeholder="card"))
radio(name="grp", value="a", selected=(mode == "a")) {label: "Option A"}
slider(value=vol, min=0, max=100)
```

Before, as mounted (the served HTML left out the same four):

```html
<label data-kumiki-tile="check"><input type="checkbox"></label>
<div data-kumiki-tile="fieldset"><input … placeholder="card"></div>
<label data-kumiki-tile="radio"><input type="radio"><span>Option A</span></label>
<input data-kumiki-tile="slider" type="range" min="0" max="100">
```

so the checkbox had no text, the fieldset no caption, radios written with
`name=` were not one group, and the slider sat at the browser default instead
of at `vol`. After:

```html
<label data-kumiki-tile="check"><input type="checkbox"><span>I agree to the terms</span></label>
<fieldset data-kumiki-tile="fieldset" style="…"><legend>Billing</legend><input … placeholder="card"></fieldset>
<label data-kumiki-tile="radio"><input type="radio" name="grp"><span>Option A</span></label>
<input data-kumiki-tile="slider" type="range" min="0" max="100">   <!-- .value is "10" -->
```

- A `check`'s `label` is a `<span>` after its box, as a `radio`'s already was.
  A label that is not Text follows the `legend` rule on both, on the client and
  in `renderToString` alike: a number shows its digits, and a Bool shows nothing.
- A `fieldset`'s `legend`, written in the props block or as a named argument,
  is a `<legend>` ahead of its children. One read from a slot follows it, and
  an empty one writes none. The fieldset is now a real `<fieldset>`, so the
  `<legend>` is valid markup and names the group for assistive technology; the
  browser's margin, border, padding and min-width are reset to `0`, so it lays
  out as the `<div>` it was.
- Adding or removing a legend no longer moves focus to a sibling input with no
  `bind` or `id`: after a pass, focus goes back to the element that had it while
  that element is still in the view, and only a rebuilt one is found by position.
- A radio's group is its `<input>`'s `name`. The spec names the prop `group`
  everywhere now — the stdlib table said `name`, forms.md §5.5.2 said `group` —
  and a radio written with `name` is grouped by it the same way, as an argument
  or in the props block. With both, `group` is read, and `kumiki check` warns
  `W0217 name-beside-group`.
- A `slider` with no `bind` shows its `value`, written as an argument or in the
  props block, and follows it when a reducer writes the slot, even while the
  slider keeps focus after a drag. With a `bind`, the bound slot is shown, as
  before, and a `value` beside it warns `W0216 selection-beside-bind`.

`renderToString` writes the same elements. A `fieldset` now ships as its own
runtime module, `tiles-input-fieldset.js`, with the other form tiles, instead
of in `tiles-layout.js`, which any app with a `column`, `row` or `page`
downloads: an app with no fieldset does not download the legend. An app whose
only form tile is a `fieldset` now also downloads `tiles-input-shared.js`, which
every form tile's module brings along.
