---
"@kumikijs/runtime": patch
---

Resolve a relative target against the current page under the memory router, and follow an in-page hash to its element

Under `router: "memory"` (an embedded app: a Web Component, the playground
iframe) a target that is not a path was pushed onto the router's stack as
written. `?page=2` and `#faq` have an empty pathname, which reads as `/`, so on
`/docs` a "Next page" link or an in-page anchor took the app to `/`, usually its
404 page. `install` was read as the path `/install` rather than `/docs/install`,
and `../guide` matched no route.

```
memory router,  click "Next page":   Docs page 1  ->  Not found /
memory router,  click "Jump to FAQ": Docs page 1  ->  Not found /
history router, click "Next page":   Docs page 1  ->  Docs page 2
```

Both routers now resolve a target through one rule, before it reaches either:
it is resolved against the current location by the URL standard, and held as
the URL parser writes it, percent-encoded as `location.pathname` is. On
`/docs/intro`, `?page=2` goes to `/docs/intro?page=2`, `#faq` to
`/docs/intro#faq`, `install` to `/docs/install` and `../guide` to `/guide`, under
either router, from a `link`, from `navigate` / `navigate-replace`, or from a
`->>` redirect. A target on another origin is left as written, as before.

The memory router used to hold a path with a space or a non-ASCII character as
pushed, `initialPath` included, so a relative target from `/docs/あ` left the
route for `/404`. It now holds `/docs/%E3%81%82` there, as the history router
does, and `renderToString` holds its `route` the same way: `/a/../b` is `/b`
there, as in a browser's `location`, and a redirect's target resolves against
the requested path. A static route with a non-ASCII segment (`"/ja/概要"`)
matches that encoded form, so under the history router it renders instead of
falling to `/404`, and a param binds the same value under either router:
`/items/100% off` gives `id = "100%%20off"`, as `location.pathname` has it.

In the docs playground's sandboxed iframe, whose own URL is `about:srcdoc`,
`link(to="#faq")` was cancelled with a warning about its scheme before it
reached the router. A target that names no origin of its own is now always the
router's.

Following a hash on the page already shown scrolled the window to (0, 0) and ran
`route.enter` again: `#faq` on `/docs` under the history router (under the memory
router it went to `/`), and `/docs#faq` under either. It is now an in-page jump
(routing.md §3.9): `route.hash` updates, `route.enter` does not run, and the
element with that id scrolls into view. With no such element the scroll position
is left alone. A query-only move and a move to the same URL without a hash run
`route.enter` again as before.

Back and Forward between two entries of one page that differ only in the hash
stay on the page as well: `route.enter` does not run, and the window returns to
where that entry was left, so Back after a jump returns to where the page was
before it. The position Back and Forward return to is now kept per URL, query
and hash included, rather than per path.
