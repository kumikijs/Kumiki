---
"@kumikijs/runtime": minor
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
Redirects are ranked in the same table as the routes that render: the first
entry in that order owns the path, so `"/todos/new" -> NewTodo` now renders even
when `"/todos/*" ->> "/"` is written above it (a redirect used to be tried before
any page). Inside a `sub-routes` parent, children and child redirects share the
order the same way, and only the parent that owns the path is consulted. The
winning pattern is also the one `route.enter` names. When `renderToString` is
handed `routing`, it picks the rendered route in the same order; it does not
follow redirects. §3.1.2, §3.6.3 and §3.10 spell this out in both language
tracks.
`packages/examples/features/153-route-specificity.kumiki` declares the routes
in the unhelpful order, and its scenario checks each one.
