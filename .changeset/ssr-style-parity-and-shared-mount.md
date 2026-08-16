---
"@kumikijs/runtime": minor
---

fix(runtime): serve the style the client paints, and make one `AppShape`
mounted twice mean two views of one app.

**SSR carried no styling at all.** `ssr-render.ts` did not contain the word
`props`, so a served page laid every flex container out as a block and reflowed
the moment hydration finished — the layout shift SSR exists to remove. The
prop-to-style mapping is now data (`containerStyleDecls` / `textStyleDecls`),
applied to an element by the renderers and serialised into a `style` attribute
by the server. A kind's own base layout stays with the per-kind switch on each
side, because the renderers are the per-app DCE unit; a test that renders one
node per kind both ways and compares the element, its attributes and its
CSSOM-normalised style is what keeps the two copies honest. It also found that
the icon placeholder used a different attribute than the renderer writes, the
spinner was a `div` where the client makes a labelled `span`, the skeleton had
none of its frame, and a `label` dropped its `for`.

A responsive value collapses to its base on the server — a breakpoint is a
question about a viewport it does not have. Class-backed layers (`transition`,
the `hover:` / `focus:` / `active:` blocks, motion) stay client-only.

**Mounting one shape twice froze the earlier mount.** Each mount overwrote the
shape's imperative seams, so the last one captured every event that resolved
through the shape: the first host's own buttons re-rendered the second, and
`el.setSlot` on the first element landed on the second. The spec says passing
the compiled default export rather than the `createApp` factory "shares one
instance across all elements of that tag", which is only worth saying if every
element stays live.

A shape carries the app's state, so a second mount is a second *view*. Where the
app is painted is now per view (the mounted element, the tree behind it, the map
the next reconcile diffs against) and what it says is shared, because the state
is. What the app owns once belongs to the first mount — `app.init`, `app.start`,
the timers, the router, the effect dispatcher — so a second view does not re-run
initialization or double a timer's ticks. Disposing a view leaves the others
interactive; the app is torn down with the last one, after which the shape starts
over — initialization, timers and router run again, while `app.live` keeps
whatever the app had written. Adding a view with `hydrate` throws rather than overlaying a server
snapshot onto a state that is already live.

Apps built with `createApp()` per instance are unaffected, and the multi-mount
isolation guarantees are unchanged.
