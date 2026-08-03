---
"@kumikijs/runtime": minor
---

fix(runtime): a keyed child with no element mapping now reaches the same panic
whether it stays, leaves, or sits under a parent the keyed pass was about to
decline for another reason.

The keyed child pass treated one broken invariant three ways. A surviving child
with no entry in the node → element map threw, and the reconcile bailout
recorded a `location: "reconcile"` panic — loud without a diagnostic sink. A
departing one hit `if (oldChildEl && …)` in the removal loop, where the failed
lookup read as "nothing to remove": nothing thrown, nothing reported, and the
element the renderer had hand-built left mounted for as long as the app runs.
And under a parent whose renderer does not place every child directly, the
`unplaceable-insert` decline came first, so the pass that would have thrown was
never entered at all.

That silence undercut the placement gate's stated reason for letting an unmapped
child through. The gate declines the keyed pass for a child mounted below a
renderer-owned wrapper, but steps over an unmapped one on the grounds that the
pass throws on it — an invariant break, not a placement style. For a departure
and for a later decline it did not, so the one arrangement the gate was
reasoning about reached neither the panic nor `child-unmapped`. A renderer that
builds a child outside `ctx.render` was invisible for exactly as long as that
child was on its way out.

The mapping is now resolved the moment the measured placement check comes back
clean — ahead of the declared-placement check, and before anything is
reconciled, mounted, or removed — and a missing one throws there. Neither what a
child was about to be nor which reason the parent might have had to decline
decides whether its broken invariant is heard, and the throw leaves the pass
having applied nothing: the rule §10.3.10 already stated for the structural
walk, now stated for this one. The panic's full rebuild is also what clears the
stranded element, which the silent skip never did.

Two guards went with it. The removal loop's `parentNode === parentEl` could not
be false once the gate had passed, and nothing the pass itself does can undo
that, so both it and the anchor scan's copy are gone and what guarantees them is
named where they were. Should host code running in between ever move a departure
out, `removeChild` surfaces it as a panic on the same path rather than as a
skipped removal.

No example accompanies this. It is reachable only from a host renderer that
places a child without going through `ctx.render`, which is not something a
`.kumiki` program can express at any tier the repo has — the same position as
the keyed-placement fixes before it. The runtime unit tier covers all three
arrangements.
