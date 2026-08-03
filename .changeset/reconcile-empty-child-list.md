---
"@kumikijs/runtime": minor
---

fix(runtime): a child list crossing the empty boundary keeps its parent, and a
keyed newcomer is no longer appended bare under a wrapping renderer.

**Two bugs, one root.** The keyed child pass may only run when the parent
element actually holds its children's slots, and until now the walker answered
that by measuring where the mounted children sit. A measurement can only speak
for slots that already exist, so it is unsound for any old list too short to
have exercised the renderer's wrapping rule — and `overlay`, which places its
first child in normal flow and wraps the rest, is exactly that renderer at both
of the short lengths.

- **At zero.** `allChildrenKeyed` returned `false` for an empty array, so a
  parent whose old child list was empty could never take the keyed path.
  `[] → [keyed…]` and `[keyed…] → []` both fell to the structural walk, which
  saw a length change, reported `child-count-change`, and rebuilt the parent
  subtree — discarding the container's element and whatever browser-owned state
  it held. That is the "empty state → first item" transition: an empty todo
  list, a result set before the first query, an empty cart. It is precisely
  where the author has already given every child a key, and the runtime
  declined to use it.
- **At one.** With exactly one mounted child, `overlay` measures as placing its
  children directly — truthfully. Growing to two then took the keyed path and
  appended the newcomer straight onto the overlay, with no positioning layer
  around it and no diagnostic. Silent DOM damage.

**The fix.** A child list that is empty on exactly one side is now decided
before keys are consulted at all: there is nothing to pair, so the only question
left is where the new children go, and the runtime asks the one component that
knows — it re-enters the parent's renderer for a fresh interior and moves that
into the mounted element. The parent keeps its element, the interior is what a
full render would have produced (so a wrapping renderer stays correct), and
neither `child-count-change` nor `wrapped-children` is reported. The decision is
key-agnostic because keys had nothing to match, which also picks up the
commonest unkeyed shape in real Kumiki, `column(when(open, X))`.

Whether a *newcomer* can be placed is now read from the renderer's declared
placement instead of from the DOM, since nothing can measure a slot that does
not exist yet. The declaration covers the built-ins that wrap — `overlay`, and
`modal` / `drawer` / `popover`, which wrap all of theirs in a content div (§10.3.10
previously named only `overlay`). It bites only when there is something to
place, so a same-membership render of a one-child overlay still takes the keyed
path. A decline is reported through `onDiagnostic` as a new `ReconcileFallback`
reason, `unplaceable-insert` (with `index` and `childKind` of the newcomer).
Host renderers are absent from the declaration on purpose: the spec asks them to
place their children directly under the element they return, so an unknown kind
is taken at its word.

**Known limitation.** Re-entering the renderer rebuilds its non-child interior
too — a `details`' `<summary>`, a surface's content wrapper and title. That is
strictly less than the whole-parent rebuild it replaces, but not nothing; the
complete answer is a `ctx` seam letting a renderer refill its own child slots.

A test mounts every container kind and compares the DOM its renderer produced
against the declared set, so the two cannot drift.
