---
"@kumikijs/compiler": patch
---

`app.http`'s `timeout` refuses a literal that is not a number of milliseconds from 1 to 2147483647, and `timeout` and `credentials` check the literals in `match` arms and `let … in` bodies too.

```
http = { timeout: 0 }                        # was ok; now E0201 timeout 0 is not a number of milliseconds from 1 to 2147483647; …
http = { timeout: -1 }                       # was ok; now E0201, at the -1
http = { timeout: 2147483648 }               # was ok; now E0201
http = { timeout: if fast then 5000 else 0 } # was ok; now E0201, at the 0
```

The runtime arms each request's abort with this value. `setTimeout` fires it
at once for a delay of 0 or less, and for one above 2147483647 too (a browser
wraps it below 0, Node shortens it to 1 ms), so every request came back
`{status: 0, message: "aborted"}` as it was issued — the same failure as
`timeout: "soon"`, which was already E0201. `timeout: 5000`, `Duration.s(5)`
and an `Int` slot are unaffected: a value computed at run time is held to its
type alone.

`timeout` and `credentials` now find their literals the same way, so a
misspelt `credentials` mode is also reported in an arm of a `match` or the body
of a `let … in`, where it was reported only as the field's value or a branch of
an `if` before:

```
http = { credentials: match s with | A -> "include" | B -> "bogus" }  # was ok; now E0201, at "bogus"
```

http.md and errors.md E0201 (en + ja) say so.
