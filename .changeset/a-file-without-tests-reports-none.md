---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

`kumiki test --watch` and MCP `kumiki_test` no longer report another file's tests for a file that has none

A module loaded by `kumiki test` or `kumiki_test` published its tests and
coverage on `globalThis.__kumikiTests` / `__kumikiCoverage` only when the
program had at least one `test`. The runner reads those globals after loading
the module, so a file without tests reported whatever the previous file in the
same process had left there. `kumiki test --watch` runs in such a process, and
the bug shows once the last `test` is deleted; so does the MCP server's
`kumiki_test`:

```
$ kumiki test --watch app.kumiki      # one failing test
FAIL  inc-increments (0ms)
…
— change detected —                    # the test block deleted
FAIL  inc-increments (0ms)
…
0/1 passed
```

An agent calling `kumiki_test` on a file with no tests, after one that had
some, was handed the previous file's results, and `kumiki_auto_patch` could
answer `already-pass` for a test the file does not have.

When `kumiki test` or `kumiki_test` loads a module, the module now publishes
the program's own tests and coverage, even for a program without tests: no
tests, and its definitions with none used. Each run reports the file it was
given:

```
— change detected —
no tests found
```

`kumiki_test` returns `"total": 0` with an empty `results`, and
`kumiki_auto_patch` answers `not-found`. `kumiki test --watch` also prints
`watching for changes…` only once its watcher is in place, so a change saved
right after that line is seen. A production build, which never includes tests
(`kumiki build`, the Vite plugin), emits exactly what it did before.
