---
"@kumikijs/runtime": minor
---

fix(runtime): the keyed diff no longer tears children out of a wrapping
renderer, and the walker's placement contract is written down.

**The bug.** The keyed child pass matches children by `key` and then moves the
survivors with `parentEl.appendChild` and drops the departures with
`parentEl.removeChild`. Both only address elements the parent element holds
directly — and `overlay` does not: it wraps every child after the first in an
absolutely-positioned layer, so the elements the reconciler has mapped are
grandchildren. An overlay whose layers all carried a key (an
`overlay(for l in layers Layer(l))`, where the `for` binding supplies an
implicit key) therefore lost its stacking on the first reorder: children were
appended straight onto the overlay and the emptied layer divs were left behind,
one more per render. Nothing threw and nothing was reported. Host renderers hit
the same shape by appending children to anything other than the element they
return.

**The fix.** Keyed matching now additionally requires that every child's mounted
element be a direct child of the parent's element. When it is not, the walker
declines the keyed pass and runs the structural walk, which never repositions
anything and stays correct under a wrapping renderer. The decline is reported
through `onDiagnostic` as a new `ReconcileFallback` reason,
`wrapped-children` (with `index` and `childKind`) — the one reason that rebuilds
nothing, since what it costs is reorder-stable element identity rather than a
subtree.

**Why the contract needed saying.** `reconcileNode` returns the element now
occupying a node's slot, and who may place that element was implicit: a rebuilt
subtree is spliced in by `replaceWithFreshTile`, anchored on the OLD element's
own parent, precisely because the parent tile's *renderer* decides where a child
sits. A caller may only place the returned element itself once it has
established that it owns the slots — which is now stated on `reconcileNode`,
enforced by the gate above, and spelled out at the one call site that discards
the return value on purpose.

Documented in spec §10.3.10 (keyed matching's placement precondition) and
§10.3.12 (the new reason), with a runnable example at
`packages/examples/features/59-overlay-keyed-layers.kumiki`.
