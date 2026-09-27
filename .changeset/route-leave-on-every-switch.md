---
"@kumikijs/runtime": patch
---

Fire `route.leave` on every route switch that fires `route.enter`

Moving from `/todos/1/edit` to `/todos/2/edit` fired `route.enter` again with
the new params, but skipped `route.leave`, because the leave chain only ran
when the old and new patterns differed. The §3.5.2 unsaved-changes guard on
`route.leave("/todos/:id/edit")` therefore never saw a "next item" link, and
the edits were dropped without the `confirm`. A child switch under a
`sub-routes` parent had the same gap: the parent's pattern was re-entered and
never left.

Leave now runs whenever there is a route to leave, which is every sync after
the initial mount, and before enter. It receives the old route as `$route`, and
a `confirm` it emits holds a params-only move exactly as it holds a move between
patterns. A navigation to the path already shown fires both events, as it
already fired enter. routing.md §3.4 states this in both language tracks.
`packages/examples/features/155-leave-on-param-change.kumiki` walks the guard
through a params-only move and a child switch.
