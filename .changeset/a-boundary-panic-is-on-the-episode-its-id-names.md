---
"@kumikijs/runtime": patch
---

Record a boundary-caught panic on the episode its `episode-id` names

`docs/spec/lifecycle.md` calls `PanicInfo.episode-id` the join between a
panic a user saw and what `kumiki replay` / `kumiki_episode_tail` read back. On
the `error-boundary` path that join led nowhere. The boundary catches inside the
tile expression, where neither the render catch nor `app.error` sees the throw,
and `_s.boundaryPanic` only asked for the open episode's id. So a fallback
rendered from inside a dispatch named a real episode, and that episode held a
`reducer` and a `signal-update` and no `panic`:

```
fallback episode: ep_01M4…          # the fallback
{"kind":"ui.click", "status":"completed",
 "steps":["reducer","signal-update"]}   # the episode it names
```

The boundary now records the panic before it hands the fallback its id: a
`tile-render` step whose `location` is the tile that declares the boundary, on
the episode open around the render, which is the episode the id names. That
episode becomes `status: "panic"`. The panic is still handled — no console line,
no `app.error` — and a render with no episode open around it (the first paint,
a host with no logger) records nothing and is `None`, as before. A boundary that
catches on every render records one step per render.

The server render could never supply an id at all: `renderToString` committed
its bootstrap episode before it rendered, so a fallback in the served HTML was
always `fallback episode: (none)`. The render is the last step of the `app.init`
chain that produced the page, so it now runs inside the bootstrap episode: a
served fallback carries the bootstrap's id, and the bootstrap carries the
`panic` step after the chain's steps. A render nothing panics in adds nothing,
so the bootstrap of every other app is unchanged. `runtime.md` says
so, in both language tracks.

One function, `recordRenderPanic`, now builds and records every render panic —
the live render catch, the reconcile safety net, the boundary and the server
render all go through it — and `route.error`'s `$event.episode-id` is the
episode its step landed on, as `app.error`'s already was.
