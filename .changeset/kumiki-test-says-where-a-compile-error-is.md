---
"@kumikijs/cli": patch
---

`kumiki test` says where a compile error is

A file that did not compile stopped `kumiki test` with the code and message
alone — no file, no line, no test — while `kumiki check` on the same file named
the position:

```
$ kumiki test app.kumiki
Error: compile failed:
E0713 `given.slots` must be a record, `{<slot>: …}`
```

The runner now names the file and prints each diagnostic through the same
formatter `check` and `build` use, plus the `test` the diagnostic sits inside:

```
$ kumiki test app.kumiki
Error: compile failed (app.kumiki):
E0713 test-shape-invalid at 8:26: `given.slots` must be a record, `{<slot>: …}` (in test "starts-at-41")
```

`kumiki smoke` and `kumiki run` compile through the same loader and report a
compile error the same way, and so do the MCP `kumiki_test`, `kumiki_smoke` and `kumiki_run_scenario`
tools — the last two without the file name, since they hand the loader source
text rather than a path.
