---
"@kumikijs/compiler": minor
---

`()` has the type `Unit`, so it is refused where another type is declared (#427).

The unit literal had no type in the checker, and a value with no type is accepted everywhere. So `Card(())` against `tile Card in={label: Text}` passed `check` while `Card(42)` was E0201, and the tile mounted with a `null` it then read `.label` from. A `tile-test`'s `given = {…, in: ()}` got the same pass and died in `kumiki test` with a bare `TypeError`.

`()` is now a `Unit`. It is E0201 at the `()` in a tile call, a `fn` call, a slot's value or an assignment, and E0202 in an `emit` argument. It is still accepted wherever `Unit` is declared: a `Unit` slot, the ok side of a `Result(Unit, E)`, a `Unit` parameter. `emit e(())` on an `in=Unit` effect is unchanged: that effect takes no argument, which is already E0213.
