---
"@kumikijs/cli": patch
---

`kumiki replay` prints the warnings of the compile it runs on stderr, as `kumiki smoke`, `kumiki run` and `kumiki test` do

A warning the compile raises, such as a `ui.*` reducer its tile can never fire, used to vanish
when the file was replayed, so a log replayed against a warned program read exactly
as one replayed against a clean program. The warnings now print on stderr ahead of the replay's
own output, in the form `kumiki check` prints them, whether the replay passes or fails; they
change neither the trace on stdout nor the exit code.
