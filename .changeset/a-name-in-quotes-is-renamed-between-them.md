---
"@kumikijs/compiler": patch
---

`rename` rewrites a name a prop holds in quotes, and keeps the quotes

A tile's `motion: "Spin"` names the motion `Spin`, and a link's
`prefetch: "loadTodo"` names the reducer `loadTodo`. The reference walker
recorded both at the string literal's own position, which is its opening
quote. `rename` checks the text at each reference before it rewrites, so it
found `"Spi` where it expected `Spin` and aborted:

```
$ kumiki rename m.kumiki motion.Spin Whirl
Error: rename aborted: expected "Spin" at 8:46 but found ""Spi"
```

A motion can only be named in quotes, so no motion in use could be renamed,
and neither could a reducer a link prefetched in the quoted form.

Both references now sit one column past the quote, where the name starts.
`rename motion.Spin Whirl` writes `{motion: "Whirl"}`,
`rename reducer.loadTodo fetchTodo` writes `prefetch: "fetchTodo"`, and both
exit 0 with a file that still checks.
