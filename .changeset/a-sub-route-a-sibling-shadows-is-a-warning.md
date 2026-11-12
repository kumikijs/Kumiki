---
"@kumikijs/compiler": patch
---

`kumiki check` warns at a `sub-routes` key the router never reaches because a more specific route beside its parent takes every path it matches (W0218)

A parent's `sub-routes` map applies only when the match order picks that
parent for the path. With `"/settings/:section"` beside `"/settings/*"`, the
layout's `"/settings/account"` matches only paths the sibling owns, so it never
rendered and a `route.enter("/settings/account")` never ran, with nothing
said. The warning is at the key, names the entry that takes its paths and the
parent, and names the reducers that subscribe to the key when no other entry
declares it. It follows the router's ranking: static before parameter before
wildcard, definition order between ties, redirects included. A key that a
sibling takes only some paths of, such as `"/settings/*"` in the same map, is
not reported.
