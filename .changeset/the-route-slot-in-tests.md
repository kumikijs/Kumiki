---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

Seed the `route` slot in the test harness, the way `mount` does

A reducer that reads `route.path` works in an app and panicked under `kumiki
test`: `route` is maintained by the runtime rather than declared by a program,
so the harness — which rebuilt its slot table from the declared slots and the
test's `given` — had no such slot, and there was no way to write a passing test
for that reducer at all. E0119 makes reading it the *recommended* spelling, so
this was reachable by following the compiler's own advice.

`resetLive`, the seam all three test kinds share (and `run-reducer` inside a
property test), now seeds `route` with the same empty route `mount` seeds. A
test may name `route` in `given.slots` to drive a reducer that branches on the
current route, and one that names only some of its fields takes the empty
route's values for the rest — an abbreviation cannot hand a reducer an
undefined `params`.

`given.slots` / `expect.slots` naming `route` is no longer `E0103 undef-slot`:
a reserved slot name is a slot a test may write, which is the only kind of slot
the program cannot declare itself.
