---
"@kumikijs/compiler": patch
---

An effect-event payload bind now has the type the effect's `out=` declares, so reads of it are checked (#385).

`load.ok($s, _)` / `load.err($e, _)` bind the effect's result, and the effect says what that is in `out=`. Nothing carried the type to the bind: the name entered the reducer's scope with no type, so every read of it was undecidable and every assignment out of it was accepted. `label := $s` put an `Option(Session)` into a `Text` slot, and `session := $s.get-or(None)` — the shape the `.get-or` defect (#294) actually shipped in — passed although the same call on a slot receiver is a pair of E0201s.

`$1` now has the Ok payload of `out=Result(T, E)` on `.ok` and the Err payload on `.err`; an `out=` that is not a `Result` is the whole value on `.ok`. The request key, `.err` on a non-`Result` `out=`, and a built-in effect's result have no declared type and stay unchecked.
