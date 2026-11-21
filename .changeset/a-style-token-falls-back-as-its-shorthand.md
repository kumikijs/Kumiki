---
"@kumikijs/runtime": patch
---

A `@radius` or `@shadow` reference in a `style` block that the theme leaves out takes the same default as the `radius` / `shadow` shorthand, and every `@` reference reads the app's theme under `kumiki smoke`, `kumiki run` and the test loaders.

With no `radius.md` or `shadow.sm` in the theme, `style: {border-radius: @radius.md, box-shadow: @shadow.sm}` rendered `border-radius: 16px` (the `md` spacing) and `box-shadow: sm`, which a browser drops, while `radius: "md", shadow: "sm"` rendered `8px` and `0 1px 2px rgba(0,0,0,0.1)`. Both now render the shorthand's values. A key the theme does set was read correctly and is unchanged.

A program compiled with its runtime inlined (`bundle: true`), as `kumiki smoke` and `kumiki run` compile it, and mounted with another copy of the runtime read no theme in its `@` references: they took the built-in defaults, so a theme's `spacing.md: 99` rendered as `16px`. The copies now share the app a render pass draws, as they already shared the panic sink. A page built with `kumiki build` has one copy and rendered correctly before.
