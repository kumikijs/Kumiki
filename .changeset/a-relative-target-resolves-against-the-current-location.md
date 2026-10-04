---
"@kumikijs/runtime": patch
---

Resolve a relative target against the current page under the memory router, and follow an in-page hash to its element

Under `router: "memory"` (an embedded app: a Web Component, the playground
iframe) a target that is not a path was pushed onto the router's stack as
written. `?page=2` and `#faq` have an empty pathname, which reads as `/`, so on
`/docs` a "Next page" link or an in-page anchor took the app to `/`, usually its
404 page. `install` and `../guide` became the paths `install` and `../guide`,
which match nothing.

```
memory router,  click "Next page":   Docs page 1  ->  Not found /
memory router,  click "Jump to FAQ": Docs page 1  ->  Not found /
history router, click "Next page":   Docs page 1  ->  Docs page 2
```

Both routers now resolve a target through one rule, before it reaches either:
a path (`/docs`) is taken as written, and anything else is resolved against the
current location by the URL standard, as a browser resolves an href. On
`/docs/intro`, `?page=2` goes to `/docs/intro?page=2`, `#faq` to
`/docs/intro#faq`, `install` to `/docs/install` and `../guide` to `/guide`, under
either router, from a `link` or from `navigate` / `navigate-replace`. A target
on another origin is left as written, as before.

Following a hash on the page already shown (`#faq` on `/docs`) scrolled the
window to (0, 0) and ran `route.enter` again, under either router. It is now an
in-page jump (routing.md §3.9): `route.hash` updates, `route.enter` does not run,
and the element with that id scrolls into view. With no such element the scroll
position is left alone. A query-only move and a move to the URL already shown
run `route.enter` again as before.
