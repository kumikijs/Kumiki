---
"@kumikijs/runtime": patch
---

Fire `route.leave` on every move to another path, even within one pattern

Moving from `/todos/1/edit` to `/todos/2/edit` fired `route.enter` again with
the new params, but skipped `route.leave`, because the leave chain only ran
when the old and new patterns differed. The §3.5.2 unsaved-changes guard on
`route.leave("/todos/:id/edit")` therefore never saw a "next item" link, and
the edits were dropped without the `confirm`. A child switch under a
`sub-routes` parent had the same gap: the parent's pattern was re-entered and
never left.

Leave now runs whenever the path or the pattern changes, before enter. It
receives the old route as `$route`, and a `confirm` it emits holds a
params-only move exactly as it holds a move between patterns. A query-only,
hash-only or same-path navigation stays on the route: it runs no leave (so no
guard asks) and re-runs enter, as before. When the guard's "No" reverts a held
move, the URL now gets the old route's query and hash back along with its path.
routing.md §3.4 states this in both language tracks.
`packages/examples/features/155-leave-on-param-change.kumiki` walks the guard
through a params-only move and a child switch.
