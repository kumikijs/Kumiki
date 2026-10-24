---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A route lifecycle event names a declared route, and fires for a sub-route too

`route.enter(p)`, `route.leave(p)` and `route.error(p)` fired only when `p` was
exactly the top-level pattern of the route entered, left or shown, and
`kumiki check` accepted any string there. So `route.enter("/*")` (routing.md
§3.9's own scroll-to-top example) fired only in an app that declares a route
literally named `"/*"`; `route.enter("/settings/account")` never fired for a
child under `"/settings/*"`, because the route's pattern stays the parent's
while the child is shown; and a typo such as `route.enter("/bb")` for `"/b"`
compiled clean and never ran.

The argument now names a declared route: a key of `app.routes` or of a
`sub-routes` map whose target is a tile, compared as written. Any other string
— a glob, a typo, a parameter spelt differently from the key, or the key of a
`->>` redirect — is the new `E0228 undef-route-pattern`, reported at the
pattern's string literal with the declared routes listed. A program with no
`app` is left to E0003.

The events follow the matched chain: the top-level pattern, then the sub-route
pattern it matched (the parent's default child included). Entering
`/settings/account` runs `route.enter("/settings/*")` and then
`route.enter("/settings/account")`; leaving runs the child's `route.leave`
before the parent's. A move to another path still leaves the whole chain it
came from and enters the whole chain it lands on, so a switch between two
children leaves and re-enters the parent exactly as before — every program that
subscribes only to top-level patterns sees the same events in the same order.
The initial mount enters the whole chain, and a same-path move re-enters it.
`route.error` fires for every pattern of the route being shown, parent first,
and each reducer's `$event.pattern` is the pattern it named (before, only the
top-level pattern's reducers ran). A leave guard on a sub-route pattern holds
the move behind `confirm` like one on a top-level pattern.

routing.md §3.4 states the rule and §3.9's example subscribes to a declared
pattern, in both language tracks; errors.md documents E0228.
`packages/examples/features/226-route-lifecycle-patterns.kumiki` walks enter and
leave through a parent and its children.
