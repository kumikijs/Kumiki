---
"@kumikijs/runtime": patch
---

Match a path parameter that is not valid percent-encoding as written instead of throwing

A `:param` segment was handed to `decodeURIComponent` unguarded. The URL parser
keeps an invalid escape such as the stray `%` in `/items/100%` (or `/tags/50%off`)
in `location.pathname` as is, so opening or following a link to such a path threw
out of the router:

```
URIError: URI malformed
    at decodeURIComponent (<anonymous>)
    at matchPattern (packages/runtime/src/router.ts)
    at Object.parseLocation (packages/runtime/src/router.ts)
    at mountCore (packages/runtime/src/core.ts)
```

At mount nothing rendered: no `/404` page, no error boundary, no `app.error`. An
in-app `navigate` or link to the path, and a popstate back to it, threw the same
way and left the previous page up under the new URL, and `renderToString` threw
for it on the server.

Such a segment now matches the parameter and is kept as written (`id = "100%"`),
so the route renders (routing.md §3.1.1). A segment with escapes that do not
spell UTF-8 (`/items/%E3%81`) is treated the same way. Well-formed escapes still
decode: `/items/a%2Fb` gives `id = "a/b"` and `/items/%E3%81%82` gives `id = "あ"`.
`route.path`, the query and the hash are unchanged.
