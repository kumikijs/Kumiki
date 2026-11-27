# Iterating on a Kumiki app without a human in the loop

The user states the requirements once. You close the loop yourself: write the app, run it, read
its real state, fix, and repeat — rather than shipping something that compiles and asking the
user to click through it.

Kumiki makes this tractable: **state is explicit** (slots), so the oracle is the app's state, not
scraped pixels; **events are named** (reducers), so you drive the app precisely; and **effects are
mocked at the capability boundary**, so a run is deterministic and never reaches the network.

## The loop

1. **Write** the app (`kumiki guide author`).
2. **Check and build**: `kumiki check`, `kumiki build`. On a diagnostic, `kumiki guide debug`.
3. **Smoke**: `kumiki smoke`. It mounts the app and exercises the UI.
4. **Write the scenario** — the acceptance criteria, made runnable. Translate the user's
   requirements, not your implementation, into steps with assertions on **state**:

   ```json
   {
     "steps": [
       { "do": { "fill": "input[placeholder='Title']", "value": "Fix login" } },
       { "label": "create", "do": { "clickText": "Create issue" },
         "expect": { "noErrors": true, "state": { "issues.id-1.title": "Fix login" } } }
     ],
     "effects": { "saveIssues": [{ "outcome": "ok" }] }
   }
   ```

5. **Run** it: `kumiki run app.kumiki scenario.json`. Each step reports its `state`, its text,
   errors, the effects it emitted, and failures as expected-vs-got.
6. **Diagnose from the trace**, not from guesses. An `action failed:` line usually means the
   *scenario* is wrong (a selector that matches nothing) — the action never ran, so fix the
   selector before touching the app.
7. **Patch** the one definition at fault (`kumiki replace app.kumiki tile.App …`) and go to 2.
   Stop when the scenario passes.

## The scenario vocabulary

`kumiki guide testing` is the full reference. The parts used most:

- **Actions** (`do`): `fill` + `value`, `clickText`, `click` (a CSS selector), `choose` + `value`,
  `submit`, `focus`, `blur`, `key` + `value`, `hover`, `navigate`, `wait` (ms), and `dispatch`
  (fire a reducer by name). Prefer the DOM actions to `dispatch`, which skips the wiring you want
  to prove.
- **Assertions** (`expect`): `noErrors`, `state` (a partial match; keys may be dotted paths),
  `domIncludes` / `domExcludes`, `errorIncludes` (an error the step means to cause), and
  `actionErrorIncludes` (a control the platform refuses, or a form that holds its submit back).
- **Effects**: per-effect queues of `{ "outcome": "ok" | "err", "value": … }`, answered in order.

Assert on state before text: state is the app's meaning, text is incidental.

## Stopping rules

- Cap the loop at about five rounds. If the same failure survives two patches, stop guessing:
  re-read the spec for that feature (`kumiki guide <doc>`), and consider that the framework may be
  at fault (`kumiki guide debug`, last section).
- A requirement you cannot express as a state or text assertion is underspecified. Ask the user
  rather than inventing behavior.
