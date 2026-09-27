---
"@kumikijs/runtime": patch
---

Resolve a responsive `cols` / `rows` map, and use the theme's breakpoints

style.md §4.5 shows `grid(A, B, C, D) { cols: {base: 1, md: 2, lg: 4} }`, but
the grid's tracks accepted only a number or a string. A breakpoint map fell
through to the default `repeat(3, 1fr)`, so the grid had three columns on a
phone and three on a desktop. The SSR renderer carried its own copy with the
same gap. Separately, the viewport pick hard-coded 640 / 768 / 1024 / 1280 px,
so a theme that declared `md: "500px"` still switched at 768 px.

The grid's `cols` and `rows` now go through the same responsive pick as
`gap` / `pad`: the viewport's breakpoint on mount, `base` in SSR. The DOM and SSR
renderers share one `gridTracks`. The pick reads the active theme's
`breakpoints` over the §4.2 defaults, so a theme can move a key or add one of its
own. §4.5 states this in both language tracks.
`packages/examples/features/158-responsive-breakpoints.kumiki` uses a theme with
moved and added breakpoints, and the e2e tier checks its grid in Chromium at
four viewport widths.
