---
"@kumikijs/compiler": patch
---

Apply an `error-boundary` fallback's own `error-boundary` where the fallback renders

`docs/spec/lifecycle.md` §7.3 says a tile's `error-boundary` holds wherever
that tile renders. A fallback renders in place of the tile that panicked, but
its own boundary was not applied there, so a panic in the fallback escaped it:

```kumiki
slot xs : List(Int) = []

tile Last in=PanicInfo = text("last resort: " + $1.message)
tile Oops in=PanicInfo error-boundary=Last = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile App = column(Boom)
```

```
$ pnpm kumiki check nested.kumiki
ok
$ pnpm kumiki run nested.kumiki nested.scenario.json
[FAIL] step 0 (mount)
    error: [kumiki] panic in render: get called on None
```

The page showed the built-in panic display, or the fallback of a boundary
further out, instead of `Last`. Now the page shows
"last resort: get called on None": the fallback is lowered through the same
rule as a call site and a route target, which applies both the `tile.mount`
marker and the tile's own boundary, so a panic in a fallback is caught by that
fallback's boundary, and so on along the chain — at a call site, on a route
target, and in `renderToString`'s HTML alike. `PanicInfo.location` names the
fallback that panicked.

Unchanged: a fallback that declares no boundary of its own leaves its panic to
the boundaries around the tile that declared it, as before. A chain that comes
back to itself (`tile Oops in=PanicInfo error-boundary=Oops`, or two fallbacks
naming each other) was already `E0005` at check time and still is; it is the
check that keeps the lowering from recursing forever. §7.3 and E0005 say so in
both language tracks, and
`packages/examples/features/254-fallback-own-boundary.kumiki` shows a fallback
whose own fallback stands in for it until the fallback can render.
