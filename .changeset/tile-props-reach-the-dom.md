---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

fix: make the documented tile props reach the DOM.

**A prop's name had two spellings.** The compiler lowers a Kumiki name to a
JS-safe key (`test-id` → `test_id`, `max-w` → `max_w`), while `TileProps` is an
open record — so a runtime that read `props["max-w"]` type-checked, rendered,
and did nothing. Every app in the corpus set a page width that never applied.
The lowered name is now the only spelling the runtime reads, and the guard is a
table that starts from `.kumiki` source and ends at an attribute or a CSS
declaration, on both rendering paths: a hand-built `TileNode` can agree with the
runtime about a spelling the compiler never emits, which is how this survived a
suite that compared the two paths to each other.

**A named argument was dropped unless its kind lifted it.** The spec writes
`button(text="Log in", loading=pending)` a few lines from `{variant: "ghost"}`,
so the two forms have to arrive alike; instead, `image(alt="A cat")` satisfied
the a11y check and rendered no `alt`. Every named argument now folds into the
props — the generalization of the `id` fold that already existed for selector
matching — so it reaches the renderers and the `$el` payload from either form.

Now applied to **every kind**, client and server alike, because the mapping
moved out of the per-kind renderers and into the one pass that sees every
element: `class` (added to the runtime's own classes, not over them), `aria` and
a bare `aria-*`, `test-id` as `data-kumiki-test`, `role`, `id`, the style
shorthands (`bg`, `color`, `pad`, `pad-x` / `pad-y`, `gap-x` / `gap-y`,
`radius`, `shadow`, `size`, `weight`) and the sizing props (`w`, `h`, `min-w`,
`min-h`, `max-w`, `max-h`, `aspect`, `wrap`) — so a `max-w` on an `image` and a
`bg` on a `button`, both of which the spec's own examples write, now land. A
kind that maps a prop itself keeps it: a `spinner`'s and an `icon`'s `size`, a
`skeleton`'s `h`. `radius` and `shadow` read the theme sections of those names
rather than the spacing scale, and the SSR pass resolves the theme at all,
which it did not: a themed page was served with the unthemed defaults.

Per tile: a `button`'s `loading` (disabled, `aria-busy`, a spinner in front of
the label), `disabled` and `variant`; an `image`'s `width` / `height` /
`loading`; a `link`'s `external`; a `divider`'s `orientation`; and the input
family's `disabled` / `readonly` / `auto-complete`, which forms.md §5.3 calls
their common props. All of it is diffed on the reconcile's patch path, so a
`class` bound to a slot swaps rather than accumulates and a `max-w` that goes
away leaves.

**New diagnostic `E0705` (`a11y-label-for`)**, under `--strict-a11y`: a
`label {for: "x"}` whose literal target matches no `id="x"` anywhere in the
program. Two of the example apps had five such labels between them.

`style.md` §4.4.7 drops `"sm"` from `w`: there is no width scale in the theme,
so it was a token name with nothing behind it. `testing.md` §8.8 now names the
global that exists (`window.__kumikiApp.live`) instead of one that never did.
