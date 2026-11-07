---
"@kumikijs/compiler": patch
---

Accept an `aria-label` written as an argument under `--strict-a11y`, and report an `image` whose `alt` argument is a `when` / `for`

A named argument is a prop wherever it is written (`docs/spec/language.md`),
and `button(aria-label="Close")` puts `aria-label` on the element exactly as
`button() {aria-label: "Close"}` does. E0701 and E0703 looked for `aria-label`
in the props block only, so a correctly labelled control was rejected:

```
$ kumiki check --strict-a11y aria.kumiki
E0701 a11y-button at 3:10: button must have a text= argument or aria-label prop
E0703 a11y-link at 4:10: link must have inner text or aria-label
```

for `button(aria-label="Close")` and `link(to="/", aria-label="Home")`.

`aria-label` (E0701 / E0703) and `alt` (E0702) are now read through the rule
E0705 already used for `for` on `label`: either spelling counts, and where both
are written the props block's is read, as it is the one rendered. They count
whatever their value, a slot or an empty string included, as they already did
in the props block. Both programs above pass, and a `button()` or
`link(to="/")` with no `aria-label` in either spelling is still reported. A
value that is not a `Text` is not checked yet: `button(aria-label=Mark)`
passes and renders `aria-label="[object Object]"` (#988).

An argument that parses as a tile — a `when` or `for` — is not prop data and
renders no attribute, so it names nothing: `button(aria-label=when(c, text("x")))`
is still E0701. The same rule now applies to `alt`, which E0702 used to count
whatever it held, so `image(src=u, alt=when(c, text("A")))` and
`image(src=u, alt=for x in xs text(x))` (an `<img>` with no `alt`) are E0702.

The messages of E0701 and E0702 no longer name a spelling:

> `button must have a text= argument or aria-label`
>
> `image must have an alt`

`docs/spec/errors.md` says which spellings count, in both language tracks, and
`packages/examples/features/220-a11y-aria-label-argument.kumiki` is a button and
a link named each way, clicked by that name in its scenario.
