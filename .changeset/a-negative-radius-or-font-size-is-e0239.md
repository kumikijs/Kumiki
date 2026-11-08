---
"@kumikijs/compiler": patch
---

A negative `radius` or `typography.size` number in a `theme` is E0239 too, reported at the number.

```kumiki
theme T = {
    radius: {soft: -4},
    typography: {size: {tiny: -4}}
}

tile App = column(text("hi") {size: "tiny"}) {radius: "soft"}

app A
    caps   = []
    theme  = T
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Before, `kumiki check` printed `ok`, and the column rendered
`border-radius: -4px` and the text `font-size: -4px`. A browser drops both,
which are not valid CSS, so the column kept square corners and the text kept
the size it inherits. Now:

```
$ kumiki check app.kumiki
error E0239 negative-theme-length at 2:20: theme "T": radius "soft" is -4, and a corner radius cannot be negative, so it has no effect — write a length of 0 or more (see docs/spec/style.md)
error E0239 negative-theme-length at 3:31: theme "T": typography size "tiny" is -4, and a font size cannot be negative, so it has no effect — write a size of 0 or more (see docs/spec/style.md)
```

0 is in range: `square: 0` rounds nothing, and a font size of 0 hides the
text. A string is not read, so `soft: "-4px"` still passes, and the rest of
`typography` (`weight`, `line-height`) is not checked.
