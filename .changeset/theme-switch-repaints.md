---
"@kumikijs/runtime": patch
---

Repaint every tile when `app.theme`'s slot switches the theme

With `app … theme = themeName`, changing the slot re-applied only the body
style and the base stylesheet. Token props (`bg`, `color`, `pad`, `gap`,
`radius`, …) are resolved to literal values when a tile renders, and the
reconciler leaves a tile untouched when its own props did not change. After a
Light → Dark toggle the page background was dark, but every box kept Light's
colours and spacing.

Each view now records the theme its tree was painted under. A pass that finds
the resolved theme changed builds the tree afresh instead of diffing it, so
every tile, nested ones included, carries the new theme's values, the same as
a fresh mount under that theme. That applies to a hydrated view too. Focus and
selection come back the way they do after any rebuild; DOM state no slot holds
starts over. runtime.md §10.3.6 describes what a switch re-applies, in both
language tracks. `packages/examples/features/157-theme-switch.kumiki` toggles
between two themes.
