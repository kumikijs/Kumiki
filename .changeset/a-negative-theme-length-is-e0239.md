---
"@kumikijs/compiler": patch
---

A negative `spacing` token or `breakpoints` width in a `theme` is E0239, reported at the number.

```kumiki
theme T = {
    spacing: {nudge: -4},
    breakpoints: {md: -500}
}

tile App = column(text("hi")) {pad: "nudge", gap: {base: "sm", md: "lg"}}

app A
    caps   = []
    theme  = T
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

Before, `kumiki check` printed `ok`, and at a 1024px viewport the column
rendered `gap: 8px; padding: -4px`. A browser drops `padding: -4px`, which is
not valid CSS, so the tile got no padding; and `md: -500` took the place of the
768px default and was then ignored as no breakpoint, so the `gap` map fell back
to `base`. Now:

```
$ kumiki check app.kumiki
E0239 negative-theme-length at 2:22: theme "T": spacing "nudge" is -4, and padding and gap cannot be negative, so it has no effect — write a length of 0 or more (see docs/spec/style.md)
E0239 negative-theme-length at 3:23: theme "T": breakpoint "md" is -500, and a minimum viewport width cannot be negative, so "md" is not a breakpoint at all — write a width of 0 or more (see docs/spec/style.md)
```

0 is in range: `flush: 0` is no padding, and `md: 0` applies at every width.
Every theme is checked, whether or not the app names it. A string is not read,
so `nudge: "-4px"` still passes. A theme that kept a negative token for a
`style` block (`style: {margin-top: @spacing.pull}`) writes the length there
instead, `style: {margin-top: -4}`, where a negative value is the CSS
property's own.
