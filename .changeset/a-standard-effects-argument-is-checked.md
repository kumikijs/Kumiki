---
"@kumikijs/compiler": minor
---

A standard effect's argument is now checked against the `in=` stdlib.md §2.6
gives it, as a declared effect's already was.

```
emit navigate("/about")        # was ok, and navigated nowhere; now E0202
emit navigate-back(1)          # was ok; now E0213 (in=Unit takes none)
emit log(42, 43)               # was ok, the 43 dropped; now E0213
emit toast("Saved")            # was ok; now E0202
```

`checkEmitTarget` stopped after the capability check for a standard effect,
because there is no `effect` declaration to read an `in=` off. The capability
and the input now live in one table (`BUILTIN_EFFECTS`, from which
`BUILTIN_EFFECT_CAPS` is derived), so an entry cannot have one without the
other, and a test holds that table to the `effect` lines in §2.6.

A record argument may leave out an `Option(T)` field, which reads as `None`
(`toast({kind: "info", text: "notified"})`), and the fields §2.6 gives a
default: `navigate` / `navigate-replace`'s `params` and `query` (`{}`, routing.md
§3.7) and `confirm`'s `message`. §2.6 now states that rule, writes `query` into
`navigate`'s `in=`, and adds `confirm`'s `message`, which lifecycle.md §7.6 and
the runtime already had.
