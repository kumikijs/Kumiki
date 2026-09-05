---
"@kumikijs/runtime": minor
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

Report an action that could not run as its own thing, not as an app error

`errorIncludes` asserts that the *runtime* surfaced something — a reducer batch
a refinement rejected, an effect error no `.err` reducer consumes. A failed
action was reported through the same buffer, so it could satisfy the assertion:

```json
{ "do": { "key": "#typo" }, "expect": { "errorIncludes": ["no element"] } }
```

```
$ kumiki run a.kumiki typo.json
[ok] step 0: key #typo "Enter"
scenario passed
```

— a fixture asserting that its own mistake happened, having pressed nothing.
The same shape worked for `click`, `focus`, `blur`, `hover`, `fill`, `choose`,
`clickText` and `submit`.

An action that cannot run is a fault in the scenario, not an observation about
the app, so it is now a channel of its own: `StepResult.actionError`, printed by
`kumiki run` and `kumiki_run_scenario` as `action failed:`. It fails the step,
and neither `errorIncludes` nor `noErrors` can see it — the two are reported
separately because they are different things:

```
[FAIL] step 0 (typo): click #nope
    action failed: no element matching selector #nope
    assert: expected an error including "no element" but got: none
```

`@kumikijs/e2e` splits the same way. That tier refuses `errorIncludes` outright,
but it treats every reported error as fatal, so a fixture's broken selector was
reported as a defect in the app. Its `fill` also now names the element it
matched — `#box matched <div>, which holds no text to fill` — rather than
spending Playwright's actionability timeout to say the selector was not
fillable, so a fixture promoted from the scenario tier reads the same message.
