---
"@kumikijs/compiler": minor
---

A slot's initial value that reads `route`, directly or through a `fn` call, is now `E0304 derived-slot`

`route` is a slot, and an initial value may not read one — but it is not in
the definition index, so the E0304 pass never saw it. The read lowered to
`_live["route"]` inside the `_slots` literal, above `const _live`, so

```kumiki
slot at : Text = route.path
slot at2 : Text = here()
fn here() -> Text = route.path
```

compiled clean and threw `Cannot access '_live' before initialization` while
the module was being imported: nothing mounted.

Both shapes are now reported — the direct read at the read, the hop at the
call with the chain that reaches the route (`here → route`), exactly the way
`E0120` reports an `app.init` argument. The two positions ask the same gate and
the same chain resolver, so a local bind or a `fn` parameter named `route` is
that binding in both, and the message sends the author to a `route.enter`
reducer rather than E0304's usual "compute it in a fn". `now` stays legal in an
initializer (it is a module import, not something the mount installs), and a
`fn` that reads the route stays legal everywhere it runs after the mount.
