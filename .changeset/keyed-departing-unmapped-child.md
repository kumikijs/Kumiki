---
"@kumikijs/runtime": patch
---

fix(runtime): a keyed child that leaves without an element mapping now reaches
the same panic as one that stays, instead of being skipped in silence.

The keyed child pass treated one broken invariant two ways. A surviving child
with no entry in the node → element map threw, and the reconcile bailout
recorded a `location: "reconcile"` panic — loud without a diagnostic sink. A
departing one hit `if (oldChildEl && …)` in the removal loop, where the failed
lookup read as "nothing to remove": nothing thrown, nothing reported, and the
element the renderer had hand-built left mounted for as long as the app runs.

That silence undercut the placement gate's stated reason for letting an unmapped
child through. The gate declines the keyed pass for a child mounted below a
renderer-owned wrapper, but steps over an unmapped one on the grounds that the
pass throws on it — an invariant break, not a placement style. For a departure
it did not, so the one arrangement the gate was reasoning about (an unmapped
child under a parent that otherwise qualifies) reached neither channel. A
renderer that builds a child outside `ctx.render` was invisible for exactly as
long as that child was on its way out.

The pass now resolves every old child's element before it reconciles, mounts, or
removes anything, and throws there. What a child was about to be no longer
decides whether its broken invariant is heard, and the throw leaves the pass
having applied nothing — the rule §10.3.10 already stated for the structural
walk, now stated for this one. The panic's full rebuild is also what clears the
stranded element, which the silent skip never did.

Two guards went with it. The removal loop's `parentNode === parentEl` could not
be false once the gate had passed, and reconciling a survivor only splices
within that survivor's own slot, so it never became false mid-pass either; both
it and the anchor scan's copy are gone, and what guarantees them is named where
they were. A violation now surfaces as a `removeChild` throw on the same panic
path rather than as a skipped removal.

No example accompanies this. It is reachable only from a host renderer that
places a child without going through `ctx.render`, which is not something a
`.kumiki` program can express at any tier the repo has — the same position as
the keyed-placement fixes before it. The runtime unit tier covers it: a
departing unmapped child now panics, and a newcomer's renderer is not called
before it does.
