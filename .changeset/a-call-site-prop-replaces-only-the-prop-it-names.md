---
"@kumikijs/compiler": patch
---

A data prop written where a user tile is called replaces only the prop it names

A call site's data props are merged onto the nodes the tile renders at its root
(language.md §1.7.3). The merge was one level deep, so the `el` payload a
reducer reads as `$el` was replaced whole by the call site's. With

```kumiki
tile Ghost = button(text="Ghost", id="three")
reducer hitGhost on=ui.click(Ghost#three) do= log := log + "ghost;"
tile P = column(Ghost {variant: "ghost"}, text(log))
```

the button's `$el` was `{variant: "ghost"}`. The id the tile gave it was gone,
the runtime's `Tile#id` filter (§1.6.2) dropped every click, and `hitGhost`
never ran, with `check` and `build` both clean. Any other field the tile put
in `$el` went the same way: a reducer reading `$el.todoId` from
`tile Del = button(text="Del") {todoId: 7}` read nothing once a call site wrote
any prop at all. The `aria` map was replaced the same way, so
`Del {aria-describedby: "hint"}` rendered the button without the tile's
`aria-label`.

Before:

```
$ kumiki run variant.kumiki variant.scenario.json
[ok] step 0 (click the plain button): click button:nth-of-type(1)
[FAIL] step 1 (click the ghost button): click button:nth-of-type(2)
    assert: DOM should include "log=plain;ghost;"
```

After:

```
$ kumiki run variant.kumiki variant.scenario.json
[ok] step 0 (click the plain button): click button:nth-of-type(1)
[ok] step 1 (click the ghost button): click button:nth-of-type(2)

scenario passed
```

`_attachProps` merges `el` and `aria` a field at a time: a prop the call site
writes replaces the one of that name, and every prop it does not write stays as
the tile wrote it, in the rendered element and in `$el` alike. A call-site `id`
(`Ghost {id: "x"}` or `Ghost(id="x")`) still replaces the tile's id, so
`ui.click(Ghost#x)` fires for it and `ui.click(Ghost#three)` does not. Every
user-tile call site goes through the one merge: a `for`-bodied tile, a tile
whose body is an `if` / `when` / `match`, a tile calling another, and the
server-rendered page alike.
