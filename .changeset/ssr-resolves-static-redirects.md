---
"@kumikijs/runtime": patch
---

Resolve `->>` redirects in `renderToString`, as `mount` does

`mount` resolves a static redirect with `routing.findRedirect` before its first
route sync. `renderToString` only called `parseLocation`, which skips redirect
entries, so a redirected URL was served the `/404` tile. A redirect inside a
`sub-routes` map was served the parent's default child instead. Hydration then
replaced the page with the target. The shipped `apps/03-blog` declares
`"/" ->> "/posts"`, so its server-rendered home page was "Page not found".

The SSR pass now resolves the redirect first through the same
`findRedirect` and renders the target. `route` reads the target while the
tiles render, and `snapshot.route` and the bootstrap episode's
`trigger.target` name it. The requested `route` may carry a query and a hash
(`/old?ref=x` is redirected as `/old`); it is split the way the client's router
reads a location, with the pathname kept as written, so `//foo` and `/a/../b`
land where they land in a browser rather than being normalized. Without a routing module, a
redirect written for exactly the requested path applies, matching the
literal-string fallback used for routes. runtime.md §10.6.1 says this in both
language tracks. `packages/examples/features/154-ssr-redirect.kumiki` has a
top-level and a sub-route redirect.
