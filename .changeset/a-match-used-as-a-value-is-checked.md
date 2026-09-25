---
"@kumikijs/compiler": minor
---

A `match` used as a value is checked against where it lands (#435).

Each arm's pattern bound its payload with the right type, so `| Some(id) -> p := id` was reported — but the value the arms produced was never compared with the destination. `p := match ou with | Some(id) -> id | None -> p` put a `UserId` into a `PostId` slot and `check` said `ok`, while `p := ou.get-or(p)`, the same mistake spelled the other way, was E0201.

Now a declared destination (a slot assignment, a `fn`'s return type, an argument) checks every arm the way it already checked both branches of an `if`, reporting at the arm that does not fit. Where nothing declares a type — a `let`, a comparison operand — the `match` has its arms' common type, the same one an `if` gets. When the arms disagree, that is the base they share with the nominal dropped (`UserId` and `PostId` arms give `Text`). The `match` has no type only when the arms share no base or one arm's type cannot be decided, so nothing new reports on a `match` the checker cannot read.
