---
"@kumikijs/runtime": minor
---

Serve the element tree the client builds, for every tile kind

The SSR parity gate compared a hand-written half of the tile catalogue, and it
compared the **root element only** — every fixture had `children: []`. So a kind
with no row was indistinguishable from a kind verified to agree, and a kind
whose children differed passed on the strength of its outer `<div>`.

Eight kinds diverged. The server served an `error` as a `<div>` with no colour
where the renderer builds a red `<span>`; a `toast` without the padding and
corners the renderer paints; `data-lang` on the `<pre>` rather than on the
`<code>` the renderer marks; a `tooltip` without `data-placement`; a `markdown`
body as its raw source in one text node instead of the paragraphs the renderer
parses, so the first paint ran the whole document together into one block; an
`overlay`'s children flat, without the absolutely-positioned layer each one
after the first is wrapped in, so a stack painted as a column; and a closed
`modal` / `drawer` / `popover` as an empty string rather than the
present-but-hidden host the renderer mounts — so a crawler was served a page
with the dialog's content missing and the first paint laid out as if the
surface were not there.

Two divergences were the client's. A `<select>` carried no `data-kumiki-bind`,
though §10.3.5 names it alongside `input` / `textarea` and §10.3.9 re-identifies
a focused picker by that marker; and a `modal` had neither `role="dialog"` nor
the `aria-label` its `title` gives it, both of which the served page already
had and the client's first render then dropped. An overlay layer and a modal
host now stretch with the four inset longhands instead of the `inset`
shorthand, which a DOM that does not implement it — `happy-dom`, the one
`kumiki smoke` runs in — drops on assignment, leaving the layer covering
nothing. The server also stopped serving `title=""` / `placeholder=""` /
`colspan="0"` and the like where the renderer writes no attribute at all, and
it now skips the `null` children a `when` leaves behind rather than throwing on
the first one.

The gate itself is now total over `TileNode["kind"]` and compares the subtree
rather than the root, so a kind with no row fails to typecheck and a kind whose
children drift fails the suite. Form state the client keeps as a non-reflecting
property (`value`, `checked`, `selected`) is asserted on the served markup
directly, since an attribute dropped from both sides of a comparison is one the
comparison cannot speak for.
