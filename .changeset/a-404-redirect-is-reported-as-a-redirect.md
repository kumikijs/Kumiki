---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

A redirect written at `/404` is reported as a redirect, not as a missing `/404` (#396).

`/404` is the fallback for paths no route matches, and the fallback renders a tile (routing.md §3.1.3), so `"/404" ->> "/"` is refused. It was refused with the message for a map that has no `/404` at all, which sends the author to add a second one (E0008):

```
before: E0001 missing-404 at 2:1: app.routes must include a "/404" entry
after:  E0001 404-is-redirect at 2:36: Route "/404" is a redirect, but "/404" is the fallback for paths no route matches and has to render a tile — write "/404" -> <Tile>
```

It is E0001 with its own kind, `404-is-redirect`, reported at the redirect rather than at the app. A map with no `/404` entry keeps `missing-404`, and a `/404` redirect beside a `/404` tile stays the E0008 it was.

A `/404` redirect in a tile's `sub-routes` map was accepted and never ran: no sub-route is matched at `/404`. It is the same `404-is-redirect` now, with a message that says so and where an unmatched child goes instead.

`kumiki fix` offers no patch for `404-is-redirect` in either position, and reads that from the diagnostic's kind rather than scanning the routes a second time. The skip reason is `e0001-404-is-a-redirect`, as before.
