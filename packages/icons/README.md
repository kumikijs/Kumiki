# @kumikijs/icons

Built-in icon set for [Kumiki](https://github.com/kumikijs/Kumiki) apps. Each icon is the `d` attribute of a single `<path>` inside a 24×24 viewBox, filled with `currentColor` at render time.

```ts
import { check, ALL_ICONS, ICON_NAMES } from "@kumikijs/icons";
```

## How it reaches a Kumiki app

You usually don't import this package by hand. `@kumikijs/vite` and the `kumiki` CLI scan compiled `.kumiki` sources for `icon(name="…")` literals and bake only the referenced paths into the generated `AppShape.icons`. Apps that don't use icons pay zero bundle cost.

Custom icons go through `theme.icons` — see [spec/style.md §4.8](../../docs/spec/style.md#48-icons) for the closed name set, props, and resolution order. A `theme.icons[name]` entry overrides any built-in of the same name.

```kumiki
theme MyTheme = {
    icons: {
        logo: "M3 3h18v18H3z..."  ; user override or a name not in the built-in set
    }
}
```

## Visual style

Heroicons v2 Solid (MIT) — 24×24 viewBox, single-path, fill-based. Custom registrations should follow the same convention for visual consistency.
