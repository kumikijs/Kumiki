---
"@kumikijs/compiler": patch
---

Accept an `aria-label` written as an argument under `--strict-a11y`

A named argument is a prop wherever it is written (`docs/spec/language.md`
§1.7.1), and `button(aria-label="Close")` puts `aria-label` on the element
exactly as `button() {aria-label: "Close"}` does. E0701 and E0703 looked for
`aria-label` in the props block only, so a correctly labelled control was
rejected:

```
$ kumiki check --strict-a11y aria.kumiki
E0701 a11y-button at 3:10: button must have a text= argument or aria-label prop
E0703 a11y-link at 4:10: link must have inner text or aria-label
```

for `button(aria-label="Close")` and `link(to="/", aria-label="Home")`.

Every `--strict-a11y` check now reads the prop it asks about through one rule,
the one E0705 already used for `for` on `label`: the prop is read in either
spelling. `aria-label` on `button` and `link` and `alt` on `image` count
whatever their value, a slot or an empty string included, as they already did
in the props block. Both programs above pass, and a `button()` or
`link(to="/")` with no `aria-label` in either spelling is still reported.

An argument that parses as a tile is not prop data and renders no attribute, so
it names nothing: `button(aria-label=CloseIcon)` is still E0701. The same rule
now applies to `alt`, which E0702 used to count whatever it held, so
`image(src=u, alt=when(c, text("A")))` (an `<img>` with no `alt`) is E0702.
Any other `alt` argument on an `image` parses as a value and is read as before.

E0701's message no longer names a spelling for the label:

> `button must have a text= argument or aria-label`

`docs/spec/errors.md` says which spellings count, in both language tracks, and
`packages/examples/features/220-a11y-aria-label-argument.kumiki` is a button and
a link named each way, clicked by that name in its scenario.
