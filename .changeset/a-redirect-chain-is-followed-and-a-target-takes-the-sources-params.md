---
"@kumikijs/runtime": patch
"@kumikijs/compiler": minor
---

Follow a chain of `->>` redirects to its page, and put the source's parameters into the target

routing.md §3.10 says a redirect performs the equivalent of `navigate-replace`,
and a `navigate-replace` to a path that redirects is redirected again. The
runtime resolved one redirect and then matched the result with every redirect
entry skipped, and it used the target as a literal string:

- With `"/v1" ->> "/v2"` and `"/v2" ->> "/"`, navigating to `/v1` rendered the
  404 tile with the URL left at `/v2`.
- With `"/old/:id" ->> "/items/:id"`, `/old/42` landed on the path
  `/items/:id`, with `route.params.id` reading `":id"`. `"/docs/*" ->>
  "/help/*"` landed on `/help/*`.

Now the runtime follows the chain to a path no redirect owns and replaces the
URL once, with that path, so `/v1` lands on `/` and `navigate-back` returns to
the page before it. A target takes what its source binds: each `:name` the
segment it matched, carried as the URL has it (`/old/a%20b` lands on
`/items/a%20b`, where `id` is `"a b"`), and `*` the rest of the path the
source's wildcard matched (`/docs/a/b` lands on `/help/a/b`, `/docs` on
`/help`); a target with no `*` drops the rest. The same holds inside a
`sub-routes` map, across the app's routes and a `sub-routes` map, on the path
the app mounts at, and in `renderToString`, which follows a chain of literal
redirects without a routing module too. The query and hash of the requested URL
are still not carried over.

A chain that never reaches a page is stopped instead of followed forever: when
a path comes back, the runtime reports
`[kumiki] redirect loop: /p/1 ->> /q/1 ->> /p/1 — stopped, no redirect applied`
on `console.error` (`[kumiki] more than 20 redirects: …` when a chain would take
a 21st), and renders the requested path as if no redirect matched it.

Check reports the two mistakes it can see from the route table, in the app's
`routes` and in a tile's `sub-routes`:

- **E0125 `redirect-unbound-param`**: a target names a `:name` or `*` its source
  does not bind, which would reach the URL as written.
  `Redirect "/old/:id" ->> "/items/:key" names ":key", which "/old/:id" does not bind`
- **E0010 `redirect-cycle`**: redirects written for static paths send a path
  back to itself. `Redirect "/a" comes back to itself (/a ->> /b ->> /a)`. A
  loop through a parameter or a wildcard is the runtime's to stop.

Both passed `check` before. `packages/examples/features/208-redirect-chain-params.kumiki`
shows a chain, a parameter, a wildcard rest, a `sub-routes` chain and Back after
a redirect.
