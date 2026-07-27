---
"@kumikijs/runtime": patch
---

fix(runtime): the reconcile prop-equality kernel no longer reuses a tile across
two different `Date` / `Map` / class instances, and its rules are written down.

**The bug.** `tileValueEqual` ends in a key-wise object comparison, which is
complete only for values whose entire state IS their own enumerable properties.
`Object.keys(new Date())` is `[]` — so two different `Date`s (and `Map`, `Set`,
`RegExp`, DOM nodes, class instances) compared *equal*, and a tile carrying one
kept its mounted element when the value behind it had changed. Nothing threw and
nothing was reported: the element simply stayed stale. The code comment already
claimed these were conservatively treated as unequal; now they actually are.
Kumiki codegen emits only plain data, so this was unreachable from a `.kumiki`
source — it protects renderers supplied through `MountOptions.tiles`. The same
instance passed twice still compares equal through `===`.

**The rules, now normative.** Spec §10.3.13 states what "the tile's data props
did not change" means, which §10.3.10 and §10.3.11 both hang on: which fields
are compared (own fields except `kind`, `children`, `key`), that an absent key
and an explicit `undefined` are equal, that comparison is `===`-based so `null`
/ `""` / `0` / `false` never collapse into each other, that two functions are
always equal (closure identity is ignored on purpose — see the
`stale-closure-risk` diagnostic), that `NaN` is not equal to itself, and that a
non-plain object is never equal to anything but itself.

Pinned by `packages/runtime/test/reconcile-equality.test.ts`, which drives the
real walker — `mountCore` with spy renderers and an empty patcher registry,
where "props compared equal" and "the element survived the re-render" are the
same fact — rather than exporting the predicate for tests.
