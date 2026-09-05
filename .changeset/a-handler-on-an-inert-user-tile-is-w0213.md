---
"@kumikijs/compiler": minor
---

Report a handler on a user tile that fires nothing (W0213)

`Inner() {onClick: bump}` over `tile Inner = box(text("clickme"))` renders,
wires no listener, and reported nothing at all — `check`, `build` and `smoke`
were all clean, and the click did nothing:

```
$ kumiki check a.kumiki
ok
$ kumiki smoke a.kumiki
ok — mounted, rendered, 0 interaction(s), no runtime errors
```

Written directly on the `box`, the same binding was already **W0213
`handler-on-inert-tile`**. `checkHandlerTarget` returned early for any name
outside `BUILTIN_TILES`, which is a statement about where the answer is *easy*
— a builtin's renderer is known — rather than about where the problem is. The
outcome is identical either way: the element renders, no listener is attached,
and nothing says why. W0213 exists precisely because this is the failure
`smoke` cannot see.

A user tile is now asked the same question, by walking its render tree with
`collectTileBuiltinKinds` — the walk W0212 already uses — and the message names
what the tile does render:

> `"onClick" on Inner() is dropped — Inner renders nothing that fires it (observed in body: box, text). Put it on button / check / radio / switch, or subscribe with a reducer's on=ui.<event>(<Tile>)`

Only a tree with no firing kind anywhere in it is reported, which under-reports
rather than over-reports: the prop lands on the tile's **root** node, so
`box(button(…))` drops the handler too and stays silent, because the walk does
not yet tell a root from a descendant. Everything it does report is a certain
drop, so the working shape — a tile whose tree contains a firing kind — draws
nothing and the warning does not become noise. When the walk finds no kind at
all — the tile's own root is a name that resolves to neither a builtin nor a
declared tile, or a cycle — nothing is reported, matching how W0212 declines
the same empty answer; those shapes have E0105 / E0005 already. Nested, the
kinds around the unresolvable part are still a true answer about the root, so
the warning stands beside the code that names it.
