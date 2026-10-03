---
"@kumikijs/runtime": minor
"@kumikijs/e2e": patch
"@kumikijs/mcp": patch
---

Fail a `{submit}` step whose form held the submit back

A `form` calls its `ui.submit` reducer only while every field it binds passes
validation (forms.md §5.2.2). The held-back submit leaves nothing behind, and
the `{submit}` step only dispatched the event, so it passed whether the reducer
ran or not:

```
[ok] step 0: submit #email
scenario passed
```

The form now records which bound slots held the submit event back, and both
scenario tiers ask that record for the event their step caused. A held-back
submit fails the step on `actionError`, naming every field that held it back:

```
[FAIL] step 0: submit #email
    action failed: submit #email: the form held the submit back — the field
    bound to email fails its validation, so no `ui.submit` reducer ran
```

`actionErrorIncludes` claims it like a refused control
(`["the field bound to email fails its validation"]`). A submit that goes
through passes with no error, as before.

Both tiers judge it with one rule, `submitFault`, read off one record, the
mount's new `_submitHeldBy` seam: the scenario tier dispatches the submit
event, `@kumikijs/e2e` calls `requestSubmit()`, and each reports what the form
decided about that event. `@kumikijs/runtime` also exports `StepRefusal`, the
base `ControlRefusal` and the new `SubmitRefusal` share, which is what
`actionErrorIncludes` matches.
