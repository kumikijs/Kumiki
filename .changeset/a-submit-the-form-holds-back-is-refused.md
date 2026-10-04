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

The form tile now writes down which bound slots held the submit event back,
and both scenario tiers read that record for the event their step caused. A
held-back submit fails the step on `actionError`, naming every field that held
it back (the line is wrapped here; it prints as one):

```
[FAIL] step 0: submit #email
    action failed: submit #email: the form held the submit back — the field
    bound to email fails its validation, so no `ui.submit` reducer ran
    (forms.md §5.2.2) — a step that means to assert the refusal says
    {"expect": {"actionErrorIncludes": ["the field bound to email fails its validation"]}}

scenario FAILED
```

Two or more fields read in the plural, in the order the form binds them:
`the fields bound to email, code fail their validation`. `actionErrorIncludes`
claims it like a refused control. A submit that goes through passes with no
error, as before.

Both tiers judge it with one rule, `submitFault`. The form tile writes the
record (`noteHeldSubmit`); each tier reads it through the `_submitHeldBy` seam
of the app that owns the form: the scenario tier dispatches the submit event,
`@kumikijs/e2e` calls `requestSubmit()`.

`requestSubmit()` runs the browser's constraint validation first, and a control
that fails it (`required`, `type="email"`, …) stops the submit before any event
fires. The browser tier used to pass that step too. It now refuses it, naming
each control and the `ValidityState` flags it fails (the assertion hint that
ends it, shaped as above, is elided as `…`):

```
submit #name: the browser's constraint validation stopped the submit before the
form saw it — <input type=text id=name> reports valueMissing, so no submit event
fired and no `ui.submit` reducer ran — …
```

The scenario tier dispatches the event itself, which skips constraint
validation, so the same form can submit there and be refused in the browser;
testing.md §8.10 says so.

`@kumikijs/runtime` exports the new `SubmitRefusal`, `ConstraintRefusal`,
`submitFault`, `constraintFault` and `readInvalidControls`, and `StepRefusal`,
now the abstract base of all three refusals, which is what
`actionErrorIncludes` matches. `StepRefusal` builds `message` from `headline`,
so `ControlRefusal`'s constructor no longer takes a `message`:
`new ControlRefusal(headline, reason, suggestion)`. Its messages are unchanged.
