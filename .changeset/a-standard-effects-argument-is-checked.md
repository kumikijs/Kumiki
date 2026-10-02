---
"@kumikijs/compiler": minor
---

A standard effect's argument is now checked against the `in=` stdlib.md §2.6
gives it, as a declared effect's already was — at an `emit`, an `app.init`
entry and an `expect.effects` argument alike.

```
emit navigate("/about")                      # was ok, and navigated nowhere; now E0202
emit navigate-back(1)                        # was ok; now E0213 (in=Unit takes none)
emit log(42, 43)                             # was ok, the 43 dropped; now E0213
emit toast("Saved")                          # was ok; now E0202
emit toast({kind: "info"})                   # was ok; now E0214 (no `text`)
emit confirm({title: "t", onYes: 42, onNo: no})  # was ok; now E0202 (not a reducer)
```

`checkEmitTarget` stopped after the capability check for a standard effect,
because there is no `effect` declaration to read an `in=` off. The capability
and the input now live in one table (`BUILTIN_EFFECTS`, exported, from which
`BUILTIN_EFFECT_CAPS` is derived), so an entry cannot have one without the
other, and a test holds that table to the `effect` lines in §2.6 and routing.md
§3.7, in both tracks.

A record argument may leave out an `Option(T)` field, which the effect treats
as `None` (`toast({kind: "info", text: "notified"})`), and the fields §2.6 gives
a default: `navigate` / `navigate-replace`'s `params` and `query` (`{}`,
routing.md §3.7) and `confirm`'s `message`. What is left out is read at each
leaf, so an `if` whose branches write different fields, a `let` body and a
value of a narrower record type (`slot cfg : {path: Text}`, `emit
navigate(cfg)`) all pass. The relaxation is the standard effects' alone; a
declared effect's record `in=` still takes every field.

§2.6 now states that rule, writes `query` into `navigate`'s `in=`, adds
`confirm`'s `message`, which lifecycle.md §7.6 and the runtime already had, and
spells `confirm`'s `onYes` / `onNo` as `ReducerRef` (§7.6's spelling, defined
in §2.6.5): a reducer's name written bare, and E0202 for any other value.
