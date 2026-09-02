---
"@kumikijs/compiler": patch
---

Refuse a route target that declares `in=`

A route entry names a tile and gives it nothing — the route table lowers to
`tile: () => …`. A target that declared `in=` therefore left `$1` unbound:

```kumiki
tile Panel in=Text = column(text($1))
tile Host  = column(Panel("a"))
app M caps=[] routes={"/" -> Panel, "/404" -> Host} init=[]
```

`check` said ok, `build` said ok, and the mount died in render with
`_d_1 is not defined`. The app rendered nothing at all, and the first sign of
it was at the smoke tier.

That is E0213 now, reported at the entry — the same code a call site already
gives for a tile applied to the wrong number of arguments, because a route
entry is one such application. A sub-route entry, and therefore whatever
`route-outlet` renders, is checked the same way.

Nothing is lost by refusing it: the route being rendered is in the standard
`route` slot, which every tile can read without an argument. A tile that takes
an input stays callable from a tile body — it is the route position alone that
supplies none.
