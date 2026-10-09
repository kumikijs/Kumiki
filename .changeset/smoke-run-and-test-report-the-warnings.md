---
"@kumikijs/mcp": patch
"@kumikijs/cli": patch
---

`kumiki_smoke`, `kumiki_run_scenario` and `kumiki_test` report the warnings of the compile they run

Each of the three compiles the file before it runs it, and none of them said
anything about that compile's warnings. On a file whose only diagnostic is a
warning, `kumiki_check` listed it and `kumiki_build` returned it in a second
content item, while `kumiki_smoke` answered with one item:

```text
ok — mounted, rendered, 0 interaction(s), no runtime errors
```

and `kumiki_run_scenario` and `kumiki_test` likewise answered with their trace
or report alone. `kumiki smoke`, `kumiki run` and `kumiki test` printed nothing
about the warning either.

The three tools now answer as `kumiki_build` does: when the compile reported
warnings, a second text content item holds them as the JSON diagnostic list
`kumiki_check` returns, whether the run passed or failed, and `isError` is
still decided by the run alone. The first item is unchanged. A file with no
warnings still gets one item.

```text
ok — mounted, rendered, 0 interaction(s), no runtime errors
```
```json
[{ "code": "W0212", "kind": "ui-event-tile-mismatch", …, "severity": "warning" }]
```

`kumiki smoke`, `kumiki run` and `kumiki test` print each warning on stderr
ahead of their own output, in the form `kumiki check` and `kumiki build` print
it. stdout and the exit code are what they are for a file with no warning:

```text
W0212 ui-event-tile-mismatch at 2:17: Reducer "bump" subscribes to ui.focus(Card) but tile "Card" has no descendant that fires "focus" (…). The handler is silently dropped.
```

The warnings come from the compile each call already runs. In `@kumikijs/cli`,
`smokeSource` and `smokeFile` return `SmokeReport & { warnings }`,
`runScenarioSource` returns `ScenarioReport & { warnings }`, and `TestReport`
(from `runTests`) has a `warnings` field, each the compiler's `KumikiError[]`.
`loadApp`, `runTestsSource` and `testFile` keep their signatures.
