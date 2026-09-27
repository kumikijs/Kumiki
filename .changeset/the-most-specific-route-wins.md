---
"@kumikijs/runtime": patch
---

Match a path against the most specific route, not the first one written

`docs/spec/routing.md` §3.1.2 ranks routes static > parameter > wildcard and
keeps definition order for ties. The router tried routes in source order and
took the first match, so with `"/todos/:id"` written above `"/todos/new"`, the
path `/todos/new` rendered the detail tile with `id = "new"`. The outcome
depended on which entry was appended first.

Routes are now compared segment by segment from the left: at the first segment
where two patterns differ in kind, a static segment wins over a parameter and a
parameter wins over a wildcard. Only a full tie falls back to definition order.
One ordering serves every lookup: the rendered route, the child inside a
`sub-routes` parent, and the redirect scan. Server rendering resolves through
the same `parseLocation`, so SSR and the client pick the same route. The redirect
scan inside a parent now looks only under the route that owns the path, the one
`parseLocation` renders. §3.1.2 spells out the comparison in both language tracks.
`packages/examples/features/153-route-specificity.kumiki` declares the routes
in the unhelpful order, and its scenario checks each one.
