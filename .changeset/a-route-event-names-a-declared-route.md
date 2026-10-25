---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

`kumiki check` reports a route lifecycle pattern that names no declared route (E0228), and route events fire for sub-route patterns too

`route.enter(p)`, `route.leave(p)` and `route.error(p)` fired only when `p` was
exactly the top-level pattern of the route entered, left or shown, and
`kumiki check` accepted any string there. So `route.enter("/*")` (routing.md's
own scroll-to-top example) fired only in an app that declares a route literally
named `"/*"`; `route.enter("/settings/account")` never fired for a child under
`"/settings/*"`, because the route's pattern stays the parent's while the child
is shown; and a typo such as `route.enter("/bb")` for `"/b"` compiled clean and
never ran.

The argument now names a declared route: the key of an entry that renders a
tile (`->`, not `->>`), in `app.routes` or a `sub-routes` map, compared as
written. Any other string — a glob, a typo, a parameter spelt differently from
the key, or the key of a `->>` redirect — is the new `E0228
undef-route-pattern`, reported at the pattern's string literal with the
declared routes listed, so `check` now rejects programs it used to pass. A
program with no `app` is left to E0003.

The events follow the matched chain: the top-level pattern, then the sub-route
pattern it matched (the parent's default child included). Entering
`/settings/account` runs `route.enter("/settings/*")` and then
`route.enter("/settings/account")`; leaving runs the child's `route.leave`
before the parent's. A sub-route keyed like its parent is the parent's own
pattern, and its reducers run once. A move to another path still leaves the
whole chain it came from and enters the whole chain it lands on, so a switch
between two children leaves and re-enters the parent exactly as before. A
program that subscribes only to top-level patterns sees the same events in the
same order, unless one of those keys is also a sub-route key: beside
`"/" -> Home` and `"/*" -> Layout`, where `Layout`'s default child is `"/"`, a
move to `/zzz` now fires `route.enter("/")`. The initial mount enters the whole
chain, and a move that changes only the query re-enters it.

Once a route reducer navigates to another route, the rest of that event's
reducers do not run, whether they are on the same pattern or further along the
chain. A second `route.enter("/admin/*")` reducer no longer runs on the login
page its first one redirected to, and a child's loader no longer runs after its
parent's enter guard has redirected.

`route.error` fires for every pattern of the route being shown, parent first,
and each reducer's `$event.pattern` is the pattern it named (before, only the
top-level pattern's reducers ran). A leave guard on a sub-route pattern holds
the move behind `confirm` like one on a top-level pattern.

routing.md states the rule and its scroll-restoration example subscribes to a
declared pattern, in both language tracks; errors.md documents E0228.
`packages/examples/features/226-route-lifecycle-patterns.kumiki` walks enter and
leave through a parent and its children.
