---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

Report no tests for a file without any, whatever ran before it in the process

A module compiled with tests included published its tests and coverage on
`globalThis.__kumikiTests` / `__kumikiCoverage` only when the program had at
least one `test`. The runner reads those globals after loading the module, so
a file without tests reported whatever the previous file in the same process
had left there. `kumiki test --watch` is such a process once the last `test` is
deleted, and so is the MCP server's `kumiki_test`:

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
some, was told that a test which does not exist was failing.

With tests included, every module now publishes its own tests and coverage,
an empty list for a program that has none, so each run reports the file it
was given:

```
— change detected —
no tests found
```

and `kumiki_test` returns `"total": 0` with an empty `results`. A build without
tests (`kumiki build`, the Vite plugin) emits exactly what it did before.
