---
"@kumikijs/compiler": patch
---

A `let` declared in an `if` branch ends with that branch, in `check` as in the built code (#398).

Each branch of an `if` is a scope of its own (`language.md` §1.6.7), and the emitted reducer has always treated it as one. `check` did not, so a program that read a branch's `let` after the `if` — or in the other branch — was reported `ok`, built, mounted, and then threw `n is not defined` the first time the reducer ran.

That read is now **E0103** at the read. A `let` declared before the `if` is still readable in both branches and after it, a branch can still shadow it for itself, and which slots count as written after the `if` (E0601) is unchanged.

The type a branch gives a name now ends with the branch too. Before, a branch that shadowed an outer `let` left its type behind for the statements after the `if`, while the value they read was still the outer one:

- a valid program was rejected: with `let n = 5` before the `if` and `let n = "s"` in a branch, `total := n` into an `Int` slot after the `if` reported **E0201** `Expected Int but got Text`; it is now `ok`;
- a wrong one was accepted: the same program writing `note := n` into a `Text` slot reported `ok`, so an `Int` went into a `Text` slot; it is now **E0201** `Expected Text but got Int`.

A `let $route = …` in a branch now ends with the branch as well: reading `$route` after the `if` is **E0119**, where it used to be reported `ok`.
