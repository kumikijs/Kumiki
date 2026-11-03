---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
"@kumikijs/runtime": patch
---

A redirect written at `/404` is reported as a redirect, not as a missing `/404`, and a `sub-routes` entry at `/404` is refused.

`/404` is the fallback for paths no route matches. It belongs to `app.routes`, and it renders a tile (docs/spec/routing.md), so `"/404" ->> "/"` is refused. It was refused with the message for a map that has no `/404` at all, which sends the author to add a second one (E0008):

```
before: E0001 missing-404 at 2:1: app.routes must include a "/404" entry
after:  E0001 404-is-redirect at 2:36: Route "/404" is a redirect, but "/404" is the fallback for paths no route matches and has to render a tile — write "/404" -> <Tile>
```

It is E0001 with its own kind, `404-is-redirect`, reported at the redirect rather than at the app. A map with no `/404` entry keeps `missing-404`, and a `/404` redirect beside a `/404` tile stays the E0008 it was.

A tile's `sub-routes` map has no `/404` of its own: no sub-route is matched against `/404`, so an entry there is never used. Both forms passed `check` and did nothing — `"/404" -> NotFound` never rendered and `"/404" ->> "/"` never redirected. This refuses a form that used to pass, on purpose, because the entry it refuses never renders:

```
before: (no diagnostic)
after:  E0001 404-in-sub-routes at 3:48: Tile "Settings" has a sub-route at "/404", which is reserved for the app's fallback — no sub-route is matched against it. Remove it: a child path that no sub-route matches renders the sub-route tile at the parent's own path if there is one, or else the app's "/404"
```

It is the entry's one report, whatever it targets: an undefined tile or one that declares `in=` there is not also E0105 or E0213, a redirect target naming a `:name` or `*` that `/404` does not bind is not also E0125, and a redirect loop through it is not also E0010. The same holds for a `/404` redirect in `app.routes`.

The router now agrees that no sub-route is matched against `/404`. A child path no sub-route matches renders the sub-route tile at the parent's own path, which under a `"/404/*"` parent is `/404`; that one default rendered a `/404` sub-route for `/404` and `/404/x`. Those paths now fall through to the app's `/404`.

`kumiki fix` offers no patch for either kind, and reads that from the diagnostic's kind. The skip reasons are `e0001-404-is-a-redirect` and `e0001-404-in-sub-routes`.
