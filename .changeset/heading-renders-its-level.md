---
"@kumikijs/runtime": patch
---

Render `heading(level=n, …)` as `<h{n}>`

stdlib.md §2.3 gives `heading` a `level` prop (1-6), and the compiler passes it
through, but both renderers always drew an `<h1>`. A page written as an
`h1` > `h2` > `h3` outline rendered as a flat run of `h1`s, which broke the
document outline and the heading navigation screen readers use.

The DOM renderer and the SSR renderer share one `headingTag`, so both draw
`<h1>` … `<h6>` for the level, and `<h1>` when there is none. A fractional
level drops its fraction, and one outside 1-6 is drawn at the nearer end. A
level that changes between renders re-creates the element through the patcher's
`PatchRequiresRebuild`, the path `list` takes when `ordered` flips. §2.3.2
states this in both language tracks. `packages/examples/features/156-heading-level.kumiki`
has an outline and a slot-driven level.
