---
"@kumikijs/runtime": minor
"@kumikijs/cli": patch
---

feat(runtime): report a tile whose data props can never compare equal, closing
the one way to burn a render budget that the diagnostics channel could not see
(#219).

**The gap.** `onDiagnostic` reported every decision where the walker *loses*
identity — `no-patcher`, `child-count-change`, `child-hole`, `child-unmapped`,
`wrapped-children`, `unplaceable-insert`. All of them fire on a rebuild path.
A tile whose data props compare unequal on every render while a patcher is
registered for its kind is the identity-preserving happy path as far as the
walker is concerned: the patcher runs, the element survives, nothing degraded,
so nothing was reported. The app is correct and looks healthy; it is just
re-applying the same attributes forever.

**`never-equal-prop`** is the mirror image of `stale-closure-risk` on the other
side of the equality fork. It reads the unequal decision for a value that could
not have compared equal however identical the two renders were, and names the
field: a non-plain object (`Date`, `Map`, `Set`, `RegExp`, a DOM node, a class
instance, or a cross-realm object — only `===` can make two of those equal) or
`NaN`. Same `hostTileKinds` scope and the same one-level-into-`props` bound as
the stale-closure scan, so a built-in never produces one and the walk stays
bounded on the render path. Neither cause can come out of codegen; the whole
class is reachable only through `MountOptions.tiles` or a host-built tree, which
is exactly the audience this channel exists for.

Both host-tile scans are now guarded as a whole rather than only at the sink.
Reading a host node's fields runs `Object.keys`, property getters and
`Object.getPrototypeOf` against values the host owns, and the equality kernel
short-circuits at the first difference — so a Proxy trap or an accessor can
throw where the kernel never reached. That throw would have landed in the
reconcile bailout as a panic and rebuilt the whole tree, which is the identity
loss the channel exists to report. The scan is abandoned instead.

- Fires whether or not a patcher is registered. With one it is the only signal
  that the tile churns; without one the rebuild is already reported as
  `no-patcher` and this names the field that reason cannot. Both are emitted,
  cause before consequence.
- A value reports only once both sides are of the same never-equal shape — a
  plain bag becoming a `Date` is an ordinary change on the render it happens and
  reports on the next one. The same instance handed over twice compares equal
  through `===` and is never reported.
- A mount without `onDiagnostic` runs the pre-existing code path plus one `?.`
  check, unchanged.

**Consumers.** `describeDiagnostic` gains wording per cause, with the same
`never`-typed exhaustiveness tripwire `describeFallback` carries. `kumiki dev`
warns rather than errors — the running code is correct, only wasteful.
`kumiki smoke`'s per-reason summary now labels every non-fallback diagnostic by
its kind instead of assuming any non-fallback is a stale closure, so a future
kind cannot be silently counted as an existing one.

**Spec** — `docs/spec/runtime.md` §10.3.12 documents the kind and its two
causes, and §10.3.13's non-plain-object and `NaN` rules link to it. The JA
mirror gains both, including §10.3.13 itself, which had never been translated.
