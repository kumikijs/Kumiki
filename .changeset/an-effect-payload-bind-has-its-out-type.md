---
"@kumikijs/compiler": patch
---

An effect's `.ok` payload bind now has the type the effect's `out=` declares, so reads of it are checked (#385).

`load.ok($s, _)` binds the effect's result, and the effect says what a success is in `out=`. Nothing carried the type to the bind: the name entered the reducer's scope with no type, so every read of it was undecidable and every assignment out of it was accepted. `label := $s` put an `Option(Session)` into a `Text` slot, and `session := $s.get-or(None)` — the shape the `.get-or` defect (#294) actually shipped in — passed although the same call on a slot receiver is a pair of E0201s.

`$1` on `.ok` now has the Ok payload of `out=Result(T, E)`, or the whole value of any other `out=`. `$1` on `.err` stays unchecked: the built-in handlers deliver a `{message: …}` record there whatever `E` declares, so `$e.message` keeps passing. The request key, a built-in effect's result and a `Result` of the wrong arity (already E0210) stay unchecked too.
