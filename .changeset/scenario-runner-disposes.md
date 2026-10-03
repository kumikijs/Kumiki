---
"@kumikijs/runtime": patch
---

fix(runtime): let `runScenario` dispose the mount it made.

The handle `mount` returns was dropped on the floor, so the app the runner
started never stopped. Two things followed from that, and only one of them was
loud.

A `timer` reducer kept its `setInterval` after the report was returned. Under a
test runner that tears its DOM environment down between files — vitest with
happy-dom, which is how this repository's scenario tier runs — the next tick
renders into a world with no `document` and raises
`ReferenceError: document is not defined` as an unhandled error, out of a run
whose every test passed. Whether a tick lands before the process exits is a
matter of timing, so it read as a flake: it failed CI twice during the v0.13
release and passed on re-run both times.

The quiet one: the shape stayed registered as mounted, so a second run of the
same `AppShape` was not a second run. It became another *view* of the first —
`app.init` did not fire again, and the `onDiagnostic` this runner always passes
was refused with a warning, leaving every step's `diagnostics` empty for the
rest of that shape's life.

`runScenario` now disposes in its `finally`, the same shape `runSmoke` already
had. Each step's `state` and `domText` are captured as the step runs, so the
report is unchanged — but the root is empty once the call returns. A caller
that needs to query elements rather than read `domText` should mount the app
itself, which `docs/spec/testing.md` now states under Scenario Execution.
