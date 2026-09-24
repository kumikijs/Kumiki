---
"@kumikijs/compiler": patch
---

A `let` declared in an `if` branch ends with that branch, in `check` as in the built code (#398).

Each branch of an `if` is a scope of its own (`language.md` §1.6.7), and the emitted reducer has always treated it as one. `check` did not, so a program that read a branch's `let` after the `if` — or in the other branch — was reported `ok`, built, mounted, and then threw `n is not defined` the first time the reducer ran.

That read is now **E0103** at the read. A `let` declared before the `if` is still readable in both branches and after it, a branch can still shadow it for itself, and which slots count as written after the `if` (E0601) is unchanged.
