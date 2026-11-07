---
"@kumikijs/cli": patch
---

`kumiki dev` serves an app whose path holds `$$` or `$&`

The dev client's import of the app was spliced in with `replaceAll` and a string,
which JavaScript reads as a replacement pattern: `$$` in the project path became
`$`, and `$&` became the placeholder it replaced. The import then named a
directory that does not exist, and the dev page answered 500. The path is now
inserted as written.
